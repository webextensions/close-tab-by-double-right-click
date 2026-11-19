import { resolve4 } from 'node:dns/promises';

import { sitesFor } from '../shared/real-sites.js';
import {
    DEFAULT_POSITION,
    clickContextMenuEntry,
    contextMenuEntryExists,
    doubleRightClickAsDelivered,
    expect,
    followLink,
    openSite,
    resolveClickPosition,
    rightClickAsDelivered,
    stallSubresources,
    test
} from './fixtures.js';

// The extension against real sites. Playwright never opens the native context menu, so these tests replay what a
// browser on Linux delivers to the page around that menu (see doubleRightClickAsDelivered). Only the real-input
// scripts ("npm run verify:chrome:sites" and "npm run verify:firefox:sites") click through a real menu.

test.describe.configure({ mode: 'parallel' });

const expectTabToClose = async function ({ page }) {
    await expect.poll(() => page.isClosed(), { timeout: 5000 }).toBe(true);
};

const expectTabToStayOpen = async function ({ page }) {
    await page.waitForTimeout(1000);
    expect(page.isClosed()).toBe(false);
};

// amazon.com gets answered by one of two networks, which its DNS picks for a minute at a time. The less common one
// (Akamai) starts with a bot check which makes a synchronous request. This entry tells the browser to reach amazon.com
// through that network, so that the page gets tested in every run and not only in the rare one where DNS picks it.
const AMAZON_AKAMAI_HOST = 'www.amazon.com.edgekey.net';
const [amazonAkamaiAddress] = await resolve4(AMAZON_AKAMAI_HOST).catch(() => []);
const amazonThroughAkamai = {
    name: 'amazon.com through Akamai (a bot check which makes a synchronous request)',
    url: 'https://www.amazon.com/',
    browserArgs: [`--host-resolver-rules=MAP www.amazon.com ${amazonAkamaiAddress}`],
    unavailable: amazonAkamaiAddress ? undefined : `Could not look up ${AMAZON_AKAMAI_HOST}`
};

for (const site of [...sitesFor('chrome'), amazonThroughAkamai]) {
    test.describe(site.name, () => {
        // The tests of one site run one after the other, so no site gets opened by two of them at once
        test.describe.configure({ mode: 'default' });
        test.skip(!!site.unavailable, site.unavailable);
        if (site.browserArgs) {
            test.use({ extraBrowserArgs: site.browserArgs });
        }

        if (site.kind === 'menu-entry') {
            test('"Close tab" context menu entry is there and closes the tab', async ({ context, serviceWorker }) => {
                const sitePage = await openSite({ context, serviceWorker }, site.url, { contentScript: false });
                await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(true);

                await clickContextMenuEntry(serviceWorker, sitePage.page.url());

                await expectTabToClose(sitePage);
            });
            return;
        }

        test.skip(process.platform !== 'linux', 'The replayed double right clicks are the ones of the browsers on Linux');

        test('single and slow right clicks keep the tab open, a double right click closes it', async ({ context, serviceWorker }) => {
            const sitePage = await openSite({ context, serviceWorker }, site.url);
            if (site.insecureContext) {
                expect(await sitePage.page.evaluate(() => window.isSecureContext)).toBe(false);
            }
            await expect.poll(() => contextMenuEntryExists(serviceWorker)).toBe(false);
            const position = await resolveClickPosition(sitePage, site);

            await rightClickAsDelivered(sitePage, position);
            await expectTabToStayOpen(sitePage);

            // Slower than the default 500 ms
            await doubleRightClickAsDelivered(sitePage, position, { secondClickAfter: 800 });
            await expectTabToStayOpen(sitePage);

            await doubleRightClickAsDelivered(sitePage, position);
            await expectTabToClose(sitePage);
        });

        for (const [sequence, browser] of [['chromium-wayland', 'Chromium on Wayland'], ['firefox', 'Firefox']]) {
            test(`double right click closes the tab, delivered as by ${browser}`, async ({ context, serviceWorker }) => {
                const sitePage = await openSite({ context, serviceWorker }, site.url);
                const position = await resolveClickPosition(sitePage, site);

                await doubleRightClickAsDelivered(sitePage, position, { sequence });

                await expectTabToClose(sitePage);
            });
        }

        test('double right click closes the tab while the page is still loading', async ({ context, serviceWorker }) => {
            // Without this, a real site would be done loading before the clicks, or would change under them
            await stallSubresources(context);
            const sitePage = await openSite({ context, serviceWorker }, site.url, { waitUntil: 'commit' });

            // Most pages have not rendered anything at this point
            await doubleRightClickAsDelivered(sitePage, DEFAULT_POSITION, { awaitPointerMove: false });

            await expectTabToClose(sitePage);
        });

        if (!site.target && !site.frame) {
            test('double right click closes the tab after following a link to another page of the site', async ({ context, serviceWorker }) => {
                const sitePage = await openSite({ context, serviceWorker }, site.url);
                const linkedUrl = await sitePage.page.evaluate(() => {
                    const withoutHash = (url) => url.split('#')[0];
                    const link = [...document.querySelectorAll('a[href]')].find((a) => {
                        return a.origin === location.origin && withoutHash(a.href) !== withoutHash(location.href);
                    });
                    return link ? link.href : null;
                });
                test.skip(!linkedUrl, 'The page has no link to another page of the same site');

                await followLink(sitePage, linkedUrl);
                await doubleRightClickAsDelivered(sitePage, DEFAULT_POSITION);

                await expectTabToClose(sitePage);
            });
        }
    });
}
