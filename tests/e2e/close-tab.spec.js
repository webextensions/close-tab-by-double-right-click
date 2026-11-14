import {
    ASK_BEFORE_LEAVING_PATH,
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

test('double right click works again after the user chose to stay on the page', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${ASK_BEFORE_LEAVING_PATH}stay-then-leave`);
    // The browser only asks before leaving a page which the user has interacted with
    await page.mouse.click(100, 100);

    let dialogs = 0;
    page.on('dialog', async (dialog) => {
        dialogs += 1;
        if (dialogs === 1) {
            await dialog.dismiss(); // Stay on the page
        } else {
            await dialog.accept();
        }
    });

    await holdRightClick(page, 120);
    await page.waitForTimeout(150);
    await holdRightClick(page, 120);
    await expect.poll(() => dialogs).toBe(1);
    expect(page.isClosed()).toBe(false);

    // Both the content script and the background script ignore repeated close requests for 2.5 seconds
    await page.waitForTimeout(3000);
    const closed = page.waitForEvent('close');
    await holdRightClick(page, 120);
    await page.waitForTimeout(150);
    await holdRightClick(page, 120);

    await closed;
    expect(dialogs).toBe(2);
});

test('double right click inside a frame closes the tab', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, '/with-frame');
    await page.evaluate((src) => {
        const frame = document.createElement('iframe');
        frame.src = src;
        // Covers the spot which gets clicked, so the clicks only reach the frame's document
        frame.style.cssText = 'position:fixed;top:0;left:0;width:400px;height:300px;border:0';
        document.body.append(frame);
    }, `${CANCEL_CONTEXT_MENU_PATH}frame`);
    // The background script injects the content script into new frames within 2.5 seconds
    await page.waitForTimeout(3500);
    const closed = page.waitForEvent('close');

    await holdRightClick(page, 120);
    await page.waitForTimeout(150);
    await holdRightClick(page, 120);

    await closed;
    expect(page.isClosed()).toBe(true);
});

for (const button of ['left', 'middle']) {
    test(`double ${button} click keeps the tab open`, async ({ context, serviceWorker }) => {
        const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}double-${button}-click`);

        for (let click = 0; click < 2; click++) {
            await page.mouse.move(100, 100);
            await page.mouse.down({ button });
            await page.waitForTimeout(120);
            await page.mouse.up({ button });
            await page.waitForTimeout(150);
        }
        await page.waitForTimeout(1000);

        expect(page.isClosed()).toBe(false);
    });
}
