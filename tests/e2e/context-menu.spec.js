import {
    PDF_PATH,
    TEST_ORIGIN,
    chooseOption,
    clickContextMenuEntry,
    contextMenuEntryActions,
    contextMenuEntryExists,
    contextMenusCreateCalls,
    expect,
    hasServiceWorkerRestarted,
    pathToSource,
    setGestureAction,
    spyOnContextMenusCreate,
    startLatePageServer,
    stopServiceWorker,
    stubReopenClosedTab,
    test
} from './fixtures.js';

const DOUBLE_RIGHT_CLICK_ACTION = 'DOUBLE_RIGHT_CLICK_ACTION';

// The options page stands in for the special pages (chrome://, web stores, etc.) where the content script cannot run
const openSpecialPage = async function ({ context, serviceWorker, extensionId }) {
    const url = `chrome-extension://${extensionId}/options.html`;
    const page = await context.newPage();
    await page.goto(url);
    await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(true);

    return page;
};

test('"Close tab" context menu entry closes the tab after the service worker restarts', async ({ context, serviceWorker, extensionId }) => {
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

test('"Close tab" context menu entry is removed on navigating to a regular page after the service worker restarts', async ({ context, serviceWorker, extensionId }) => {
    const page = await openSpecialPage({ context, serviceWorker, extensionId });

    await stopServiceWorker({ context, serviceWorker }, page);
    // The navigation wakes the service worker up through chrome.tabs.onUpdated
    await page.goto(`${TEST_ORIGIN}/after-service-worker-restart`);
    expect(await hasServiceWorkerRestarted(serviceWorker)).toBe(true);

    await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(false);
});

test('"Close tab" context menu entry closes the tab which was clicked', async ({ context, serviceWorker, extensionId }) => {
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

test('local file pages get the "Close tab" context menu entry', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await page.goto(`${TEST_ORIGIN}/before-local-file`);
    await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(false);

    // The host permissions in the manifest do not cover local files, so the content script cannot run there
    await page.goto(`file://${pathToSource}/options.html`);

    await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(true);
});

test('a tab which waits for the first response of its page gets the "Close tab" context menu entry', async ({ context, serviceWorker }) => {
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

test('a browser error page gets the "Close tab" context menu entry', async ({ context, serviceWorker }) => {
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

test('a PDF file gets the "Close tab" context menu entry', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await page.goto(`${TEST_ORIGIN}/before-pdf`);
    await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(false);

    // The PDF viewer of the browser gets the clicks there, so the content script never sees them
    await page.goto(`${TEST_ORIGIN}${PDF_PATH}file.pdf`);
    await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(true);

    await page.goto(`${TEST_ORIGIN}/after-pdf`);
    await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(false);
});

test('a tab whose page has not started to arrive gets the "Close tab" context menu entry', async ({ context, serviceWorker }) => {
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

test('the context menu entry does what a double right click is set to do', async ({ context, serviceWorker, extensionId }) => {
    const page = await openSpecialPage({ context, serviceWorker, extensionId });

    await setGestureAction(serviceWorker, DOUBLE_RIGHT_CLICK_ACTION, 'newTab');
    await expect.poll(() => contextMenuEntryActions(serviceWorker)).toEqual(['newTab']);

    const newPage = context.waitForEvent('page');
    await clickContextMenuEntry(serviceWorker, page.url(), 'newTab');
    await newPage;
    expect(page.isClosed()).toBe(false);
});

test('the context menu entry follows a change of the double right click at once', async ({ context, serviceWorker, extensionId }) => {
    await openSpecialPage({ context, serviceWorker, extensionId });

    await setGestureAction(serviceWorker, DOUBLE_RIGHT_CLICK_ACTION, 'reload');
    await expect.poll(() => contextMenuEntryActions(serviceWorker)).toEqual(['reload']);

    // Set to do nothing, there is no entry
    await setGestureAction(serviceWorker, DOUBLE_RIGHT_CLICK_ACTION, 'nothing');
    await expect.poll(() => contextMenuEntryActions(serviceWorker)).toEqual([]);

    await serviceWorker.evaluate((setting) => chrome.storage.sync.remove(setting), DOUBLE_RIGHT_CLICK_ACTION);
    await expect.poll(() => contextMenuEntryActions(serviceWorker)).toEqual(['closeTab']);
});

test('the context menu entry ignores what a double right click does with a key held', async ({ context, serviceWorker, extensionId }) => {
    await openSpecialPage({ context, serviceWorker, extensionId });

    await setGestureAction(serviceWorker, 'SHIFT_DOUBLE_RIGHT_CLICK_ACTION', 'newTab');
    await setGestureAction(serviceWorker, DOUBLE_RIGHT_CLICK_ACTION, 'reload');
    await expect.poll(() => contextMenuEntryActions(serviceWorker)).toEqual(['reload']);
});

test('the context menu entry to reopen the last closed tab is there only while the permission is', async ({ context, serviceWorker, extensionId }) => {
    // The options page is the special page here, where the choice gets made (Chromium grants the permission without
    // a prompt)
    const optionsPage = await openSpecialPage({ context, serviceWorker, extensionId });
    await chooseOption(optionsPage.getByRole('combobox', { name: 'Double right click', exact: true }), 'Reopen last closed tab');
    await expect.poll(() => contextMenuEntryActions(serviceWorker)).toEqual(['reopenClosedTab']);

    await serviceWorker.evaluate(() => chrome.permissions.remove({ permissions: ['sessions'] }));
    await expect.poll(() => contextMenuEntryActions(serviceWorker)).toEqual([]);
});

test('the context menu entry shows the labels of the dropdowns on the options page', async ({ context, serviceWorker, extensionId }) => {
    const optionsPage = await openSpecialPage({ context, serviceWorker, extensionId });
    const options = await optionsPage.getByRole('combobox', { name: 'Double right click', exact: true }).locator('option')
        .evaluateAll((elements) => elements.map((el) => ({ action: el.value, title: el.label })));
    await spyOnContextMenusCreate(serviceWorker);
    // Reopening a closed tab gets its entry only with the permission
    await stubReopenClosedTab(serviceWorker, []);

    for (const { action } of options) {
        await setGestureAction(serviceWorker, DOUBLE_RIGHT_CLICK_ACTION, action);
        await expect.poll(() => contextMenuEntryActions(serviceWorker)).toEqual(action === 'nothing' ? [] : [action]);
    }

    const titles = Object.fromEntries((await contextMenusCreateCalls(serviceWorker)).map(({ id, title }) => [id, title]));
    expect(titles).toEqual(Object.fromEntries(options.filter(({ action }) => action !== 'nothing').map(({ action, title }) => [action, title])));
});

test('a context menu entry which waits for the settings does not show up after the page arrived and removed it', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    await page.goto(`${TEST_ORIGIN}/before-held-settings`);
    await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(false);

    // Holds each read of the settings until released, and counts the removals of the entry
    await serviceWorker.evaluate(() => {
        let release;
        const released = new Promise((resolve) => {
            release = resolve;
        });
        globalThis.releaseSettings = release;
        globalThis.heldSettingsReads = 0;
        const get = chrome.storage.sync.get;
        chrome.storage.sync.get = async function (...args) {
            globalThis.heldSettingsReads++;
            await released;
            return get.apply(this, args);
        };
        globalThis.contextMenusRemoveAllCalls = 0;
        const removeAll = chrome.contextMenus.removeAll;
        chrome.contextMenus.removeAll = function (...args) {
            globalThis.contextMenusRemoveAllCalls++;
            return removeAll.apply(this, args);
        };
    });

    const server = await startLatePageServer();
    try {
        // The probe gets no answer before the page starts to arrive, so the entry waits for the settings
        await page.goto(server.url, { waitUntil: 'commit' });
        await expect.poll(() => serviceWorker.evaluate(() => globalThis.heldSettingsReads)).toBeGreaterThan(0);
        const removalsBefore = await serviceWorker.evaluate(() => globalThis.contextMenusRemoveAllCalls);

        // The probe answers once the page arrives, which removes the entry
        server.sendPage();
        await expect.poll(() => serviceWorker.evaluate(() => globalThis.contextMenusRemoveAllCalls)).toBeGreaterThan(removalsBefore);

        await serviceWorker.evaluate(() => globalThis.releaseSettings());
        await page.waitForTimeout(500);
        expect(await contextMenuEntryActions(serviceWorker)).toEqual([]);
    } finally {
        server.close();
    }
});
