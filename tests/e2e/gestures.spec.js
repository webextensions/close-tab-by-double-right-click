import {
    CANCEL_CONTEXT_MENU_PATH,
    expect,
    holdRightClick,
    openTestPage,
    test
} from './fixtures.js';

// As in close-tab.spec.js, these tests use a page which cancels the context menu.

// Records the gestures which the content script reports, next to the background script's own listener
const recordReportedGestures = async function (serviceWorker) {
    await serviceWorker.evaluate(() => {
        globalThis.reportedGestures = [];
        chrome.runtime.onMessage.addListener(function (request) {
            globalThis.reportedGestures.push(request);
        });
    });
};

const reportedGestures = async function (serviceWorker) {
    return await serviceWorker.evaluate(() => globalThis.reportedGestures);
};

// Two right clicks, with the given keys held on the first one
const doubleRightClickWithKeys = async function (page, keys) {
    for (const key of keys) {
        await page.keyboard.down(key);
    }
    await holdRightClick(page, 120);
    for (const key of keys) {
        await page.keyboard.up(key);
    }
    await page.waitForTimeout(150);
    await holdRightClick(page, 120);
};

for (const [keys, modifiers] of [
    [[], { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false }],
    [['Shift'], { shiftKey: true, ctrlKey: false, altKey: false, metaKey: false }],
    [['Control'], { shiftKey: false, ctrlKey: true, altKey: false, metaKey: false }],
    [['Alt'], { shiftKey: false, ctrlKey: false, altKey: true, metaKey: false }],
    [['Meta'], { shiftKey: false, ctrlKey: false, altKey: false, metaKey: true }],
    [['Shift', 'Control'], { shiftKey: true, ctrlKey: true, altKey: false, metaKey: false }]
]) {
    const held = keys.length ? keys.join(' + ') : 'no key';
    test(`the content script reports ${held} held on the first click`, async ({ context, serviceWorker }) => {
        const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}keys-${keys.join('-')}`);
        await recordReportedGestures(serviceWorker);

        await doubleRightClickWithKeys(page, keys);

        await expect.poll(() => reportedGestures(serviceWorker)).toEqual([{ gesture: 'doubleRightClick', ...modifiers }]);
    });
}
