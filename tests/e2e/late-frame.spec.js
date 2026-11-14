import { CANCEL_CONTEXT_MENU_PAGE } from '../shared/test-pages.js';
import {
    LATE_FRAME_PATH,
    TEST_ORIGIN,
    expect,
    holdRightClick,
    openTestPage,
    test
} from './fixtures.js';

// A frame which still waits for its own page shows an empty placeholder document, in which the browser does not run
// the content script. The content script of the page around the frame listens there instead.

const POSITION = { x: 300, y: 200 };

test.describe('a frame whose own page never arrives', () => {
    // The placeholder cannot cancel the context menu, so a real browser opens it and swallows the release of the first
    // right click. Playwright never opens it, so these tests leave the releases out, and Linux is where the content
    // script counts the presses.
    test.skip(process.platform !== 'linux', 'Only on Linux does the content script count "mousedown" as well');

    const openPageWithLateFrame = async function ({ context, serviceWorker }, pageName) {
        const page = await openTestPage({ context, serviceWorker }, `${LATE_FRAME_PATH}${pageName}`, { waitUntil: 'commit' });
        await page.locator('iframe').waitFor();
        // Onto the frame, as the pointer of a user is before any click there
        await page.mouse.move(POSITION.x, POSITION.y);
        return page;
    };

    test('double right click on the frame closes the tab', async ({ context, serviceWorker }) => {
        const page = await openPageWithLateFrame({ context, serviceWorker }, 'double-right-click');
        const closed = page.waitForEvent('close');

        await page.mouse.down({ button: 'right' });
        await page.waitForTimeout(270);
        await page.mouse.down({ button: 'right' }).catch(() => {});

        await closed;
        expect(page.isClosed()).toBe(true);
    });

    test('single right click on the frame keeps the tab open', async ({ context, serviceWorker }) => {
        const page = await openPageWithLateFrame({ context, serviceWorker }, 'single-right-click');

        await page.mouse.down({ button: 'right' });
        await page.waitForTimeout(1000);

        expect(page.isClosed()).toBe(false);
    });

    test('a right click on the page and one on the frame count together', async ({ context, serviceWorker }) => {
        const page = await openPageWithLateFrame({ context, serviceWorker }, 'page-then-frame');
        // Uncovers the upper part of the page
        await page.locator('iframe').evaluate((frame) => {
            frame.style.top = '300px';
        });
        const closed = page.waitForEvent('close');

        await page.mouse.move(POSITION.x, 100);
        await page.mouse.down({ button: 'right' });
        await page.waitForTimeout(150);
        await page.mouse.move(POSITION.x, 400);
        await page.waitForTimeout(120);
        await page.mouse.down({ button: 'right' }).catch(() => {});

        await closed;
        expect(page.isClosed()).toBe(true);
    });
});

test('a frame whose page arrived after the pointer was on it counts each right click once', async ({ context, serviceWorker }) => {
    const frameUrl = `${TEST_ORIGIN}/slow-frame`;
    let answerFrame;
    const frameAnswered = new Promise((resolve) => {
        answerFrame = resolve;
    });
    // Cancels the context menu, so that the clicks can be held (see close-tab.spec.js)
    await context.route(frameUrl, async (route) => {
        await frameAnswered;
        await route.fulfill({ contentType: 'text/html', body: CANCEL_CONTEXT_MENU_PAGE });
    });
    const page = await openTestPage({ context, serviceWorker }, '/with-slow-frame');
    await page.evaluate((src) => {
        const frame = document.createElement('iframe');
        frame.src = src;
        frame.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;border:0';
        document.body.append(frame);
    }, frameUrl);
    // While the frame still shows its placeholder
    await page.mouse.move(POSITION.x, POSITION.y);
    await page.waitForTimeout(200);
    answerFrame();
    await page.frameLocator('iframe').locator('body').waitFor();

    await holdRightClick(page, 120);
    await page.waitForTimeout(1000);
    expect(page.isClosed()).toBe(false);

    const closed = page.waitForEvent('close');
    await holdRightClick(page, 120);
    await page.waitForTimeout(150);
    await holdRightClick(page, 120);

    await closed;
    expect(page.isClosed()).toBe(true);
});
