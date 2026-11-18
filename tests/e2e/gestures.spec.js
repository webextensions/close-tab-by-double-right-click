import { isContentScriptReady } from '../shared/test-pages.js';
import {
    CANCEL_CONTEXT_MENU_PATH,
    TEST_ORIGIN,
    expect,
    holdRightClick,
    openTestPage,
    setGestureAction,
    spyOnTabsReload,
    tabsReloadCalls,
    test
} from './fixtures.js';

// What each gesture does, as chosen on the options page. As in close-tab.spec.js, these tests use a page which cancels
// the context menu.

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

const tabCount = async function (serviceWorker) {
    return await serviceWorker.evaluate(async () => (await chrome.tabs.query({})).length);
};

// Reports whether the page has been loaded again since it got marked
const markPage = async function (page) {
    await page.evaluate(() => {
        window.markedBeforeGesture = true;
    });
};
const isPageMarked = async function (page) {
    return await page.evaluate(() => window.markedBeforeGesture === true);
};

test('double right click set to do nothing keeps the tab open', async ({ context, serviceWorker }) => {
    await setGestureAction(serviceWorker, 'DOUBLE_RIGHT_CLICK_ACTION', 'nothing');
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}nothing`);
    const tabsBefore = await tabCount(serviceWorker);

    await doubleRightClickWithKeys(page, []);

    await page.waitForTimeout(1000);
    expect(page.isClosed()).toBe(false);
    expect(await tabCount(serviceWorker)).toBe(tabsBefore);
});

test('double right click set to reload the tab reloads it', async ({ context, serviceWorker }) => {
    await setGestureAction(serviceWorker, 'DOUBLE_RIGHT_CLICK_ACTION', 'reload');
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}reload`);
    await markPage(page);
    await spyOnTabsReload(serviceWorker);

    await doubleRightClickWithKeys(page, []);

    await expect.poll(() => isPageMarked(page).catch(() => true)).toBe(false);
    expect(page.isClosed()).toBe(false);
    const calls = await tabsReloadCalls(serviceWorker);
    expect(calls).toHaveLength(1);
    expect(calls[0][1]?.bypassCache).toBeFalsy();
});

test('double right click set to hard reload the tab reloads it without the cache', async ({ context, serviceWorker }) => {
    await setGestureAction(serviceWorker, 'DOUBLE_RIGHT_CLICK_ACTION', 'hardReload');
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}hard-reload`);
    await markPage(page);
    await spyOnTabsReload(serviceWorker);

    await doubleRightClickWithKeys(page, []);

    await expect.poll(() => isPageMarked(page).catch(() => true)).toBe(false);
    expect(page.isClosed()).toBe(false);
    const calls = await tabsReloadCalls(serviceWorker);
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ bypassCache: true });
});

test('double right click set to go back goes back', async ({ context, serviceWorker }) => {
    await setGestureAction(serviceWorker, 'DOUBLE_RIGHT_CLICK_ACTION', 'goBack');
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}go-back-first`);
    const secondUrl = `${TEST_ORIGIN}${CANCEL_CONTEXT_MENU_PATH}go-back-second`;
    await page.goto(secondUrl);
    await expect.poll(() => isContentScriptReady(serviceWorker, secondUrl)).toBe(true);

    await doubleRightClickWithKeys(page, []);

    await expect.poll(() => page.url()).toBe(`${TEST_ORIGIN}${CANCEL_CONTEXT_MENU_PATH}go-back-first`);
});

test('double right click set to go back without history keeps the tab open', async ({ context, serviceWorker }) => {
    await setGestureAction(serviceWorker, 'DOUBLE_RIGHT_CLICK_ACTION', 'goBack');
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}go-back-without-history`);

    await doubleRightClickWithKeys(page, []);

    await page.waitForTimeout(1000);
    expect(page.isClosed()).toBe(false);
});

test('double right click set to open a new tab opens one', async ({ context, serviceWorker }) => {
    await setGestureAction(serviceWorker, 'DOUBLE_RIGHT_CLICK_ACTION', 'newTab');
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}new-tab`);
    const tabsBefore = await tabCount(serviceWorker);

    await doubleRightClickWithKeys(page, []);

    await expect.poll(() => tabCount(serviceWorker)).toBe(tabsBefore + 1);
    expect(page.isClosed()).toBe(false);
});

test('double right click set to duplicate the tab duplicates it', async ({ context, serviceWorker }) => {
    await setGestureAction(serviceWorker, 'DOUBLE_RIGHT_CLICK_ACTION', 'duplicateTab');
    const url = `${TEST_ORIGIN}${CANCEL_CONTEXT_MENU_PATH}duplicate`;
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}duplicate`);
    const duplicate = context.waitForEvent('page');

    await doubleRightClickWithKeys(page, []);

    await expect.poll(async () => (await duplicate).url()).toBe(url);
    expect(page.isClosed()).toBe(false);
});

for (const [key, setting] of [
    ['Shift', 'SHIFT_DOUBLE_RIGHT_CLICK_ACTION'],
    ['Control', 'CTRL_DOUBLE_RIGHT_CLICK_ACTION'],
    ['Alt', 'ALT_DOUBLE_RIGHT_CLICK_ACTION']
]) {
    test(`${key} + double right click does what is set for it`, async ({ context, serviceWorker }) => {
        await setGestureAction(serviceWorker, setting, 'nothing');
        const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}set-${key}`);

        await doubleRightClickWithKeys(page, [key]);

        await page.waitForTimeout(1000);
        expect(page.isClosed()).toBe(false);
    });

    test(`${key} + double right click does what the double right click does while nothing is set for it`, async ({ context, serviceWorker }) => {
        await setGestureAction(serviceWorker, 'DOUBLE_RIGHT_CLICK_ACTION', 'duplicateTab');
        await setGestureAction(serviceWorker, setting, 'sameAsDoubleRightClick');
        const url = `${TEST_ORIGIN}${CANCEL_CONTEXT_MENU_PATH}unset-${key}`;
        const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}unset-${key}`);
        const duplicate = context.waitForEvent('page');

        await doubleRightClickWithKeys(page, [key]);

        await expect.poll(async () => (await duplicate).url()).toBe(url);
        expect(page.isClosed()).toBe(false);
    });
}

test('double right click without a key ignores what is set for the keys', async ({ context, serviceWorker }) => {
    await setGestureAction(serviceWorker, 'SHIFT_DOUBLE_RIGHT_CLICK_ACTION', 'nothing');
    await setGestureAction(serviceWorker, 'CTRL_DOUBLE_RIGHT_CLICK_ACTION', 'nothing');
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}no-key`);
    const closed = page.waitForEvent('close');

    await doubleRightClickWithKeys(page, []);

    await closed;
});

test('double right click with two keys held does nothing, whatever is set for them', async ({ context, serviceWorker }) => {
    await setGestureAction(serviceWorker, 'SHIFT_DOUBLE_RIGHT_CLICK_ACTION', 'closeTab');
    await setGestureAction(serviceWorker, 'CTRL_DOUBLE_RIGHT_CLICK_ACTION', 'closeTab');
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}two-keys`);

    await doubleRightClickWithKeys(page, ['Shift', 'Control']);

    await page.waitForTimeout(1000);
    expect(page.isClosed()).toBe(false);
});

test('outside macOS, the Cmd key does not count', async ({ context, serviceWorker }) => {
    await setGestureAction(serviceWorker, 'META_DOUBLE_RIGHT_CLICK_ACTION', 'nothing');
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}meta-outside-mac`);
    const closed = page.waitForEvent('close');

    await doubleRightClickWithKeys(page, ['Meta']);

    await closed;
});

test('on macOS, Cmd + double right click does what is set for it', async ({ context, serviceWorker }) => {
    await setGestureAction(serviceWorker, 'META_DOUBLE_RIGHT_CLICK_ACTION', 'nothing');
    // A restart of the service worker drops this stand-in
    await serviceWorker.evaluate(() => {
        chrome.runtime.getPlatformInfo = async function () {
            return { os: 'mac', arch: 'arm', nacl_arch: 'arm' };
        };
    });
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}meta-on-mac`);

    await doubleRightClickWithKeys(page, ['Meta']);

    await page.waitForTimeout(1000);
    expect(page.isClosed()).toBe(false);
});
