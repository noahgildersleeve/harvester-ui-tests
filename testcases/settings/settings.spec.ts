import { PageUrl } from "@/constants/constants";
import SettingsPagePo from "@/pageobjects/settings.po";

const settings = new SettingsPagePo();

describe('Setting Page', () => {
    beforeEach(() => {
        cy.login({ url: PageUrl.setting });
        settings.checkIsCurrentPage();
    })

    afterEach(() => {
        // cy.request() bypasses the UI so the reset works even when the page itself cannot load.
        cy.request({
            method: 'GET',
            url: '/v1/harvester/harvesterhci.io.settings/ui-source',
            failOnStatusCode: false,
        }).then(res => {
            if (res.status === 200) {
                cy.request({
                    method: 'PUT',
                    url: '/v1/harvester/harvesterhci.io.settings/ui-source',
                    body: { ...res.body, value: 'bundled' },
                    failOnStatusCode: false,
                });
            }
        });
    })

    /**
     * https://harvester.github.io/tests/manual/advanced/chage-api-ui-source-bundled/
     * 1. Navigate to the Advanced Settings Page via URL
     * 2. Edit UI Source via UI
     * 3. Change the UISource Type
     * 4. Validate that the URL changed
     * 5. Revert the change
     */
    it('change UI source type to Bundled, Check whether the configuration takes effect', () => {
        const address = `${Cypress.env('baseUrl')}/dashboard/js/**`;
        settings.clickMenu('ui-source', 'Edit Setting', 'ui-source', undefined, 'UI')
        settings.checkUiSource('Bundled ', address);

        // revert change
        settings.navigateUISettingPage()
        settings.clickMenu('ui-source', 'Edit Setting', 'ui-source', undefined, 'UI')
        settings.clickUseDefaultButton()
    });


    it('change UI source type to external, Check whether the configuration takes effect', () => {
        const address = 'https://releases.rancher.com/harvester-ui/dashboard/**';
        settings.clickMenu('ui-source', 'Edit Setting', 'ui-source', undefined, 'UI')
        settings.checkUiSource('External ', address);

        // revert change
        settings.navigateUISettingPage()
        settings.clickMenu('ui-source', 'Edit Setting', 'ui-source', undefined, 'UI')
        settings.clickUseDefaultButton()
    });

    /**
     * https://harvester.github.io/tests/manual/advanced/change-log-level-debug/
     */
    it('change log level (Info)', () => {
        // setting value
        settings.clickMenu('log-level', 'Edit Setting', 'log-level')
        settings.changeLogLevel('log-level', 'Info');

        // Check whether the configuration is successful 
        settings.clickMenu('log-level', 'Edit Setting', 'log-level')
        settings.checkSettingValue('Value', 'Info');
    })

    it('change log level (Trace)', () => {
        // setting value
        settings.clickMenu('log-level', 'Edit Setting', 'log-level')
        settings.changeLogLevel('log-level', 'Trace');

        // Check whether the configuration is successful 
        settings.clickMenu('log-level', 'Edit Setting', 'log-level')
        settings.checkSettingValue('Value', 'Trace');
    })
})

/**
 * https://harvester.github.io/tests/manual/advanced/set-s3-backup-target/
 */
describe('Set backup target S3', () => {
    beforeEach(function() {
        // Skip early — before cy.login() — so no unnecessary session setup or blank page
        const backupTarget = Cypress.env('backupTarget');
        if (!backupTarget?.endpoint) {
            this.skip();
            return;
        }
        cy.login({ url: PageUrl.setting });
        settings.checkIsCurrentPage(false);
    })

    afterEach(() => {
        // Reset backup-target to default via API.
        // clearBackupTarget() → clickUseDefaultButton() fails here because Harvester only
        // renders the "Use the default value" button when the saved value differs from the
        // default.  If update() returned 422 the setting was never persisted, so the button
        // never appears and cy.click() receives undefined.
        cy.request({
            method: 'GET',
            url: '/v1/harvester/harvesterhci.io.settings/backup-target',
            failOnStatusCode: false,
        }).then(res => {
            if (res.status === 200) {
                cy.request({
                    method: 'PUT',
                    url: '/v1/harvester/harvesterhci.io.settings/backup-target',
                    body: { ...res.body, value: '' },
                    failOnStatusCode: false,
                }).then(r => cy.log(`Reset backup-target: HTTP ${r.status}`));
            }
        });
    })

    it('Set backup target S3', () => {
        const backupTarget = Cypress.env('backupTarget');

        settings.clickMenu('backup-target', 'Edit Setting', 'backup-target');
        settings.setS3BackupTarget({
            type: 'S3',
            endpoint: backupTarget.endpoint,
            bucketName: backupTarget.bucketName,
            bucketRegion: backupTarget.bucketRegion,
            accessKeyId: backupTarget.accessKey,
            secretAccessKey: backupTarget.secretKey,
        });

        settings.update('backup-target');
    });

    /**
     * backup target
     */
    it.skip('Configure backup target (NFS)', () => {
        settings.clickMenu('backup-target', 'Edit Setting', 'backup-target');
        settings.setNFSBackupTarget('NFS', Cypress.env('nfsEndPoint'));
        settings.checkSettingValue('Type', 'NFS');
        settings.update('backup-target');
    })
})
