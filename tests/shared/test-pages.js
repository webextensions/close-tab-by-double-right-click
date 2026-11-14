// Test pages and the readiness probe shared by the Playwright e2e tests and scripts/verify-chrome/verify-chrome.js

const TEST_PAGE = '<!doctype html><html><head><title>Test page</title></head><body style="height:100vh">Test page</body></html>';

// A page which shows its own context menu cancels the browser's one, so nothing swallows parts of a right click there
const CANCEL_CONTEXT_MENU_PAGE = TEST_PAGE.replace(
    '</body>',
    '<script>document.addEventListener("contextmenu", (e) => e.preventDefault());</script></body>'
);

// A page which asks for a confirmation before it gets closed (and cancels the context menu as well)
const ASK_BEFORE_LEAVING_PAGE = CANCEL_CONTEXT_MENU_PAGE.replace(
    '</body>',
    '<script>window.addEventListener("beforeunload", (e) => e.preventDefault());</script></body>'
);

// A document without a body, which also cancels the context menu
const SVG_PAGE = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="white"/>' +
    '<script>document.addEventListener("contextmenu", (e) => e.preventDefault());</script></svg>'
);

// A page which shows another page of its site in a frame, away from its own top left corner
const FRAME_PATH = '/frame';
const OFFSET_FRAME_PAGE = TEST_PAGE.replace(
    '</body>',
    `<iframe src="${FRAME_PATH}" style="position:fixed;left:200px;top:100px;width:800px;height:500px;border:0"></iframe></body>`
);

// A PDF file with one empty page
const PDF_FILE = (
    '%PDF-1.4\n' +
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n'
);

// Requests below this path never get an answer, so a page which uses one of them never finishes loading
const STALLED_PATH = '/stalled/';

// A page which stalls inside its <head>, so its document never gets a body
const STALLED_HEAD_PAGE = TEST_PAGE.replace('</head>', `<script src="${STALLED_PATH}script.js"></script></head>`);

// A page which shows its content while an image keeps it loading
const STALLED_IMAGE_PAGE = TEST_PAGE.replace('</body>', `<img src="${STALLED_PATH}image.png"></body>`);

// The same two pages, cancelling the context menu (before they stall)
const STALLED_HEAD_CANCEL_CONTEXT_MENU_PAGE = STALLED_HEAD_PAGE.replace(
    '<script src',
    '<script>document.addEventListener("contextmenu", (e) => e.preventDefault());</script><script src'
);
const STALLED_IMAGE_CANCEL_CONTEXT_MENU_PAGE = CANCEL_CONTEXT_MENU_PAGE.replace(
    '</body>',
    `<img src="${STALLED_PATH}image.png"></body>`
);

// Whether the content script has finished setting up in the latest tab which matches the given chrome.tabs query
const isContentScriptReadyInTab = async function (serviceWorker, queryInfo) {
    return await serviceWorker.evaluate(async (queryInfo) => {
        const tabs = await chrome.tabs.query(queryInfo);
        const tab = tabs.at(-1);
        if (!tab) {
            return false;
        }
        try {
            // Runs in the same isolated world as the injected content script
            const [{ result }] = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => window.DRCready === true,
                // Otherwise this would wait for the page to load, which a stalled page never does
                injectImmediately: true
            });
            return result;
        } catch {
            return false;
        }
    }, queryInfo);
};

// Whether the content script has finished setting up in the latest tab which shows the given URL
const isContentScriptReady = async function (serviceWorker, url) {
    return await isContentScriptReadyInTab(serviceWorker, { url });
};

export {
    ASK_BEFORE_LEAVING_PAGE,
    CANCEL_CONTEXT_MENU_PAGE,
    FRAME_PATH,
    OFFSET_FRAME_PAGE,
    PDF_FILE,
    STALLED_HEAD_CANCEL_CONTEXT_MENU_PAGE,
    STALLED_HEAD_PAGE,
    STALLED_IMAGE_CANCEL_CONTEXT_MENU_PAGE,
    STALLED_IMAGE_PAGE,
    STALLED_PATH,
    SVG_PAGE,
    TEST_PAGE,
    isContentScriptReady,
    isContentScriptReadyInTab
};
