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

// Whether the content script has finished setting up in the latest tab which shows the given URL
const isContentScriptReady = async function (serviceWorker, url) {
    return await serviceWorker.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({ url });
        const tab = tabs.at(-1);
        if (!tab) {
            return false;
        }
        try {
            // Runs in the same isolated world as the injected content script
            const [{ result }] = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => window.DRCsetup === true && typeof document.onmouseup === 'function'
            });
            return result;
        } catch {
            return false;
        }
    }, url);
};

export {
    ASK_BEFORE_LEAVING_PAGE,
    CANCEL_CONTEXT_MENU_PAGE,
    TEST_PAGE,
    isContentScriptReady
};
