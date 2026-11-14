import {
    CANCEL_CONTEXT_MENU_PATH,
    expect,
    holdRightClick,
    openTestPage,
    test
} from './fixtures.js';

test.skip(process.platform !== 'linux', 'Only on Linux does the content script count "mousedown" as well');

test.describe('with a user agent overridden to another platform', () => {
    test.use({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' });

    test('Linux is still detected, so the second right click counts on "mousedown"', async ({ context, serviceWorker }) => {
        const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}overridden-user-agent`);
        expect(await page.evaluate(() => navigator.userAgent)).toContain('Windows');
        const closed = page.waitForEvent('close');

        await holdRightClick(page, 120);
        await page.waitForTimeout(150);
        // Pressed without releasing: where "mouseup" alone is counted, this would not close the tab
        await page.mouse.down({ button: 'right' });

        await closed;
        expect(page.isClosed()).toBe(true);
    });
});
