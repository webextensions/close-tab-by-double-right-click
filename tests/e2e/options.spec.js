import {
    expect,
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
