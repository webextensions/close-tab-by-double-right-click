import {
    OFFSET_FRAME_PATH,
    STALLED_HEAD_PATH,
    expect,
    openTestPage,
    restoredSessionIds,
    stubReopenClosedTab,
    test
} from './fixtures.js';

// In Chromium on Wayland, the open context menu swallows a second right click on the same spot. The page only receives
// a "mousemove" without buttons once the menu is closed, which the content script treats as the second right click.
// Playwright never opens the native context menu, so these tests replay that event sequence instead. They send it as
// browser-level input, since the content script ignores events which a page creates itself.
test.skip(process.platform !== 'linux', 'The content script only watches for the context menu closing on Linux');

const RIGHT_CLICK_POSITION = { x: 300, y: 200 };

// CDP's modifier bit for Shift
const SHIFT_MODIFIER = 8;

const rightClickThenCloseContextMenu = async function (page, { closedAfter, pointerAt = RIGHT_CLICK_POSITION, followedBy, moveFirst = true, withShift = false }) {
    const client = await page.context().newCDPSession(page);
    const sendMouseEvent = async function (type, position, button, modifiers = 0) {
        await client.send('Input.dispatchMouseEvent', {
            type,
            x: position.x,
            y: position.y,
            button,
            buttons: type === 'mousePressed' ? 2 : 0,
            clickCount: type === 'mouseMoved' ? 0 : 1,
            modifiers
        });
    };
    const sendShiftKeyEvent = async function (type) {
        await client.send('Input.dispatchKeyEvent', {
            type,
            key: 'Shift',
            code: 'ShiftLeft',
            windowsVirtualKeyCode: 16,
            modifiers: type === 'keyDown' ? SHIFT_MODIFIER : 0
        });
    };

    if (moveFirst) {
        await sendMouseEvent('mouseMoved', RIGHT_CLICK_POSITION, 'none');
    }
    if (withShift) {
        await sendShiftKeyEvent('keyDown');
    }
    // Never released: the context menu swallows the "mouseup"
    await sendMouseEvent('mousePressed', RIGHT_CLICK_POSITION, 'right', withShift ? SHIFT_MODIFIER : 0);
    await page.waitForTimeout(closedAfter);
    // Reports no Shift, even while it is held: that is what Chromium on Wayland sends
    await sendMouseEvent('mouseMoved', pointerAt, 'none');

    if (followedBy) {
        await page.waitForTimeout(20);
        if (followedBy === 'keyup') {
            await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        } else if (followedBy === 'shift-keyup') {
            await sendShiftKeyEvent('keyUp');
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

test('context menu closed quickly on a page which has not rendered anything yet closes the tab', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${STALLED_HEAD_PATH}menu-closed-quickly`, { waitUntil: 'commit' });
    const closed = page.waitForEvent('close');

    // Chromium only delivers a "mousemove" (and tells the sender so) with the next frame it renders, which takes 5
    // seconds on such a page. By then the tab is closed, which makes the pending call fail.
    await rightClickThenCloseContextMenu(page, { closedAfter: 200, moveFirst: false }).catch((err) => {
        if (!page.isClosed()) {
            throw err;
        }
    });

    await closed;
    expect(page.isClosed()).toBe(true);
});

test('context menu closed quickly inside a frame which is not at the top left corner of its page closes the tab', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${OFFSET_FRAME_PATH}menu-closed-quickly`);
    // The content script runs in a frame before the frame gets its body
    await page.frameLocator('iframe').locator('body').waitFor();
    const closed = page.waitForEvent('close');

    // The clicked spot is inside the frame, where the frame and the page count the pixels from different corners
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

test('context menu closed quickly after a Shift + right click reopens the last closed tab', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, '/menu-closed-after-shift');
    await stubReopenClosedTab(serviceWorker, [{ lastModified: 1, tab: { sessionId: 'closed-tab' } }]);

    // Shift gets released right after the menu closed, which the page learns before the gesture is confirmed
    await rightClickThenCloseContextMenu(page, { closedAfter: 200, withShift: true, followedBy: 'shift-keyup' });

    await expect.poll(() => restoredSessionIds(serviceWorker)).toEqual(['closed-tab']);
    await page.waitForTimeout(600);
    expect(page.isClosed()).toBe(false);
});
