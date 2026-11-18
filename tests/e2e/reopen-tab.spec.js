import {
    CANCEL_CONTEXT_MENU_PATH,
    TEST_ORIGIN,
    expect,
    holdRightClick,
    openTestPage,
    restoredSessionIds,
    stubReopenClosedTab,
    test
} from './fixtures.js';

// Shift + double right click reopens the last closed tab, once the user has granted the optional "sessions"
// permission on the options page. Chromium grants it without a prompt to an extension which got loaded from a folder,
// as here. Most tests stub the permission and chrome.sessions in the service worker instead, so that they control
// what is listed as closed. As in close-tab.spec.js, they use a page which cancels the context menu.

// Newest first, as chrome.sessions.getRecentlyClosed() lists them
const RECENTLY_CLOSED = [
    { lastModified: 3, window: { sessionId: 'closed-window', tabs: [] } },
    { lastModified: 2, tab: { sessionId: 'closed-tab-newest' } },
    { lastModified: 1, tab: { sessionId: 'closed-tab-older' } }
];

// Two right clicks, with Shift held on the first one, the second one, or both
const doubleRightClick = async function (page, { shiftOn = [] } = {}) {
    for (const click of ['first', 'second']) {
        if (click === 'second') {
            await page.waitForTimeout(150);
        }
        if (shiftOn.includes(click)) {
            await page.keyboard.down('Shift');
        }
        await holdRightClick(page, 120);
        if (shiftOn.includes(click)) {
            // The tab can be closed by now
            await page.keyboard.up('Shift').catch((err) => {
                if (!page.isClosed()) {
                    throw err;
                }
            });
        }
    }
};

const isSessionsPermissionGranted = async function (serviceWorker) {
    return await serviceWorker.evaluate(() => chrome.permissions.contains({ permissions: ['sessions'] }));
};

test('the options page turns reopening on and off through the "sessions" permission', async ({ context, serviceWorker, extensionId }) => {
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    const checkbox = optionsPage.getByRole('checkbox', { name: 'Reopen the last closed tab' });

    await expect(checkbox).not.toBeChecked();
    expect(await isSessionsPermissionGranted(serviceWorker)).toBe(false);

    await checkbox.check();
    await expect.poll(() => isSessionsPermissionGranted(serviceWorker)).toBe(true);
    await optionsPage.reload();
    await expect(checkbox).toBeChecked();

    await checkbox.uncheck();
    await expect.poll(() => isSessionsPermissionGranted(serviceWorker)).toBe(false);
    await optionsPage.reload();
    await expect(checkbox).not.toBeChecked();
});

test('after turning reopening on, Shift + double right click reopens the tab which the gesture closed', async ({ context, serviceWorker, extensionId }) => {
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.getByRole('checkbox', { name: 'Reopen the last closed tab' }).check();
    await expect.poll(() => isSessionsPermissionGranted(serviceWorker)).toBe(true);
    await optionsPage.close();

    const closedUrl = `${TEST_ORIGIN}${CANCEL_CONTEXT_MENU_PATH}closed-then-reopened`;
    const pageToClose = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}closed-then-reopened`);
    const closed = pageToClose.waitForEvent('close');
    await doubleRightClick(pageToClose);
    await closed;

    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}reopens-for-real`);
    const reopened = context.waitForEvent('page');
    await doubleRightClick(page, { shiftOn: ['first', 'second'] });

    const reopenedPage = await reopened;
    await expect.poll(() => reopenedPage.url()).toBe(closedUrl);
    expect(page.isClosed()).toBe(false);
});

test('Shift + double right click closes the tab while reopening is not turned on', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}shift-not-turned-on`);
    const closed = page.waitForEvent('close');

    await doubleRightClick(page, { shiftOn: ['first', 'second'] });

    await closed;
    expect(page.isClosed()).toBe(true);
});

test('Shift + double right click reopens the last closed tab and keeps the tab open', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}shift-reopens`);
    await stubReopenClosedTab(serviceWorker, RECENTLY_CLOSED);

    await doubleRightClick(page, { shiftOn: ['first', 'second'] });

    // The closed window is skipped
    await expect.poll(() => restoredSessionIds(serviceWorker)).toEqual(['closed-tab-newest']);
    await page.waitForTimeout(1000);
    expect(page.isClosed()).toBe(false);
});

test('Shift held on the first click only reopens the last closed tab', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}shift-on-first-click`);
    await stubReopenClosedTab(serviceWorker, RECENTLY_CLOSED);

    await doubleRightClick(page, { shiftOn: ['first'] });

    await expect.poll(() => restoredSessionIds(serviceWorker)).toEqual(['closed-tab-newest']);
    await page.waitForTimeout(1000);
    expect(page.isClosed()).toBe(false);
});

test('Shift held on the second click only closes the tab', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}shift-on-second-click`);
    await stubReopenClosedTab(serviceWorker, RECENTLY_CLOSED);
    const closed = page.waitForEvent('close');

    await doubleRightClick(page, { shiftOn: ['second'] });

    await closed;
    expect(await restoredSessionIds(serviceWorker)).toEqual([]);
});

test('double right click without Shift closes the tab while reopening is turned on', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}no-shift-turned-on`);
    await stubReopenClosedTab(serviceWorker, RECENTLY_CLOSED);
    const closed = page.waitForEvent('close');

    await doubleRightClick(page);

    await closed;
    expect(await restoredSessionIds(serviceWorker)).toEqual([]);
});

test('triple right click with Shift on the first click reopens one tab and keeps the tab open', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}shift-triple-click`);
    await stubReopenClosedTab(serviceWorker, RECENTLY_CLOSED);

    // The third click comes without Shift: it belongs to the same gesture, so it must not close the tab either
    await doubleRightClick(page, { shiftOn: ['first'] });
    await page.waitForTimeout(150);
    await holdRightClick(page, 120);

    await page.waitForTimeout(1000);
    expect(await restoredSessionIds(serviceWorker)).toEqual(['closed-tab-newest']);
    expect(page.isClosed()).toBe(false);
});

test('two Shift + double right clicks reopen two tabs', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}shift-twice`);
    await stubReopenClosedTab(serviceWorker, RECENTLY_CLOSED);

    await doubleRightClick(page, { shiftOn: ['first', 'second'] });
    await expect.poll(() => restoredSessionIds(serviceWorker)).toHaveLength(1);
    // Longer than the maximum time between clicks (500 ms by default), so the clicks of the first gesture stop counting
    await page.waitForTimeout(700);
    await doubleRightClick(page, { shiftOn: ['first', 'second'] });

    // The stand-in keeps listing the same sessions; the browser would list the next closed tab first by then
    await expect.poll(() => restoredSessionIds(serviceWorker)).toEqual(['closed-tab-newest', 'closed-tab-newest']);
    expect(page.isClosed()).toBe(false);
});

test('Shift + double right click with nothing to reopen keeps the tab open', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}shift-nothing-closed`);
    await stubReopenClosedTab(serviceWorker, [RECENTLY_CLOSED[0]]);

    await doubleRightClick(page, { shiftOn: ['first', 'second'] });

    await page.waitForTimeout(1000);
    expect(await restoredSessionIds(serviceWorker)).toEqual([]);
    expect(page.isClosed()).toBe(false);
});
