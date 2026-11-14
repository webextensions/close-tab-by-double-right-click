import {
    STALLED_HEAD_PATH,
    STALLED_IMAGE_PATH,
    expect,
    holdRightClick,
    openTestPage,
    test
} from './fixtures.js';

// A slow page can take minutes to load, and the double right click has to work in the meantime. The pages below never
// finish loading. They cancel the context menu, so the clicks can be held (see close-tab.spec.js).
// [name, path, expected state of the document, whether the page has rendered (see holdRightClick)]
const stalledPages = [
    ['a page which stalls in its <head>', STALLED_HEAD_PATH, { readyState: 'loading', hasBody: false }, false],
    ['a page which shows its content while an image keeps loading', STALLED_IMAGE_PATH, { readyState: 'interactive', hasBody: true }, true]
];

for (const [name, pathname, expectedState, movePointer] of stalledPages) {
    test.describe(name, () => {
        const openStalledPage = async function ({ context, serviceWorker }, pageName) {
            const page = await openTestPage({ context, serviceWorker }, `${pathname}${pageName}`, { waitUntil: 'commit' });
            await expect.poll(() => {
                return page.evaluate(() => ({ readyState: document.readyState, hasBody: !!document.body }));
            }).toEqual(expectedState);
            return page;
        };

        test('double right click closes the tab', async ({ context, serviceWorker }) => {
            const page = await openStalledPage({ context, serviceWorker }, 'double-right-click');
            const closed = page.waitForEvent('close');

            await holdRightClick(page, 120, { movePointer });
            await page.waitForTimeout(150);
            await holdRightClick(page, 120, { movePointer });

            await closed;
            expect(page.isClosed()).toBe(true);
        });

        test('single right click keeps the tab open', async ({ context, serviceWorker }) => {
            const page = await openStalledPage({ context, serviceWorker }, 'single-right-click');

            await holdRightClick(page, 120, { movePointer });
            await page.waitForTimeout(1000);

            expect(page.isClosed()).toBe(false);
        });
    });
}
