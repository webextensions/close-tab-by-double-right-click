import { setTimeout as sleep } from 'node:timers/promises';

import { findMiddleOfElement, openRealSite } from '../shared/real-sites.js';
import { isContentScriptReadyInTab } from '../shared/test-pages.js';
import {
    clickContextMenuEntry,
    contextMenuEntryExists,
    expect,
    test
} from '../e2e/fixtures.js';

// Where the clicks go on a site which names no element of its own: the middle of the default 1280 x 720 viewport
const DEFAULT_POSITION = { x: 640, y: 360 };

// How long a right click keeps the button down, and when the second click of a double right click starts
const HOLD_MS = 120;
const SECOND_CLICK_AFTER_MS = 270;

// Shown in the HTML report
const annotate = function (type, description) {
    test.info().annotations.push({ type, description });
};

// An outage of a third-party site says nothing about the extension, so the test is skipped then
const navigate = async function (page, url, waitUntil) {
    const failure = await openRealSite(page, url, waitUntil);
    test.skip(!!failure, failure);
};

// What the tab shows, for the message of a failure. Nothing here may wait for the page: a page which has not got its
// root element yet answers no script of an extension, and one which is busy answers nothing at all.
const describePage = async function (page, documentResponse) {
    const withinOneSecond = (promise) => Promise.race([
        promise.catch((err) => `failed (${err.message.split('\n')[0]})`),
        sleep(1000).then(() => 'no answer within 1 s')
    ]);
    const response = documentResponse();
    return JSON.stringify({
        url: page.url(),
        response: response ? `${response.status()} ${JSON.stringify(response.headers())}` : 'none',
        document: await withinOneSecond(page.evaluate(() => ({
            readyState: document.readyState,
            start: document.documentElement ? document.documentElement.outerHTML.slice(0, 300) : 'no root element yet'
        })))
    });
};

const waitForContentScript = async function ({ page, serviceWorker, documentResponse }) {
    try {
        await expect.poll(() => isContentScriptReadyInTab(serviceWorker, { active: true }), { timeout: 15000 }).toBe(true);
    } catch (err) {
        throw new Error(`The content script did not get ready in ${await describePage(page, documentResponse)}`, { cause: err });
    }
};

// Opens a real site in a new tab. Whatever the site serves gets tested (a bot check, a login page and a consent screen
// are pages too), and the report tells which page that was.
// Pass { waitUntil: 'commit' } to get the page while it is still loading, and { contentScript: false } for a site
// which gets the "Close Tab" context menu entry instead.
const openSite = async function ({ context, serviceWorker }, url, { waitUntil = 'domcontentloaded', contentScript = true } = {}) {
    const page = await context.newPage();
    // A page can ask for a confirmation before it gets closed, which would keep the tab open
    page.on('dialog', (dialog) => dialog.accept().catch(() => {}));
    // The latest answer to a request for the document of the tab, for the message of a failure
    let latestDocumentResponse;
    page.on('response', (response) => {
        if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
            latestDocumentResponse = response;
        }
    });
    await navigate(page, url, waitUntil);
    // Makes it the active tab, which is how the service worker finds it
    await page.bringToFront();

    const sitePage = {
        page,
        serviceWorker,
        documentResponse: () => latestDocumentResponse,
        client: await context.newCDPSession(page),
        tabId: await serviceWorker.evaluate(async () => (await chrome.tabs.query({ active: true })).at(-1).id)
    };
    if (contentScript) {
        await waitForContentScript(sitePage);
    }
    annotate('page', `${page.url()} "${await page.title()}"`);
    return sitePage;
};

// Leaves the requests of a page unanswered, except for the document of the page which gets opened first. That page
// then stays the way a slow connection shows it for a while: without its scripts, styles, images and frames. If it
// sends the tab elsewhere on its own (as some bot checks do), that gets no answer either, so the page stays for both
// clicks.
// The requests which a script of the page makes itself fail at once instead: a synchronous one would otherwise freeze
// the page for good (the bot check which Akamai puts in front of amazon.com makes one), and a frozen page neither runs
// a content script nor receives a click.
const stallSubresources = async function (context) {
    let documentRequested = false;
    await context.route('**/*', (route) => {
        const request = route.request();
        const isDocumentOfTab = !request.serviceWorker() && request.isNavigationRequest() && !request.frame().parentFrame();
        if (isDocumentOfTab && (!documentRequested || request.redirectedFrom())) {
            documentRequested = true;
            return route.continue();
        }
        if (['xhr', 'fetch'].includes(request.resourceType())) {
            return route.abort();
        }
    });
};

// Follows a link of the page inside the same tab
const followLink = async function (sitePage, url) {
    await navigate(sitePage.page, url, 'domcontentloaded');
    await waitForContentScript(sitePage);
    annotate('page', `${sitePage.page.url()} "${await sitePage.page.title()}"`);
};

// The middle of the element (or frame) which the site names. When it is not showing, the clicks go to the default
// position.
const resolveClickPosition = async function ({ page }, site) {
    const selector = site.target || site.frame;
    if (!selector) {
        return DEFAULT_POSITION;
    }
    const position = await findMiddleOfElement(page, selector);
    if (!position) {
        annotate('clicked elsewhere', `"${selector}" is not showing, so the clicks went to the middle of the page`);
    }
    return position || DEFAULT_POSITION;
};

// A real browser opens its own context menu unless the page cancels the "contextmenu" event, and that menu swallows
// parts of a double right click. Playwright never opens it, so the helpers below leave those parts out themselves,
// which takes knowing whether the page cancelled the event. The observer lives in the isolated world of the extension
// (like the readiness probe), so the scripts of the page are left alone.
const watchContextMenu = async function ({ serviceWorker, tabId }) {
    await serviceWorker.evaluate(async (tabId) => {
        await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            func: () => {
                window.DRCtestContextMenuListener ||= (e) => {
                    window.DRCtestContextMenuEvent = e;
                };
                // Attaching a listener which is still there has no effect
                window.addEventListener('contextmenu', window.DRCtestContextMenuListener, true);
                window.DRCtestContextMenuEvent = null;
            },
            injectImmediately: true
        }).catch(() => {});
    }, tabId);
};

// Whether the page cancelled the "contextmenu" event received since the previous call
const takeContextMenuCancelled = async function ({ serviceWorker, tabId }) {
    return await serviceWorker.evaluate(async (tabId) => {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId, allFrames: true },
                func: () => {
                    // By now the page has had its chance to cancel the event
                    const cancelled = !!window.DRCtestContextMenuEvent && window.DRCtestContextMenuEvent.defaultPrevented;
                    window.DRCtestContextMenuEvent = null;
                    return cancelled;
                },
                injectImmediately: true
            });
            return results.some(({ result }) => result);
        } catch {
            // The tab is gone, or it shows a page which cannot be scripted
            return false;
        }
    }, tabId);
};

// Browser-level input, since the content script ignores the events which a page creates itself
const sendMouseEvent = async function ({ client }, type, position, button = 'none') {
    await client.send('Input.dispatchMouseEvent', {
        type,
        x: position.x,
        y: position.y,
        button,
        buttons: type === 'mousePressed' ? 2 : 0,
        clickCount: type === 'mouseMoved' ? 0 : 1
    });
};

// The press always reaches the page. The release only does when the page cancelled the context menu: otherwise the
// native menu is open by then and swallows it.
const pressAndMaybeRelease = async function (sitePage, position) {
    await sendMouseEvent(sitePage, 'mousePressed', position, 'right');
    await sleep(HOLD_MS);
    const cancelled = await takeContextMenuCancelled(sitePage);
    if (cancelled) {
        await sendMouseEvent(sitePage, 'mouseReleased', position, 'right');
    }
    return cancelled;
};

// One right click, the way a browser on Linux delivers it to the page
const rightClickAsDelivered = async function (sitePage, position) {
    await watchContextMenu(sitePage);
    await sendMouseEvent(sitePage, 'mouseMoved', position);
    await pressAndMaybeRelease(sitePage, position);
};

// A double right click on one spot, the way a browser on Linux delivers it to the page. While the native context menu
// of the first click is open, the second click arrives as (the "sequence"):
// - 'chromium-x11': its press
// - 'chromium-wayland': nothing but a "mousemove" without buttons, once it has closed the menu
// - 'firefox': its release
// On a page which cancels the context menu, both clicks arrive in full, whatever the sequence.
// Pass { awaitPointerMove: false } on a page which may not have rendered anything yet: Chromium holds a "mousemove"
// back for up to 5 seconds there, until the press which follows it pushes it through.
const doubleRightClickAsDelivered = async function (sitePage, position, { sequence = 'chromium-x11', secondClickAfter = SECOND_CLICK_AFTER_MS, awaitPointerMove = true } = {}) {
    try {
        await watchContextMenu(sitePage);
        // The pointer of a user is on the spot before the click. The content script relies on that for a frame which
        // still waits for its own page.
        const pointerMoved = sendMouseEvent(sitePage, 'mouseMoved', position);
        if (awaitPointerMove) {
            await pointerMoved;
        } else {
            pointerMoved.catch(() => {});
        }
        const startedAt = Date.now();
        const cancelled = await pressAndMaybeRelease(sitePage, position);
        await sleep(Math.max(0, startedAt + secondClickAfter - Date.now()));

        if (cancelled || sequence === 'chromium-x11') {
            await pressAndMaybeRelease(sitePage, position);
        } else if (sequence === 'chromium-wayland') {
            await sendMouseEvent(sitePage, 'mouseMoved', position);
        } else {
            await sendMouseEvent(sitePage, 'mouseReleased', position, 'right');
        }
    } catch (err) {
        // The extension can close the tab before the second click is over
        if (!sitePage.page.isClosed()) {
            throw err;
        }
    }
};

export {
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
};
