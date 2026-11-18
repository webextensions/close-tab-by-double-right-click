import {
    CANCEL_CONTEXT_MENU_PATH,
    chooseOption,
    expect,
    holdRightClick,
    openTestPage,
    test
} from './fixtures.js';

const setCustomMaxTimeBetweenClicks = async function ({ context, serviceWorker, extensionId }, value) {
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);

    await expect(optionsPage.getByRole('radio', { name: /Default/ })).toBeChecked();

    await optionsPage.getByRole('combobox', { name: 'Maximum time between clicks' }).selectOption(value);
    await expect(optionsPage.getByText('Your change would apply next time onwards')).toBeVisible();
    await expect.poll(() => serviceWorker.evaluate(() => chrome.storage.sync.get(null))).toEqual({
        MAXIMUM_TIME_BETWEEN_CLICKS_TYPE: 'custom',
        MAXIMUM_TIME_BETWEEN_CLICKS_VALUE: value
    });

    return optionsPage;
};

test('choosing a custom maximum time persists across reloads', async ({ context, serviceWorker, extensionId }) => {
    const optionsPage = await setCustomMaxTimeBetweenClicks({ context, serviceWorker, extensionId }, '1000');

    await optionsPage.reload();

    await expect(optionsPage.getByRole('radio', { name: /Custom/ })).toBeChecked();
    await expect(optionsPage.getByRole('combobox', { name: 'Maximum time between clicks' })).toHaveValue('1000');
});

test('custom maximum time of 1000 ms closes the tab on right clicks 800 ms apart', async ({ context, serviceWorker, extensionId }) => {
    await setCustomMaxTimeBetweenClicks({ context, serviceWorker, extensionId }, '1000');

    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}custom-max-time`);
    const closed = page.waitForEvent('close');

    await holdRightClick(page, 120);
    await page.waitForTimeout(680);
    await holdRightClick(page, 120);

    await closed;
    expect(page.isClosed()).toBe(true);
});

test('choosing "Default" again brings back the default 500 ms', async ({ context, serviceWorker, extensionId }) => {
    const optionsPage = await setCustomMaxTimeBetweenClicks({ context, serviceWorker, extensionId }, '1000');

    await optionsPage.getByRole('radio', { name: /Default/ }).check();
    await expect.poll(() => serviceWorker.evaluate(() => chrome.storage.sync.get('MAXIMUM_TIME_BETWEEN_CLICKS_TYPE'))).toEqual({
        MAXIMUM_TIME_BETWEEN_CLICKS_TYPE: 'default'
    });

    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}default-again`);

    await holdRightClick(page, 120);
    await page.waitForTimeout(680);
    await holdRightClick(page, 120);
    await page.waitForTimeout(1000);

    expect(page.isClosed()).toBe(false);
});

test('"Done" shows the note when the options page stays open', async ({ context, extensionId }) => {
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);

    // Chromium closes the page here; Firefox keeps it open inside about:addons
    await optionsPage.evaluate(() => {
        window.close = function () {};
    });

    await optionsPage.getByRole('button', { name: 'Done' }).click();
    await expect(optionsPage.getByText('Your change would apply next time onwards')).toBeVisible();
});

const GESTURE_ROWS = [
    ['Double right click', 'closeTab'],
    ['Shift + double right click', 'sameAsDoubleRightClick'],
    ['Ctrl + double right click', 'sameAsDoubleRightClick'],
    ['Alt + double right click', 'sameAsDoubleRightClick']
];

test('the gestures start with the double right click closing the tab and nothing set for the keys', async ({ context, extensionId }) => {
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);

    for (const [name, value] of GESTURE_ROWS) {
        await expect(optionsPage.getByRole('combobox', { name, exact: true })).toHaveValue(value);
    }
    // Only on macOS
    await expect(optionsPage.getByRole('combobox', { name: 'Cmd + double right click' })).toBeHidden();
    await expect(optionsPage.getByRole('combobox', { name: 'Double right click', exact: true }).locator('option')).toHaveText([
        'Do nothing',
        'Close the tab',
        'Go back',
        'Reload the tab',
        'Open a new tab',
        'Duplicate the tab',
        'Reopen the last closed tab'
    ]);
    await expect(optionsPage.getByRole('combobox', { name: 'Alt + double right click' }).locator('option').first()).toHaveText(
        'Same as double right click'
    );
});

test('on macOS, the options page shows the Cmd key and calls the Alt key Option', async ({ context, extensionId }) => {
    const optionsPage = await context.newPage();
    await optionsPage.addInitScript(() => {
        chrome.runtime.getPlatformInfo = async function () {
            return { os: 'mac', arch: 'arm', nacl_arch: 'arm' };
        };
    });
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);

    await expect(optionsPage.getByRole('combobox', { name: 'Cmd + double right click' })).toHaveValue('sameAsDoubleRightClick');
    await expect(optionsPage.getByRole('combobox', { name: 'Option + double right click' })).toBeVisible();
});

test('choosing what a gesture does saves it and shows the note', async ({ context, serviceWorker, extensionId }) => {
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    const altAction = optionsPage.getByRole('combobox', { name: 'Alt + double right click' });

    await chooseOption(altAction, 'Duplicate the tab');
    await expect(optionsPage.getByText('Saved')).toBeVisible();
    await expect.poll(() => serviceWorker.evaluate(() => chrome.storage.sync.get(null))).toEqual({
        ALT_DOUBLE_RIGHT_CLICK_ACTION: 'duplicateTab'
    });

    await optionsPage.reload();
    await expect(altAction).toHaveValue('duplicateTab');
});

test('the choice applies to the next gesture, without loading the page again', async ({ context, serviceWorker, extensionId }) => {
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}applies-at-once`);

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await chooseOption(optionsPage.getByRole('combobox', { name: 'Double right click', exact: true }), 'Do nothing');
    await expect.poll(() => serviceWorker.evaluate(() => chrome.storage.sync.get(null))).toEqual({
        DOUBLE_RIGHT_CLICK_ACTION: 'nothing'
    });
    await optionsPage.close();

    await page.bringToFront();
    await holdRightClick(page, 120);
    await page.waitForTimeout(150);
    await holdRightClick(page, 120);
    await page.waitForTimeout(1000);

    expect(page.isClosed()).toBe(false);
});

test('arrow keys move through the actions without asking for a permission on the way', async ({ context, serviceWorker, extensionId }) => {
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.evaluate(() => {
        window.permissionRequests = 0;
        chrome.permissions.request = async function () {
            window.permissionRequests += 1;
            return false;
        };
    });
    const doubleRightClickAction = optionsPage.getByRole('combobox', { name: 'Double right click', exact: true });

    await doubleRightClickAction.focus();
    for (let i = 0; i < 4; i++) {
        await optionsPage.keyboard.press('ArrowDown');
    }

    await expect(doubleRightClickAction).toHaveValue('duplicateTab');
    await expect.poll(() => serviceWorker.evaluate(() => chrome.storage.sync.get(null))).toEqual({
        DOUBLE_RIGHT_CLICK_ACTION: 'duplicateTab'
    });
    expect(await optionsPage.evaluate(() => window.permissionRequests)).toBe(0);
});
