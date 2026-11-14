import path from 'node:path';

import { test as base, chromium, expect } from '@playwright/test';

import {
    CANCEL_CONTEXT_MENU_PAGE,
    TEST_PAGE,
    isContentScriptReady
} from '../shared/test-pages.js';

const pathToChromeBuild = path.join(import.meta.dirname, '..', '..', 'dist', 'chrome');
const pathToSource = path.join(import.meta.dirname, '..', '..', 'extension');

const TEST_ORIGIN = 'https://drc.test';

const CANCEL_CONTEXT_MENU_PATH = '/cancel-context-menu/';

const test = base.extend({
    // The extension folder to load; "npm run test:e2e" builds dist/chrome first
    extensionPath: [pathToChromeBuild, { option: true }],
    context: async ({ headless, extensionPath }, use) => {
        const context = await chromium.launchPersistentContext('', {
            channel: 'chromium',
            headless,
            args: [
                `--disable-extensions-except=${extensionPath}`,
                `--load-extension=${extensionPath}`
            ]
        });

        // The background script only injects into http(s) pages, so serve the test pages from a fake https origin
        await context.route(`${TEST_ORIGIN}/**`, (route) => {
            const { pathname } = new URL(route.request().url());
            let body = TEST_PAGE;
            if (pathname.startsWith(CANCEL_CONTEXT_MENU_PATH)) {
                body = CANCEL_CONTEXT_MENU_PAGE;
            }
            return route.fulfill({ contentType: 'text/html', body });
        });

        await use(context);
        await context.close();
    },
    serviceWorker: async ({ context }, use) => {
        let [serviceWorker] = context.serviceWorkers();
        if (!serviceWorker) {
            serviceWorker = await context.waitForEvent('serviceworker');
        }
        await use(serviceWorker);
    },
    extensionId: async ({ serviceWorker }, use) => {
        await use(new URL(serviceWorker.url()).host);
    }
});

const openTestPage = async function ({ context, serviceWorker }, pathname) {
    const url = `${TEST_ORIGIN}${pathname}`;
    const page = await context.newPage();
    await page.goto(url);
    await expect.poll(() => isContentScriptReady(serviceWorker, url), { timeout: 15000 }).toBe(true);
    return page;
};

// A real click keeps the button down for a while, unlike Playwright's click(), which releases it at once. Only use it
// on a page which cancels the context menu: elsewhere Playwright fires "contextmenu" without opening a native menu,
// so the "mouseup" which that menu would swallow arrives and gets counted.
const holdRightClick = async function (page, holdMs) {
    await page.mouse.move(100, 100);
    try {
        await page.mouse.down({ button: 'right' });
        await page.waitForTimeout(holdMs);
        await page.mouse.up({ button: 'right' });
    } catch (err) {
        // On Linux the extension also counts "mousedown", so it can close the tab before this click's "mouseup"
        if (!page.isClosed()) {
            throw err;
        }
    }
};

// Simulates the browser stopping the idle extension service worker. The next extension event starts it again, and
// Playwright keeps using the same Worker object for the restarted service worker.
const stopServiceWorker = async function ({ context, serviceWorker }, page) {
    await serviceWorker.evaluate(() => {
        globalThis.setBeforeServiceWorkerStop = true;
    });

    const client = await context.newCDPSession(page);
    await client.send('ServiceWorker.enable');
    await client.send('ServiceWorker.stopAllWorkers');
    await client.detach();
};

const hasServiceWorkerRestarted = async function (serviceWorker) {
    return await serviceWorker.evaluate(() => globalThis.setBeforeServiceWorkerStop === undefined);
};

export {
    CANCEL_CONTEXT_MENU_PATH,
    TEST_ORIGIN,
    expect,
    hasServiceWorkerRestarted,
    holdRightClick,
    openTestPage,
    pathToChromeBuild,
    pathToSource,
    stopServiceWorker,
    test
};
