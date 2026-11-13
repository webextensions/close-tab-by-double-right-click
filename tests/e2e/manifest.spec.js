import {
    expect,
    pathToChromeBuild,
    pathToSource,
    test
} from './fixtures.js';

const extensionFolders = [
    ['dist/chrome', pathToChromeBuild],
    // Chrome and other Chromium-based browsers can also load the source folder directly
    ['extension/', pathToSource]
];

for (const [name, extensionPath] of extensionFolders) {
    test.describe(name, () => {
        test.use({ extensionPath });

        test('Chrome reports no manifest warnings for the extension', async ({ context, extensionId }) => {
            const page = await context.newPage();
            await page.goto('chrome://extensions/');

            // chrome.developerPrivate is the API the chrome://extensions page itself uses. Manifest warnings are only
            // collected in developer mode and while the extension loads, hence the reload. "INSTALLED" is the last
            // event of a reload.
            const manifestErrors = await page.evaluate(async (extensionId) => {
                await chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true });
                await new Promise((resolve) => {
                    chrome.developerPrivate.onItemStateChanged.addListener((event) => {
                        if (event.item_id === extensionId && event.event_type === 'INSTALLED') {
                            resolve();
                        }
                    });
                    chrome.developerPrivate.reload(extensionId, { failQuietly: true });
                });
                const info = await chrome.developerPrivate.getExtensionInfo(extensionId);
                return info.manifestErrors.map((error) => error.message);
            }, extensionId);

            expect(manifestErrors).toEqual([]);
        });
    });
}
