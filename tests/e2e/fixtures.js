import http from 'node:http';
import path from 'node:path';

import { test as base, chromium, expect } from '@playwright/test';

import {
    ASK_BEFORE_LEAVING_PAGE,
    BUSY_CONTEXT_MENU_PAGE,
    BUSY_MOUSEDOWN_PAGE,
    CANCEL_CONTEXT_MENU_PAGE,
    LATE_FRAME_PAGE,
    OFFSET_FRAME_PAGE,
    PDF_FILE,
    STALLED_HEAD_CANCEL_CONTEXT_MENU_PAGE,
    STALLED_IMAGE_CANCEL_CONTEXT_MENU_PAGE,
    STALLED_PATH,
    SVG_PAGE,
    TEST_PAGE,
    chooseOption,
    isContentScriptReady,
    readContentScriptMaxTime
} from '../shared/test-pages.js';

const pathToChromeBuild = path.join(import.meta.dirname, '..', '..', 'dist', 'chrome');
const pathToSource = path.join(import.meta.dirname, '..', '..', 'extension');

const TEST_ORIGIN = 'https://drc.test';

const CANCEL_CONTEXT_MENU_PATH = '/cancel-context-menu/';
const ASK_BEFORE_LEAVING_PATH = '/ask-before-leaving/';
const BUSY_CONTEXT_MENU_PATH = '/busy-context-menu/';
const BUSY_MOUSEDOWN_PATH = '/busy-mousedown/';
const LATE_FRAME_PATH = '/late-frame/';
const OFFSET_FRAME_PATH = '/offset-frame/';
const PDF_PATH = '/pdf/';
const STALLED_HEAD_PATH = '/stalled-head/';
const STALLED_IMAGE_PATH = '/stalled-image/';
const SVG_PATH = '/svg/';

const test = base.extend({
    // The extension folder to load; "npm run test:e2e" builds dist/chrome first
    extensionPath: [pathToChromeBuild, { option: true }],
    // More command line arguments for the browser
    extraBrowserArgs: [[], { option: true }],
    context: async ({ headless, extensionPath, extraBrowserArgs, userAgent }, use) => {
        const context = await chromium.launchPersistentContext('', {
            channel: 'chromium',
            headless,
            userAgent,
            args: [
                `--disable-extensions-except=${extensionPath}`,
                `--load-extension=${extensionPath}`,
                ...extraBrowserArgs
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
            } else if (pathname.startsWith(BUSY_CONTEXT_MENU_PATH)) {
                body = BUSY_CONTEXT_MENU_PAGE;
            } else if (pathname.startsWith(BUSY_MOUSEDOWN_PATH)) {
                body = BUSY_MOUSEDOWN_PAGE;
            } else if (pathname.startsWith(OFFSET_FRAME_PATH)) {
                body = OFFSET_FRAME_PAGE;
            } else if (pathname.startsWith(LATE_FRAME_PATH)) {
                body = LATE_FRAME_PAGE;
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
// Pass { awaitPress: false } on a page which is busy with the press: Playwright waits until the page has handled it,
// and a real button gets released meanwhile.
const holdRightClick = async function (page, holdMs, { movePointer = true, awaitPress = true } = {}) {
    if (movePointer) {
        await page.mouse.move(100, 100);
    }
    try {
        const pressed = page.mouse.down({ button: 'right' });
        if (awaitPress) {
            await pressed;
        } else {
            // Awaited below
            pressed.catch(() => {});
        }
        await page.waitForTimeout(holdMs);
        await page.mouse.up({ button: 'right' });
        await pressed;
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

// Lets a gesture set to reopen the last closed tab do that without the browser's permission prompt, which Playwright
// cannot answer: the service worker gets told that the optional "sessions" permission is granted, and gets
// a stand-in for chrome.sessions, which lists the given sessions as closed and records which ones got restored (read
// them with restoredSessionIds). A restart of the service worker drops these stand-ins.
const stubReopenClosedTab = async function (serviceWorker, recentlyClosed) {
    await serviceWorker.evaluate((recentlyClosed) => {
        globalThis.restoredSessionIds = [];
        chrome.permissions.contains = async function () {
            return true;
        };
        chrome.sessions = {
            getRecentlyClosed: async function () {
                return recentlyClosed;
            },
            restore: async function (sessionId) {
                globalThis.restoredSessionIds.push(sessionId);
            }
        };
    }, recentlyClosed);
};

// Sets what a gesture does (eg: 'SHIFT_DOUBLE_RIGHT_CLICK_ACTION' to 'reopenClosedTab'), as the options page would
const setGestureAction = async function (serviceWorker, setting, action) {
    await serviceWorker.evaluate(async ({ setting, action }) => {
        await chrome.storage.sync.set({ [setting]: action });
    }, { setting, action });
};

const restoredSessionIds = async function (serviceWorker) {
    return await serviceWorker.evaluate(() => globalThis.restoredSessionIds);
};

// Records the arguments of each chrome.tabs.reload call in the service worker (read them with tabsReloadCalls), which
// still reloads the tab. The routes of the test pages turn off the HTTP cache, so a test cannot tell a reload which
// skips the cache by what the page loads. A restart of the service worker drops the recording.
const spyOnTabsReload = async function (serviceWorker) {
    await serviceWorker.evaluate(() => {
        globalThis.tabsReloadCalls = [];
        const reload = chrome.tabs.reload;
        chrome.tabs.reload = function (...args) {
            globalThis.tabsReloadCalls.push(args);
            return reload.apply(this, args);
        };
    });
};

const tabsReloadCalls = async function (serviceWorker) {
    return await serviceWorker.evaluate(() => globalThis.tabsReloadCalls);
};

const hasServiceWorkerRestarted = async function (serviceWorker) {
    return await serviceWorker.evaluate(() => globalThis.setBeforeServiceWorkerStop === undefined);
};

// A local server which sends the headers of its answer at once, and the page itself only when sendPage() gets called.
// Until then the tab shows the new document without anything in it. (A routed request cannot do that:
// route.fulfill() sends the whole answer at once.)
// With holdHeaders, it sends nothing at all until sendPage(), so the tab keeps waiting for the first response of its
// page. (A tab which the extension opens itself can escape the routes of Playwright.)
const startLatePageServer = async function ({ holdHeaders = false } = {}) {
    let sendPage;
    // sendPage() can come before the request does (nothing waits for it after chrome.tabs.create())
    let pageWanted = false;
    const server = http.createServer((request, response) => {
        if (!holdHeaders) {
            response.writeHead(200, { 'Content-Type': 'text/html' });
            response.flushHeaders();
        }
        sendPage = () => {
            if (holdHeaders) {
                response.writeHead(200, { 'Content-Type': 'text/html' });
            }
            response.end(CANCEL_CONTEXT_MENU_PAGE);
        };
        if (pageWanted) {
            sendPage();
        }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        url: `http://127.0.0.1:${server.address().port}/`,
        sendPage: () => {
            pageWanted = true;
            if (sendPage) {
                sendPage();
            }
        },
        close: () => {
            server.closeAllConnections();
            server.close();
        }
    };
};

// The id of the context menu entry is the action which it does (the one of a plain double right click)
const CONTEXT_MENU_ENTRY_IDS = ['closeTab', 'goBack', 'reload', 'hardReload', 'newTab', 'duplicateTab', 'reopenClosedTab'];

// The actions whose context menu entry exists. chrome.contextMenus has no API to read the entries, but update()
// rejects for an id which does not exist.
const contextMenuEntryActions = async function (serviceWorker) {
    return await serviceWorker.evaluate(async (menuItemIds) => {
        const existing = [];
        for (const menuItemId of menuItemIds) {
            try {
                await chrome.contextMenus.update(menuItemId, {});
                existing.push(menuItemId);
            } catch {
                // It does not exist
            }
        }
        return existing;
    }, CONTEXT_MENU_ENTRY_IDS);
};

const contextMenuEntryExists = async function (serviceWorker, action = 'closeTab') {
    return (await contextMenuEntryActions(serviceWorker)).includes(action);
};

// Playwright cannot operate the native context menu, so dispatch the click event directly
const clickContextMenuEntry = async function (serviceWorker, url, action = 'closeTab') {
    await serviceWorker.evaluate(async ({ menuItemId, url }) => {
        const [tab] = await chrome.tabs.query({ url });
        chrome.contextMenus.onClicked.dispatch({ menuItemId }, tab);
    }, { menuItemId: action, url });
};

// Records the properties of each context menu entry which the service worker creates (read them with
// contextMenusCreateCalls), which still creates it. A restart of the service worker drops the recording.
const spyOnContextMenusCreate = async function (serviceWorker) {
    await serviceWorker.evaluate(() => {
        globalThis.contextMenusCreateCalls = [];
        const create = chrome.contextMenus.create;
        chrome.contextMenus.create = function (properties, ...rest) {
            globalThis.contextMenusCreateCalls.push(properties);
            return create.call(this, properties, ...rest);
        };
    });
};

const contextMenusCreateCalls = async function (serviceWorker) {
    return await serviceWorker.evaluate(() => globalThis.contextMenusCreateCalls);
};

// Opens chrome://extensions, which collects the errors of the extension from then on (read them with
// readRuntimeErrors)
const collectRuntimeErrors = async function ({ context, extensionId }) {
    const extensionsPage = await context.newPage();
    await extensionsPage.goto('chrome://extensions/');
    // chrome.developerPrivate is the API the chrome://extensions page itself uses. It only collects the errors of an
    // extension in developer mode.
    await extensionsPage.evaluate(async (extensionId) => {
        await chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true });
        await chrome.developerPrivate.updateExtensionConfiguration({ extensionId, errorCollection: true });
    }, extensionId);
    return extensionsPage;
};

const readRuntimeErrors = async function (extensionsPage, extensionId) {
    return await extensionsPage.evaluate(async (extensionId) => {
        const info = await chrome.developerPrivate.getExtensionInfo(extensionId);
        return info.runtimeErrors.map((error) => error.message);
    }, extensionId);
};

export {
    ASK_BEFORE_LEAVING_PATH,
    BUSY_CONTEXT_MENU_PATH,
    BUSY_MOUSEDOWN_PATH,
    CANCEL_CONTEXT_MENU_PATH,
    LATE_FRAME_PATH,
    OFFSET_FRAME_PATH,
    PDF_PATH,
    STALLED_HEAD_PATH,
    STALLED_IMAGE_PATH,
    SVG_PATH,
    TEST_ORIGIN,
    clickContextMenuEntry,
    collectRuntimeErrors,
    contextMenuEntryActions,
    contextMenuEntryExists,
    contextMenusCreateCalls,
    chooseOption,
    expect,
    hasServiceWorkerRestarted,
    holdRightClick,
    openTestPage,
    pathToChromeBuild,
    pathToSource,
    readContentScriptMaxTime,
    readRuntimeErrors,
    restoredSessionIds,
    setGestureAction,
    spyOnContextMenusCreate,
    spyOnTabsReload,
    startLatePageServer,
    stopServiceWorker,
    stubReopenClosedTab,
    tabsReloadCalls,
    test
};
