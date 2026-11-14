import {
    expect,
    openTestPage,
    test
} from './fixtures.js';

// In Chromium on Wayland, the open context menu swallows a second right click on the same spot. The page only receives
// a "mousemove" without buttons once the menu is closed, which the content script treats as the second right click.
// Playwright never opens the native context menu, so these tests replay that event sequence instead. They send it as
// browser-level input, since the content script ignores events which a page creates itself.
test.skip(process.platform !== 'linux', 'The content script only watches for the context menu closing on Linux');

const RIGHT_CLICK_POSITION = { x: 300, y: 200 };

const rightClickThenCloseContextMenu = async function (page, { closedAfter, pointerAt = RIGHT_CLICK_POSITION, followedBy }) {
    const client = await page.context().newCDPSession(page);
    const sendMouseEvent = async function (type, position, button) {
        await client.send('Input.dispatchMouseEvent', {
            type,
            x: position.x,
            y: position.y,
            button,
            buttons: type === 'mousePressed' ? 2 : 0,
            clickCount: type === 'mouseMoved' ? 0 : 1
        });
    };

    await sendMouseEvent('mouseMoved', RIGHT_CLICK_POSITION, 'none');
    // Never released: the context menu swallows the "mouseup"
    await sendMouseEvent('mousePressed', RIGHT_CLICK_POSITION, 'right');
    await page.waitForTimeout(closedAfter);
    await sendMouseEvent('mouseMoved', pointerAt, 'none');

    if (followedBy) {
        await page.waitForTimeout(20);
        if (followedBy === 'keyup') {
            await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        } else {
            await sendMouseEvent('mouseReleased', pointerAt, 'left');
        }
    }
};

test('context menu closed quickly without moving the pointer closes the tab', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, '/menu-closed-quickly');
    const closed = page.waitForEvent('close');

    await rightClickThenCloseContextMenu(page, { closedAfter: 200 });

    await closed;
    expect(page.isClosed()).toBe(true);
});

test('context menu closed after more than the default 500 ms keeps the tab open', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, '/menu-closed-slowly');

    await rightClickThenCloseContextMenu(page, { closedAfter: 800 });
    await page.waitForTimeout(600);

    expect(page.isClosed()).toBe(false);
});

test('context menu closed with the pointer moved away keeps the tab open', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, '/menu-closed-pointer-moved');

    await rightClickThenCloseContextMenu(page, { closedAfter: 200, pointerAt: { x: 360, y: 280 } });
    await page.waitForTimeout(600);

    expect(page.isClosed()).toBe(false);
});

test('context menu closed through a quick key press keeps the tab open', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, '/menu-closed-by-keyboard');

    await rightClickThenCloseContextMenu(page, { closedAfter: 200, followedBy: 'keyup' });
    await page.waitForTimeout(600);

    expect(page.isClosed()).toBe(false);
});

test('context menu closed by a click which reaches the page keeps the tab open', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, '/menu-closed-by-click');

    await rightClickThenCloseContextMenu(page, { closedAfter: 200, followedBy: 'mouseup' });
    await page.waitForTimeout(600);

    expect(page.isClosed()).toBe(false);
});
