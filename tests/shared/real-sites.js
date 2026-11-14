// The real sites, and what the Playwright tests against them and scripts/verify-chrome/verify-chrome.js share for
// opening them. The list is a JSON file, since scripts/verify-firefox/verify-firefox.py reads it as well.

import sites from './real-sites.json' with { type: 'json' };

// The sites to check in the given browser ('chrome' or 'firefox')
const sitesFor = function (browser) {
    return sites.filter((site) => !site.browsers || site.browsers.includes(browser));
};

// Opens the URL in the page. A site which cannot be reached (offline, DNS failure, timeout, browser error page) gets a
// second attempt; after that, this resolves to the reason instead of throwing.
// Pass 'commit' as waitUntil to get the page while it is still loading.
const openRealSite = async function (page, url, waitUntil = 'domcontentloaded') {
    for (let attempt = 1; ; attempt++) {
        try {
            await page.goto(url, { waitUntil, timeout: 30000 });
            break;
        } catch (err) {
            if (attempt === 2) {
                return `Could not open ${url}: ${err.message.split('\n')[0]}`;
            }
        }
    }
    if (waitUntil !== 'commit') {
        // Lets the page settle: some sites reload themselves or add frames right after they got loaded, and a double
        // right click cannot span two documents. Not required, since some sites never finish loading.
        await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    }
};

// The middle of the first element which matches the selector, as far as it is inside the viewport. Resolves to
// undefined when no such element is showing (the site served something else, or an overlay covers the page).
const findMiddleOfElement = async function (page, selector) {
    const locator = page.locator(selector).first();
    try {
        await locator.waitFor({ state: 'visible', timeout: 10000 });
        await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
        // A frame can wait with loading until it gets scrolled into view
        const frame = await (await locator.elementHandle()).contentFrame();
        if (frame) {
            await frame.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
        }
        const box = await locator.boundingBox();
        const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
        return {
            x: Math.round(Math.min(box.x + box.width / 2, viewport.width - 1)),
            y: Math.round(Math.min(box.y + box.height / 2, viewport.height - 1))
        };
    } catch {
        return undefined;
    }
};

export {
    findMiddleOfElement,
    openRealSite,
    sitesFor
};
