import {
    collectRuntimeErrors,
    expect,
    readRuntimeErrors,
    test
} from './fixtures.js';

test('focus moving to a window which is already gone is not reported as an error of the extension', async ({ context, serviceWorker, extensionId }) => {
    const extensionsPage = await collectRuntimeErrors({ context, extensionId });

    // The window can get closed between the focus change and the background script asking for its tabs
    await serviceWorker.evaluate(() => chrome.windows.onFocusChanged.dispatch(987654321));
    await extensionsPage.waitForTimeout(1000);

    expect(await readRuntimeErrors(extensionsPage, extensionId)).toEqual([]);
});
