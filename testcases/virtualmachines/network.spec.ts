import NetworkPage from '@/pageobjects/network.po';
import clusterNetworkPage from '@/pageobjects/clusterNetwork.po';
import { VmsPage } from "@/pageobjects/virtualmachine.po";
import { generateName } from '@/utils/utils';
import { PageUrl } from "@/constants/constants";
import { Constants } from "@/constants/constants";
import TablePo from '@/utils/components/table.po';

const network = new NetworkPage();
const clusterNetworkPo = new clusterNetworkPage();
const vms = new VmsPage();
const constants = new Constants();
const table = new TablePo();

const networksEnv = Cypress.env('networks') || {};
const nic: string = networksEnv.nic;
const vlan: number = networksEnv.vlans?.[0];

// Names used only if this suite needs to create new resources
const clusterNetworkName = `cn-${String(Date.now()).slice(-8)}`;
const networkConfigName = `${clusterNetworkName}-nc`;
const vmNetworkName = `vlan${vlan}`;
const vmNetworkNamespace = 'default';

// Track what this suite created so after() only deletes what it made
let createdClusterNetwork = false;
let createdNetworkConfig = false;
let createdVmNetwork = false;
let resolvedClusterNetwork = '';

/**
 * Setup:
 * 1. Visit cluster network list - if a CN with a network config group-tab exists, reuse it.
 * 2. Only create CN + network config if none found.
 * 3. Visit VM network list - if vmNetworkName exists and is Active (route Active), skip.
 * 4. Only create VM network if missing.
 */
before(() => {
  cy.login();

  // Ensure the image is uploaded before running VM creation tests
  vms.init();

  // ── Step 1: Check cluster network list UI ──────────────────────────────────
  clusterNetworkPo.goToList();
  cy.get('body').then($body => {
    // The list groups configs under "Cluster Network: <name>" group tabs
    const groupTab = $body.find('.group-tab').first();
    if (groupTab.length > 0) {
      const match = groupTab.text().match(/Cluster Network:\s*(\S+)/);
      if (match?.[1]) {
        resolvedClusterNetwork = match[1].trim();
        cy.log(`Found existing cluster network on UI: ${resolvedClusterNetwork}`);
      }
    }
  });

  // ── Step 2: Create CN + config only if Step 1 found nothing ───────────────
  cy.then(() => {
    if (!resolvedClusterNetwork) {
      cy.log(`No cluster network found, creating: ${clusterNetworkName}`);
      clusterNetworkPo.createClusterNetwork(clusterNetworkName);
      createdClusterNetwork = true;
      cy.wait(5000); // let controller reconcile NIC availability
      clusterNetworkPo.createNetworkConfig(networkConfigName, nic);
      createdNetworkConfig = true;
      resolvedClusterNetwork = clusterNetworkName;
    }
  });

  // ── Step 3: Check VM network list UI ──────────────────────────────────────
  cy.then(() => {
    network.goToList();
    // Switch to flat list so all networks are in a single table
    table.clickFlatListBtn();
    cy.get('body').then($body => {
      let vmNetworkReady = false;
      $body.find('[data-testid$="-row"]').each((_, row) => {
        const cells = Cypress.$(row).find('td');
        // Column 3 = name (0-indexed: 2), Col 2 = state (idx 1), Col 8 = routeConnectivity (idx 7)
        const name = cells.eq(2).text().trim();
        const state = cells.eq(1).text().trim();
        const routeConn = cells.eq(7).text().trim();
        if (name === vmNetworkName && state.includes('Active') && routeConn.includes('Active')) {
          vmNetworkReady = true;
          cy.log(`VM network ${vmNetworkName} is Active with Active route, reusing.`);
        }
      });
      if (!vmNetworkReady) {
        cy.log(`VM network ${vmNetworkName} not found or not Active, creating on ${resolvedClusterNetwork}...`);
        network.create({
          name: vmNetworkName,
          namespace: vmNetworkNamespace,
          vlan: String(vlan),
          clusterNetwork: resolvedClusterNetwork,
        });
        createdVmNetwork = true;
      }
    });
  });
});

after(() => {
  cy.login();

  // Delete in dependency order: VM network → network config → cluster network
  // Use cy.request() DELETE — reliable, session cookie from cy.login() is shared
  if (createdVmNetwork) {
    cy.request({
      method: 'DELETE',
      url: `/v1/harvester/k8s.cni.cncf.io.network-attachment-definitions/${vmNetworkNamespace}/${vmNetworkName}`,
      failOnStatusCode: false,
    }).then(res => cy.log(`Deleted VM network ${vmNetworkName}: ${res.status}`));
  }
  if (createdNetworkConfig) {
    cy.request({
      method: 'DELETE',
      url: `/v1/harvester/network.harvesterhci.io.vlanconfigs/${networkConfigName}`,
      failOnStatusCode: false,
    }).then(res => cy.log(`Deleted network config ${networkConfigName}: ${res.status}`));
  }
  if (createdClusterNetwork) {
    // Wait briefly for network config deletion to propagate before removing CN
    cy.wait(3000);
    cy.request({
      method: 'DELETE',
      url: `/v1/harvester/network.harvesterhci.io.clusternetworks/${clusterNetworkName}`,
      failOnStatusCode: false,
    }).then(res => cy.log(`Deleted cluster network ${clusterNetworkName}: ${res.status}`));
  }
});

/**
 * 1. Login
 * 2. Navigate to the VM create page
 * 3. Provide cpu: 1, memory: 1
 * 4. Select opensuse image and use default size
 * 5. Select vlan network from env (networks.vlans[0])
 * 6. Confirm VM is started into running state
 * 7. Check vm can get IP address
 */
describe('Create VM with vlan network', () => {
  const VM_NAME = generateName('test-vm-vlan');

  beforeEach(() => {
    cy.login({ url: PageUrl.virtualMachine });
  });

  afterEach(() => {
    vms.deleteVMFromStore(`${vmNetworkNamespace}/${VM_NAME}`);
  });

  it('Create VM with vlan network', () => {
    const largeImageEnv = Cypress.env('largeImage');

    vms.create({
      name: VM_NAME,
      cpu: '1',
      memory: '1',
      image: Cypress._.toLower(largeImageEnv.name),
      networks: [{ network: vmNetworkName }],
      namespace: vmNetworkNamespace,
    });

    vms.goToList();

    vms.censorInColumn(VM_NAME, 3, vmNetworkNamespace, 4, 'Running', 2, {
      timeout: constants.timeout.maxTimeout,
      nameSelector: '.name-console a',
    });

    vms.censorInColumn(VM_NAME, 3, vmNetworkNamespace, 4, '.', 7, {
      timeout: constants.timeout.maxTimeout,
      nameSelector: '.name-console a',
    });
  });
});

/**
 * 1. Create VM with management network
 * 2. Confirm VM running
 * 3. Edit VM to add vlan network from env
 * 4. Confirm VM running after restart
 * 5. Check VM has IP address
 */
describe('Add a vlan network to existing VM', () => {
  const VM_NAME = generateName('test-network');

  beforeEach(() => {
    cy.login();
  });

  afterEach(() => {
    vms.deleteVMFromStore(`${vmNetworkNamespace}/${VM_NAME}`);
  });

  it('Add a vlan network to existing VM', () => {
    const largeImageEnv = Cypress.env('largeImage');

    vms.create({
      name: VM_NAME,
      cpu: '1',
      memory: '1',
      image: Cypress._.toLower(largeImageEnv.name),
      networks: [{ network: 'management Network' }],
      namespace: vmNetworkNamespace,
    });

    vms.goToList();

    vms.censorInColumn(VM_NAME, 3, vmNetworkNamespace, 4, 'Running', 2, {
      timeout: constants.timeout.maxTimeout,
      nameSelector: '.name-console a',
    });

    vms.edit(VM_NAME, {
      networks: [
        { network: 'management Network' },
        { network: vmNetworkName },
      ],
    });

    // Wait for VM to begin restarting after network interface change
    cy.wait(15000);
    vms.goToList();

    vms.censorInColumn(VM_NAME, 3, vmNetworkNamespace, 4, 'Running', 2, {
      timeout: constants.timeout.maxTimeout,
      nameSelector: '.name-console a',
    });

    vms.censorInColumn(VM_NAME, 3, vmNetworkNamespace, 4, '.', 7, {
      timeout: constants.timeout.maxTimeout,
      nameSelector: '.name-console a',
    });
  });
});
