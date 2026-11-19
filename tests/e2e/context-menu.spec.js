import {
    PDF_PATH,
    TEST_ORIGIN,
    clickContextMenuEntry,
    contextMenuEntryExists,
    expect,
    hasServiceWorkerRestarted,
    pathToSource,
    startLatePageServer,
    stopServiceWorker,
    test
} from './fixtures.js';

// The options page stands in for the special pages (chrome://, web stores, etc.) where the content script cannot run
const openSpecialPage = async function ({ context, serviceWorker, extensionId }) {
    const url = `chrome-extension://${extensionId}/options.html`;
    const page = await context.newPage();
    await page.goto(url);
    await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(true);

    return page;
};

test('"Close Tab" context menu entry closes the tab after the service worker restarts', async ({ context, serviceWorker, extensionId }) => {
    const page = await openSpecialPage({ context, serviceWorker, extensionId });
    const closed = page.waitForEvent('close');

    await stopServiceWorker({ context, serviceWorker }, page);
    // Wake the service worker up without a tab event, the way a click on the context menu entry would
    await page.evaluate(() => chrome.runtime.sendMessage({}));
    expect(await hasServiceWorkerRestarted(serviceWorker)).toBe(true);

    expect(await serviceWorker.evaluate(() => chrome.contextMenus.onClicked.hasListeners())).toBe(true);
    await clickContextMenuEntry(serviceWorker, page.url());

    await closed;
    expect(page.isClosed()).toBe(true);
});

test('"Close Tab" context menu entry is removed on navigating to a regular page after the service worker restarts', async ({ context, serviceWorker, extensionId }) => {
    const page = await openSpecialPage({ context, serviceWorker, extensionId });

    await stopServiceWorker({ context, serviceWorker }, page);
    // The navigation wakes the service worker up through chrome.tabs.onUpdated
    await page.goto(`${TEST_ORIGIN}/after-service-worker-restart`);
    expect(await hasServiceWorkerRestarted(serviceWorker)).toBe(true);

    await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(false);
});

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

test('local file pages get the "Close Tab" context menu entry', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await page.goto(`${TEST_ORIGIN}/before-local-file`);
    await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(false);

    // The host permissions in the manifest do not cover local files, so the content script cannot run there
    await page.goto(`file://${pathToSource}/options.html`);

    await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(true);
});

test('a tab which waits for the first response of its page gets the "Close Tab" context menu entry', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await page.goto(`${TEST_ORIGIN}/before-slow-server`);
    await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(false);

    // A local server rather than a route: the tab which chrome.tabs.create() opens can escape the routes of Playwright
    const server = await startLatePageServer({ holdHeaders: true });
    try {
        // Like a link which opens in a new tab: the tab stays blank, without any page in it, until the server answers
        const tabId = await serviceWorker.evaluate(async (url) => (await chrome.tabs.create({ url })).id, server.url);
        await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(true);
        const tab = await serviceWorker.evaluate((tabId) => chrome.tabs.get(tabId), tabId);
        expect({ url: tab.url, pendingUrl: tab.pendingUrl }).toEqual({ url: '', pendingUrl: server.url });

        server.sendPage();
        await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(false);
    } finally {
        server.close();
    }
});

test('a browser error page gets the "Close Tab" context menu entry', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await page.goto(`${TEST_ORIGIN}/before-error-page`);
    await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(false);

    // The request fails, so the tab shows a browser error page: it keeps the URL of the page, but cannot be scripted
    const url = `${TEST_ORIGIN}/unreachable`;
    await context.route(url, (route) => route.abort('connectionrefused'));
    await expect(page.goto(url)).rejects.toThrow();
    await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(true);

    await page.goto(`${TEST_ORIGIN}/after-error-page`);
    await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(false);
});

test('a PDF file gets the "Close Tab" context menu entry', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await page.goto(`${TEST_ORIGIN}/before-pdf`);
    await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(false);

    // The PDF viewer of the browser gets the clicks there, so the content script never sees them
    await page.goto(`${TEST_ORIGIN}${PDF_PATH}file.pdf`);
    await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(true);

    await page.goto(`${TEST_ORIGIN}/after-pdf`);
    await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(false);
});

test('a tab whose page has not started to arrive gets the "Close Tab" context menu entry', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await page.goto(`${TEST_ORIGIN}/before-late-page`);
    await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(false);

    const server = await startLatePageServer();
    try {
        // The server has answered, so the tab shows its (still empty) document, where the content script cannot run yet
        await page.goto(server.url, { waitUntil: 'commit' });
        await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(true);

        server.sendPage();
        await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(false);
    } finally {
        server.close();
    }
});
