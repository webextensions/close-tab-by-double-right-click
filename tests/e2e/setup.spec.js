import { CANCEL_CONTEXT_MENU_PAGE } from '../shared/test-pages.js';
import {
    CANCEL_CONTEXT_MENU_PATH,
    SVG_PATH,
    expect,
    holdRightClick,
    openTestPage,
    test
} from './fixtures.js';

const doubleRightClick = async function (page) {
    await holdRightClick(page, 120);
    await page.waitForTimeout(150);
    await holdRightClick(page, 120);
};

test('double right click works again after the page rewrote itself', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}rewritten`);
    const closed = page.waitForEvent('close');

    // document.open() erases every event listener of the document and its window
    await page.evaluate((html) => {
        document.open();
        document.write(html);
        document.close();
    }, CANCEL_CONTEXT_MENU_PAGE);
    // The content script notices that and attaches its listeners again
    await doubleRightClick(page);

    await closed;
    expect(page.isClosed()).toBe(true);
});

test('double right click closes a document without a body', async ({ context, serviceWorker }) => {
    const page = await openTestPage({ context, serviceWorker }, `${SVG_PATH}image.svg`);
    const closed = page.waitForEvent('close');

    await doubleRightClick(page);

    await closed;
    expect(page.isClosed()).toBe(true);
});
