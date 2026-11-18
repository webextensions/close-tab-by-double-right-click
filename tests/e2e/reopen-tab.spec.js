import {
    CANCEL_CONTEXT_MENU_PATH,
    TEST_ORIGIN,
    chooseOption,
    expect,
    holdRightClick,
    openTestPage,
    restoredSessionIds,
    setGestureAction,
    stubReopenClosedTab,
    test
} from './fixtures.js';

// A gesture set to reopen the last closed tab needs the optional "sessions" permission, which the options page asks
// for when the user chooses that action. Chromium grants it here without a prompt (seen with the extension loaded
// from a folder). Most tests set the action through the settings, and stub the permission and chrome.sessions in the
// service worker instead, so that they control what is listed as closed. As in close-tab.spec.js, they use a page
// which cancels the context menu.

const SHIFT_ACTION = 'SHIFT_DOUBLE_RIGHT_CLICK_ACTION';

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

const openOptionsPage = async function ({ context, extensionId }) {
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    return optionsPage;
};

test('choosing to reopen the last closed tab asks for the "sessions" permission, which goes once no gesture uses it', async ({ context, serviceWorker, extensionId }) => {
    const optionsPage = await openOptionsPage({ context, extensionId });
    const shiftAction = optionsPage.getByRole('combobox', { name: 'Shift + Double right click' });

    await expect(shiftAction).toHaveValue('sameAsDoubleRightClick');
    expect(await isSessionsPermissionGranted(serviceWorker)).toBe(false);

    await chooseOption(shiftAction, 'Reopen the last closed tab');
    await expect.poll(() => isSessionsPermissionGranted(serviceWorker)).toBe(true);
    await expect(optionsPage.getByText('Saved')).toBeVisible();
    await expect.poll(() => serviceWorker.evaluate((setting) => chrome.storage.sync.get(setting), SHIFT_ACTION)).toEqual({
        [SHIFT_ACTION]: 'reopenClosedTab'
    });
    await optionsPage.reload();
    await expect(shiftAction).toHaveValue('reopenClosedTab');
    await expect(optionsPage.getByText('needs access to the recently closed tabs')).toBeHidden();

    await chooseOption(shiftAction, 'Same as Double right click');
    await expect.poll(() => isSessionsPermissionGranted(serviceWorker)).toBe(false);
    await optionsPage.reload();
    await expect(shiftAction).toHaveValue('sameAsDoubleRightClick');
});

test('the permission stays while another gesture still reopens the last closed tab', async ({ context, serviceWorker, extensionId }) => {
    const optionsPage = await openOptionsPage({ context, extensionId });
    const shiftAction = optionsPage.getByRole('combobox', { name: 'Shift + Double right click' });
    const ctrlAction = optionsPage.getByRole('combobox', { name: 'Ctrl + Double right click' });

    await chooseOption(shiftAction, 'Reopen the last closed tab');
    await expect(shiftAction).toHaveValue('reopenClosedTab');
    await chooseOption(ctrlAction, 'Reopen the last closed tab');
    await expect.poll(() => serviceWorker.evaluate(() => chrome.storage.sync.get('CTRL_DOUBLE_RIGHT_CLICK_ACTION'))).toEqual({
        CTRL_DOUBLE_RIGHT_CLICK_ACTION: 'reopenClosedTab'
    });

    await chooseOption(shiftAction, 'Close the tab');
    await expect.poll(() => serviceWorker.evaluate((setting) => chrome.storage.sync.get(setting), SHIFT_ACTION)).toEqual({
        [SHIFT_ACTION]: 'closeTab'
    });
    await optionsPage.waitForTimeout(500);
    expect(await isSessionsPermissionGranted(serviceWorker)).toBe(true);
});

test('a denied permission puts the previous choice back and shows no note', async ({ context, serviceWorker, extensionId }) => {
    const optionsPage = await openOptionsPage({ context, extensionId });
    const shiftAction = optionsPage.getByRole('combobox', { name: 'Shift + Double right click' });
    await expect(shiftAction).toHaveValue('sameAsDoubleRightClick');

    // As if the user denied the prompt
    await optionsPage.evaluate(() => {
        chrome.permissions.request = async function () {
            return false;
        };
    });

    // Read the note once: a retrying assertion would wait for the note to hide on its own
    await chooseOption(shiftAction, 'Reopen the last closed tab');
    await expect(shiftAction).toHaveValue('sameAsDoubleRightClick');
    expect(await optionsPage.getByText('Saved').isVisible()).toBe(false);
    expect(await isSessionsPermissionGranted(serviceWorker)).toBe(false);
    expect(await serviceWorker.evaluate(() => chrome.storage.sync.get(null))).toEqual({});
});

test('the options page offers to grant the permission while a gesture reopens the last closed tab without it', async ({ context, serviceWorker, extensionId }) => {
    // As after the user revoked the permission in the browser's add-on settings
    await setGestureAction(serviceWorker, SHIFT_ACTION, 'reopenClosedTab');
    const optionsPage = await openOptionsPage({ context, extensionId });
    const missing = optionsPage.getByText('needs access to the recently closed tabs');
    await expect(missing).toBeVisible();
    // Marks the row which needs it, and only that one
    await expect(optionsPage.getByText('Needs access', { exact: true }).filter({ visible: true })).toHaveCount(1);
    await expect(optionsPage.getByText('Needs access', { exact: true }).nth(1)).toBeVisible();

    await optionsPage.getByRole('button', { name: 'Grant access' }).click();
    await expect.poll(() => isSessionsPermissionGranted(serviceWorker)).toBe(true);
    await expect(missing).toBeHidden();
    await expect(optionsPage.getByText('Needs access', { exact: true }).filter({ visible: true })).toHaveCount(0);
});

test('when the browser does not ask for the permission, the choice stays and the page offers to grant it', async ({ context, serviceWorker, extensionId }) => {
    const optionsPage = await openOptionsPage({ context, extensionId });
    const shiftAction = optionsPage.getByRole('combobox', { name: 'Shift + Double right click' });
    await expect(shiftAction).toHaveValue('sameAsDoubleRightClick');

    // As when the browser does not take the change of a dropdown for the user's action
    await optionsPage.evaluate(() => {
        window.originalRequest = chrome.permissions.request;
        chrome.permissions.request = async function () {
            throw new Error('permissions.request may only be called from a user input handler');
        };
    });
    await chooseOption(shiftAction, 'Reopen the last closed tab');

    await expect.poll(() => serviceWorker.evaluate((setting) => chrome.storage.sync.get(setting), SHIFT_ACTION)).toEqual({
        [SHIFT_ACTION]: 'reopenClosedTab'
    });
    await expect(shiftAction).toHaveValue('reopenClosedTab');
    await expect(optionsPage.getByText('needs access to the recently closed tabs')).toBeVisible();

    await optionsPage.evaluate(() => {
        chrome.permissions.request = window.originalRequest;
    });
    await optionsPage.getByRole('button', { name: 'Grant access' }).click();
    await expect.poll(() => isSessionsPermissionGranted(serviceWorker)).toBe(true);
});

test('outside macOS, the hidden Cmd row neither asks for the permission nor keeps it', async ({ context, serviceWorker, extensionId }) => {
    // As when the setting got synced from a Mac
    await setGestureAction(serviceWorker, 'META_DOUBLE_RIGHT_CLICK_ACTION', 'reopenClosedTab');
    const optionsPage = await openOptionsPage({ context, extensionId });
    await expect(optionsPage.getByRole('combobox', { name: 'Shift + Double right click' })).toHaveValue('sameAsDoubleRightClick');

    await expect(optionsPage.getByText('needs access to the recently closed tabs')).toBeHidden();
});

test('once chosen, Shift + double right click reopens the tab which the gesture closed', async ({ context, serviceWorker, extensionId }) => {
    const optionsPage = await openOptionsPage({ context, extensionId });
    await chooseOption(optionsPage.getByRole('combobox', { name: 'Shift + Double right click' }), 'Reopen the last closed tab');
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

test('Shift + double right click closes the tab while nothing is set for it', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}shift-not-set`);
    const closed = page.waitForEvent('close');

    await doubleRightClick(page, { shiftOn: ['first', 'second'] });

    await closed;
    expect(page.isClosed()).toBe(true);
});

test('Shift + double right click reopens the last closed tab and keeps the tab open', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}shift-reopens`);
    await setGestureAction(serviceWorker, SHIFT_ACTION, 'reopenClosedTab');
    await stubReopenClosedTab(serviceWorker, RECENTLY_CLOSED);

    await doubleRightClick(page, { shiftOn: ['first', 'second'] });

    // The closed window is skipped
    await expect.poll(() => restoredSessionIds(serviceWorker)).toEqual(['closed-tab-newest']);
    await page.waitForTimeout(1000);
    expect(page.isClosed()).toBe(false);
});

test('Shift held on the first click only reopens the last closed tab', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}shift-on-first-click`);
    await setGestureAction(serviceWorker, SHIFT_ACTION, 'reopenClosedTab');
    await stubReopenClosedTab(serviceWorker, RECENTLY_CLOSED);

    await doubleRightClick(page, { shiftOn: ['first'] });

    await expect.poll(() => restoredSessionIds(serviceWorker)).toEqual(['closed-tab-newest']);
    await page.waitForTimeout(1000);
    expect(page.isClosed()).toBe(false);
});

test('Shift held on the second click only closes the tab', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}shift-on-second-click`);
    await setGestureAction(serviceWorker, SHIFT_ACTION, 'reopenClosedTab');
    await stubReopenClosedTab(serviceWorker, RECENTLY_CLOSED);
    const closed = page.waitForEvent('close');

    await doubleRightClick(page, { shiftOn: ['second'] });

    await closed;
    expect(await restoredSessionIds(serviceWorker)).toEqual([]);
});

test('double right click without Shift closes the tab while Shift reopens the last closed tab', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}no-shift-turned-on`);
    await setGestureAction(serviceWorker, SHIFT_ACTION, 'reopenClosedTab');
    await stubReopenClosedTab(serviceWorker, RECENTLY_CLOSED);
    const closed = page.waitForEvent('close');

    await doubleRightClick(page);

    await closed;
    expect(await restoredSessionIds(serviceWorker)).toEqual([]);
});

test('triple right click with Shift on the first click reopens one tab and keeps the tab open', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}shift-triple-click`);
    await setGestureAction(serviceWorker, SHIFT_ACTION, 'reopenClosedTab');
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
    await setGestureAction(serviceWorker, SHIFT_ACTION, 'reopenClosedTab');
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
    await setGestureAction(serviceWorker, SHIFT_ACTION, 'reopenClosedTab');
    await stubReopenClosedTab(serviceWorker, [RECENTLY_CLOSED[0]]);

    await doubleRightClick(page, { shiftOn: ['first', 'second'] });

    await page.waitForTimeout(1000);
    expect(await restoredSessionIds(serviceWorker)).toEqual([]);
    expect(page.isClosed()).toBe(false);
});

test('Shift + double right click set to reopen the last closed tab does nothing without the permission', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}shift-without-permission`);
    await setGestureAction(serviceWorker, SHIFT_ACTION, 'reopenClosedTab');
    const pagesBefore = context.pages().length;

    await doubleRightClick(page, { shiftOn: ['first', 'second'] });

    await page.waitForTimeout(1000);
    expect(page.isClosed()).toBe(false);
    expect(context.pages()).toHaveLength(pagesBefore);
});
