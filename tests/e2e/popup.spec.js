import {
    chooseOption,
    expect,
    setGestureAction,
    test
} from './fixtures.js';

// Opens the popup of the toolbar icon in a tab, at the URL the browser opens it from. Its buttons close it with
// window.close(), which only gets counted here, so that the test can read the page afterwards.
const openPopup = async function ({ context, serviceWorker }, { initScript } = {}) {
    const popupUrl = await serviceWorker.evaluate(() => chrome.action.getPopup({}));
    const popup = await context.newPage();
    if (initScript) {
        await popup.addInitScript(initScript);
    }
    await popup.goto(popupUrl);
    await popup.evaluate(() => {
        window.closeCalls = 0;
        window.close = function () {
            window.closeCalls += 1;
        };
        window.permissionRequests = 0;
        const request = chrome.permissions.request;
        chrome.permissions.request = function (...args) {
            window.permissionRequests += 1;
            return request.apply(this, args);
        };
    });
    return popup;
};

const closeCalls = async function (popup) {
    return await popup.evaluate(() => window.closeCalls);
};

// chrome.runtime.openOptionsPage() opens the options page in a new tab (chrome://extensions in Chromium)
const expectOptionsPage = async function (page, extensionId) {
    await expect.poll(() => page.url()).toMatch(new RegExp(`options=${extensionId}|^chrome-extension://${extensionId}/options\\.html$`));
};

test('the toolbar icon opens the options page as its popup, with its own layout', async ({ context, serviceWorker, extensionId }) => {
    expect(await serviceWorker.evaluate(() => chrome.action.getPopup({}))).toBe(`chrome-extension://${extensionId}/options.html?popup`);

    const popup = await openPopup({ context, serviceWorker });
    await expect(popup.locator('html')).toHaveClass('popup');
    await expect(popup.getByRole('button', { name: 'Open in a tab' })).toBeVisible();
    expect(await popup.evaluate(() => document.body.getBoundingClientRect().width)).toBe(340);

    // Not on the options page
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(optionsPage.locator('html')).not.toHaveClass('popup');
    await expect(optionsPage.getByRole('button', { name: 'Open in a tab' })).toBeHidden();
});

test('on macOS, the popup fits the height of a popup, and its width with the notices shown', async ({ context, serviceWorker }) => {
    const popup = await openPopup({ context, serviceWorker }, {
        initScript: () => {
            chrome.runtime.getPlatformInfo = async function () {
                return { os: 'mac', arch: 'arm', nacl_arch: 'arm' };
            };
        }
    });
    await expect(popup.getByRole('combobox', { name: 'Cmd + Double right click' })).toBeVisible();
    // Browsers show a popup at most 600 px high
    expect(await popup.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height))).toBeLessThanOrEqual(600);

    await setGestureAction(serviceWorker, 'SHIFT_DOUBLE_RIGHT_CLICK_ACTION', 'reopenClosedTab');
    await popup.reload();
    await expect(popup.getByRole('combobox', { name: 'Cmd + Double right click' })).toBeVisible();
    await expect(popup.getByText('Needs access', { exact: true }).nth(1)).toBeVisible();
    await expect(popup.getByText('needs access to the recently closed tabs')).toBeVisible();

    const widest = await popup.evaluate(() => {
        return Math.max(...[...document.body.querySelectorAll('*')].map((el) => el.getBoundingClientRect().right));
    });
    expect(widest).toBeLessThanOrEqual(340);
});

test('a change in the popup gets saved', async ({ context, serviceWorker }) => {
    const popup = await openPopup({ context, serviceWorker });

    await chooseOption(popup.getByRole('combobox', { name: 'Alt + Double right click' }), 'Duplicate the tab');
    await expect(popup.getByText('Saved')).toBeVisible();
    await expect.poll(() => serviceWorker.evaluate(() => chrome.storage.sync.get(null))).toEqual({
        ALT_DOUBLE_RIGHT_CLICK_ACTION: 'duplicateTab'
    });
    expect(await closeCalls(popup)).toBe(0);
});

test('choosing to reopen the last closed tab in the popup opens the options page instead of asking for the permission', async ({ context, serviceWorker, extensionId }) => {
    const popup = await openPopup({ context, serviceWorker });
    const shiftAction = popup.getByRole('combobox', { name: 'Shift + Double right click' });
    const newPage = context.waitForEvent('page');

    await chooseOption(shiftAction, 'Reopen the last closed tab');

    await expectOptionsPage(await newPage, extensionId);
    await expect(shiftAction).toHaveValue('sameAsDoubleRightClick');
    await expect.poll(() => closeCalls(popup)).toBe(1);
    expect(await popup.evaluate(() => window.permissionRequests)).toBe(0);
    expect(await serviceWorker.evaluate(() => chrome.storage.sync.get(null))).toEqual({});
});

test('with the permission granted, choosing to reopen the last closed tab in the popup saves it', async ({ context, serviceWorker, extensionId }) => {
    // Granted on the options page (Chromium grants it there without a prompt in the tests)
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await chooseOption(optionsPage.getByRole('combobox', { name: 'Ctrl + Double right click' }), 'Reopen the last closed tab');
    await expect.poll(() => serviceWorker.evaluate(() => chrome.permissions.contains({ permissions: ['sessions'] }))).toBe(true);
    await optionsPage.close();

    const popup = await openPopup({ context, serviceWorker });
    await expect(popup.getByRole('combobox', { name: 'Ctrl + Double right click' })).toHaveValue('reopenClosedTab');
    // The browser answers in order, so the popup has its own check of the permission by then
    expect(await popup.evaluate(() => chrome.permissions.contains({ permissions: ['sessions'] }))).toBe(true);

    await chooseOption(popup.getByRole('combobox', { name: 'Shift + Double right click' }), 'Reopen the last closed tab');

    await expect.poll(() => serviceWorker.evaluate(() => chrome.storage.sync.get(null))).toEqual({
        CTRL_DOUBLE_RIGHT_CLICK_ACTION: 'reopenClosedTab',
        SHIFT_DOUBLE_RIGHT_CLICK_ACTION: 'reopenClosedTab'
    });
    expect(await closeCalls(popup)).toBe(0);
    expect(await popup.evaluate(() => window.permissionRequests)).toBe(0);
});

test('"Grant access" in the popup opens the options page', async ({ context, serviceWorker, extensionId }) => {
    await setGestureAction(serviceWorker, 'SHIFT_DOUBLE_RIGHT_CLICK_ACTION', 'reopenClosedTab');
    const popup = await openPopup({ context, serviceWorker });
    const newPage = context.waitForEvent('page');

    await popup.getByRole('button', { name: 'Grant access' }).click();

    await expectOptionsPage(await newPage, extensionId);
    await expect.poll(() => closeCalls(popup)).toBe(1);
    expect(await popup.evaluate(() => window.permissionRequests)).toBe(0);
});

test('"Done" closes the popup, and "Open in a tab" opens the options page', async ({ context, serviceWorker, extensionId }) => {
    const popup = await openPopup({ context, serviceWorker });

    await popup.getByRole('button', { name: 'Done' }).click();
    expect(await closeCalls(popup)).toBe(1);

    const newPage = context.waitForEvent('page');
    await popup.getByRole('button', { name: 'Open in a tab' }).click();
    await expectOptionsPage(await newPage, extensionId);
    await expect.poll(() => closeCalls(popup)).toBe(2);
});
