import http from 'node:http';
import path from 'node:path';

import { test as base, chromium, expect } from '@playwright/test';

import {
    ASK_BEFORE_LEAVING_PAGE,
    CANCEL_CONTEXT_MENU_PAGE,
    OFFSET_FRAME_PAGE,
    PDF_FILE,
    STALLED_HEAD_CANCEL_CONTEXT_MENU_PAGE,
    STALLED_IMAGE_CANCEL_CONTEXT_MENU_PAGE,
    STALLED_PATH,
    SVG_PAGE,
    TEST_PAGE,
    isContentScriptReady
} from '../shared/test-pages.js';

const pathToChromeBuild = path.join(import.meta.dirname, '..', '..', 'dist', 'chrome');
const pathToSource = path.join(import.meta.dirname, '..', '..', 'extension');

const TEST_ORIGIN = 'https://drc.test';

const CANCEL_CONTEXT_MENU_PATH = '/cancel-context-menu/';
const ASK_BEFORE_LEAVING_PATH = '/ask-before-leaving/';
const OFFSET_FRAME_PATH = '/offset-frame/';
const PDF_PATH = '/pdf/';
const STALLED_HEAD_PATH = '/stalled-head/';
const STALLED_IMAGE_PATH = '/stalled-image/';
const SVG_PATH = '/svg/';

const test = base.extend({
    // The extension folder to load; "npm run test:e2e" builds dist/chrome first
    extensionPath: [pathToChromeBuild, { option: true }],
    context: async ({ headless, extensionPath, userAgent }, use) => {
        const context = await chromium.launchPersistentContext('', {
            channel: 'chromium',
            headless,
            userAgent,
            args: [
                `--disable-extensions-except=${extensionPath}`,
                `--load-extension=${extensionPath}`
            ]
        });

        // The content script only runs in http(s) pages, so serve the test pages from a fake https origin
        await context.route(`${TEST_ORIGIN}/**`, (route) => {
            const { pathname } = new URL(route.request().url());
            if (pathname.startsWith(STALLED_PATH)) {
                // Never answered
                return;
            }
            if (pathname.startsWith(SVG_PATH)) {
                return route.fulfill({ contentType: 'image/svg+xml', body: SVG_PAGE });
            }
            if (pathname.startsWith(PDF_PATH)) {
                return route.fulfill({ contentType: 'application/pdf', body: PDF_FILE });
            }
            let body = TEST_PAGE;
            if (pathname.startsWith(CANCEL_CONTEXT_MENU_PATH)) {
                body = CANCEL_CONTEXT_MENU_PAGE;
            } else if (pathname.startsWith(ASK_BEFORE_LEAVING_PATH)) {
                body = ASK_BEFORE_LEAVING_PAGE;
            } else if (pathname.startsWith(OFFSET_FRAME_PATH)) {
                body = OFFSET_FRAME_PAGE;
            } else if (pathname.startsWith(STALLED_HEAD_PATH)) {
                body = STALLED_HEAD_CANCEL_CONTEXT_MENU_PAGE;
            } else if (pathname.startsWith(STALLED_IMAGE_PATH)) {
                body = STALLED_IMAGE_CANCEL_CONTEXT_MENU_PAGE;
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

// For a page which never finishes loading, pass { waitUntil: 'commit' }
const openTestPage = async function ({ context, serviceWorker }, pathname, { waitUntil } = {}) {
    const url = `${TEST_ORIGIN}${pathname}`;
    const page = await context.newPage();
    await page.goto(url, { waitUntil });
    await expect.poll(() => isContentScriptReady(serviceWorker, url), { timeout: 15000 }).toBe(true);
    return page;
};

// A real click keeps the button down for a while, unlike Playwright's click(), which releases it at once. Only use it
// on a page which cancels the context menu: elsewhere Playwright fires "contextmenu" without opening a native menu,
// so the "mouseup" which that menu would swallow arrives and gets counted.
// Pass { movePointer: false } on a page which has not rendered anything yet: Chromium holds each "mousemove" back for
// 5 seconds there (unlike "mousedown" and "mouseup"), so the click then happens wherever the pointer already is.
const holdRightClick = async function (page, holdMs, { movePointer = true } = {}) {
    if (movePointer) {
        await page.mouse.move(100, 100);
    }
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

// A local server which sends the headers of its answer at once, and the page itself only when sendPage() gets called.
// Until then the tab shows the new document without anything in it. (A routed request cannot do that:
// route.fulfill() sends the whole answer at once.)
const startLatePageServer = async function () {
    let sendPage;
    const server = http.createServer((request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.flushHeaders();
        sendPage = () => response.end(CANCEL_CONTEXT_MENU_PAGE);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        url: `http://127.0.0.1:${server.address().port}/`,
        sendPage: () => sendPage(),
        close: () => {
            server.closeAllConnections();
            server.close();
        }
    };
};

const CONTEXT_MENU_ENTRY_ID = 'close-tab';

// chrome.contextMenus has no API to read the entries, but update() rejects for an id which does not exist
const contextMenuEntryExists = async function (serviceWorker) {
    return await serviceWorker.evaluate(async (menuItemId) => {
        try {
            await chrome.contextMenus.update(menuItemId, {});
            return true;
        } catch {
            return false;
        }
    }, CONTEXT_MENU_ENTRY_ID);
};

// Playwright cannot operate the native context menu, so dispatch the click event directly
const clickContextMenuEntry = async function (serviceWorker, url) {
    await serviceWorker.evaluate(async ({ menuItemId, url }) => {
        const [tab] = await chrome.tabs.query({ url });
        chrome.contextMenus.onClicked.dispatch({ menuItemId }, tab);
    }, { menuItemId: CONTEXT_MENU_ENTRY_ID, url });
};

export {
    ASK_BEFORE_LEAVING_PATH,
    CANCEL_CONTEXT_MENU_PATH,
    OFFSET_FRAME_PATH,
    PDF_PATH,
    STALLED_HEAD_PATH,
    STALLED_IMAGE_PATH,
    SVG_PATH,
    TEST_ORIGIN,
    clickContextMenuEntry,
    contextMenuEntryExists,
    expect,
    hasServiceWorkerRestarted,
    holdRightClick,
    openTestPage,
    pathToChromeBuild,
    pathToSource,
    startLatePageServer,
    stopServiceWorker,
    test
};
