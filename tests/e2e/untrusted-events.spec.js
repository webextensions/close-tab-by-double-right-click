import {
    TEST_ORIGIN,
    expect,
    openTestPage,
    test
} from './fixtures.js';

// Runs inside the page: the events of a double right click, created by a script instead of by real input
const dispatchFakeDoubleRightClick = async function () {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (let click = 0; click < 2; click++) {
        for (const type of ['mousedown', 'contextmenu', 'mouseup']) {
            document.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 100, clientY: 100, button: 2 }));
            await wait(60);
        }
    }
};

test('a double right click faked by the page keeps the tab open', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, '/fake-events');

    await page.evaluate(dispatchFakeDoubleRightClick);
    await page.waitForTimeout(1000);

    expect(page.isClosed()).toBe(false);
});

test('a double right click faked by a frame keeps the tab open', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, '/fake-events-in-frame');
    await page.evaluate(() => {
        const frame = document.createElement('iframe');
        frame.src = '/frame';
        document.body.append(frame);
    });
    const frame = page.frame({ url: `${TEST_ORIGIN}/frame` }) || await page.waitForEvent('framenavigated');
    // The background script injects the content script into new frames within 2.5 seconds
    await page.waitForTimeout(3500);

    await frame.evaluate(dispatchFakeDoubleRightClick).catch(() => {});
    await page.waitForTimeout(1000);

    expect(page.isClosed()).toBe(false);
});
