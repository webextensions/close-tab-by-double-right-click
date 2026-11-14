import { isContentScriptReady } from '../shared/test-pages.js';
import {
    CANCEL_CONTEXT_MENU_PATH,
    expect,
    holdRightClick,
    openTestPage,
    test
} from './fixtures.js';

// Reloads the extension, which is also what an update of the extension does
const reloadExtension = async function (context, extensionId) {
    const extensionsPage = await context.newPage();
    await extensionsPage.goto('chrome://extensions/');

    // chrome.developerPrivate is the API the chrome://extensions page itself uses. An unpacked extension only stays
    // enabled across a reload in developer mode. "INSTALLED" is the last event of a reload.
    await extensionsPage.evaluate(async (extensionId) => {
        await chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true });
        await new Promise((resolve) => {
            chrome.developerPrivate.onItemStateChanged.addListener((event) => {
                if (event.item_id === extensionId && event.event_type === 'INSTALLED') {
                    resolve();
                }
            });
            chrome.developerPrivate.reload(extensionId, { failQuietly: true });
        });
    }, extensionId);

    await extensionsPage.close();
};

test('double right click works in a tab which was open before the extension got reloaded', async ({ context, serviceWorker, extensionId }) => {
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}extension-reloaded`);
    const restartedServiceWorker = context.waitForEvent('serviceworker');

    await reloadExtension(context, extensionId);
    await page.bringToFront();
    // The content script of the old extension instance is dead. On starting, the background script injects the
    // content script into all open tabs, where it runs in a new isolated world.
    await expect.poll(async () => isContentScriptReady(await restartedServiceWorker, page.url()), { timeout: 15000 }).toBe(true);
    const closed = page.waitForEvent('close');

    await holdRightClick(page, 120);
    await page.waitForTimeout(150);
    await holdRightClick(page, 120);

    await closed;
    expect(page.isClosed()).toBe(true);
});
