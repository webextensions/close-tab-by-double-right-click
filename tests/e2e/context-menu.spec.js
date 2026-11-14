import {
    TEST_ORIGIN,
    expect,
    test
} from './fixtures.js';

const CONTEXT_MENU_ENTRY_ID = 'close-tab';

// chrome.contextMenus has no API to read the entries, but update() rejects for an id which does not exist
const contextMenuEntryExists = async function (serviceWorker) {
    return await serviceWorker.evaluate(async (menuItemId) => {
        try {
            await chrome.contextMenus.update(menuItemId, {});
            return true;
        } catch {
            return false;
        }
    }, CONTEXT_MENU_ENTRY_ID);
};

// Playwright cannot operate the native context menu, so dispatch the click event directly
const clickContextMenuEntry = async function (serviceWorker, url) {
    await serviceWorker.evaluate(async ({ menuItemId, url }) => {
        const [tab] = await chrome.tabs.query({ url });
        chrome.contextMenus.onClicked.dispatch({ menuItemId }, tab);
    }, { menuItemId: CONTEXT_MENU_ENTRY_ID, url });
};

// The options page stands in for the special pages (chrome://, web stores, etc.) where the content script cannot run
const openSpecialPage = async function ({ context, serviceWorker, extensionId }) {
    const url = `chrome-extension://${extensionId}/options.html`;
    const page = await context.newPage();
    await page.goto(url);
    await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(true);

    return page;
};

test('"Close Tab" context menu entry closes the tab which was clicked', async ({ context, serviceWorker, extensionId }) => {
    const specialPage = await openSpecialPage({ context, serviceWorker, extensionId });
    const url = `${TEST_ORIGIN}/clicked-tab`;
    const clickedPage = await context.newPage();
    await clickedPage.goto(url);
    const closed = clickedPage.waitForEvent('close');

    // A stale entry can still be showing right after a switch from a special page
    await clickContextMenuEntry(serviceWorker, url);

    await closed;
    expect(specialPage.isClosed()).toBe(false);
});
