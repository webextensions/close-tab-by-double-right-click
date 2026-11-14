import {
    CANCEL_CONTEXT_MENU_PATH,
    expect,
    holdRightClick,
    openTestPage,
    test
} from './fixtures.js';

// Playwright never opens the native context menu, so both the "mousedown" and the "mouseup" of a right click reach the
// page. A real browser only behaves like that on a page which cancels the context menu, so these tests use such a page,
// and keep the button down for as long as a real click does. On Linux the content script counts "mousedown" as well,
// and must not count the same click twice.

test('double right click closes the tab', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}double-right-click`);
    const closed = page.waitForEvent('close');

    await holdRightClick(page, 120);
    await page.waitForTimeout(150);
    await holdRightClick(page, 120);

    await closed;
    expect(page.isClosed()).toBe(true);
});

test('single right click keeps the tab open', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}single-right-click`);

    await holdRightClick(page, 120);
    await page.waitForTimeout(1000);

    expect(page.isClosed()).toBe(false);
});

test('right clicks slower than the default 500 ms keep the tab open', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}slow-right-clicks`);

    await holdRightClick(page, 120);
    await page.waitForTimeout(800);
    await holdRightClick(page, 120);
    await page.waitForTimeout(1000);

    expect(page.isClosed()).toBe(false);
});
