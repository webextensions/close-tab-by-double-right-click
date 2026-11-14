import {
    expect,
    test
} from './fixtures.js';

test('focus moving to a window which is already gone is not reported as an error of the extension', async ({ context, serviceWorker, extensionId }) => {
    const extensionsPage = await context.newPage();
    await extensionsPage.goto('chrome://extensions/');
    // chrome.developerPrivate is the API the chrome://extensions page itself uses. It only collects the errors of an
    // extension in developer mode.
    await extensionsPage.evaluate(async (extensionId) => {
        await chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true });
        await chrome.developerPrivate.updateExtensionConfiguration({ extensionId, errorCollection: true });
    }, extensionId);

    // The window can get closed between the focus change and the background script asking for its tabs
    await serviceWorker.evaluate(() => chrome.windows.onFocusChanged.dispatch(987654321));
    await extensionsPage.waitForTimeout(1000);

    const runtimeErrors = await extensionsPage.evaluate(async (extensionId) => {
        const info = await chrome.developerPrivate.getExtensionInfo(extensionId);
        return info.runtimeErrors.map((error) => error.message);
    }, extensionId);
    expect(runtimeErrors).toEqual([]);
});
