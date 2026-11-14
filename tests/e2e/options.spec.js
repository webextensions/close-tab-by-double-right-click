import {
    CANCEL_CONTEXT_MENU_PATH,
    expect,
    holdRightClick,
    openTestPage,
    test
} from './fixtures.js';

const setCustomMaxTimeBetweenClicks = async function ({ context, serviceWorker, extensionId }, value) {
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);

    await expect(optionsPage.getByRole('radio', { name: /Default/ })).toBeChecked();

    await optionsPage.getByRole('combobox').selectOption(value);
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
    await expect(optionsPage.getByRole('combobox')).toHaveValue('1000');
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
