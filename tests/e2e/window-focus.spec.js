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

test('a tab getting active while no window has the focus is not reported as an error of the extension', async ({ context, serviceWorker, extensionId }) => {
    const extensionsPage = await collectRuntimeErrors({ context, extensionId });

    // The last window can get closed between a tab getting active and the background script asking for the focused
    // window, which then has none to give
    await serviceWorker.evaluate(async () => {
        globalThis.getLastFocusedCalls = 0;
        chrome.windows.getLastFocused = function (callback) {
            globalThis.getLastFocusedCalls++;
            callback(undefined);
        };
        const [tab] = await chrome.tabs.query({ active: true });
        chrome.tabs.onActivated.dispatch({ tabId: tab.id, windowId: tab.windowId });
    });
    await expect.poll(() => serviceWorker.evaluate(() => globalThis.getLastFocusedCalls)).toBeGreaterThan(0);
    await extensionsPage.waitForTimeout(1000);

    expect(await readRuntimeErrors(extensionsPage, extensionId)).toEqual([]);
});
