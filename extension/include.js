(function () {
    const removedTabs = {};

    const CONTEXT_MENU_ENTRY_ID = 'close-tab';

    // Firefox runs no extension scripts on these domains (its default "extensions.webextensions.restrictedDomains")
    const FIREFOX_RESTRICTED_DOMAINS = [
        'accounts-static.cdn.mozilla.net',
        'accounts.firefox.com',
        'addons.cdn.mozilla.net',
        'addons.mozilla.org',
        'api.accounts.firefox.com',
        'content.cdn.mozilla.net',
        'discovery.addons.mozilla.org',
        'oauth.accounts.firefox.com',
        'profile.accounts.firefox.com',
        'support.mozilla.org',
        'sync.services.mozilla.com'
    ];
    const isFirefox = chrome.runtime.getURL('').startsWith('moz-extension://');

    // Web pages which do not get the content script (the browser blocks it on most of them), so they get the
    // "Close Tab" context menu entry instead
    function isScriptingBlocked(url) {
        if (
            url.indexOf('https://chromewebstore.google.com/') === 0 ||
            url.indexOf('https://chrome.google.com/webstore/') === 0 ||
            url.indexOf('https://addons.mozilla.org/') === 0
        ) {
            return true;
        }
        return isFirefox && URL.canParse(url) && FIREFOX_RESTRICTED_DOMAINS.includes(new URL(url).hostname);
    }

    // The browser runs the content script (declared in the manifest) in every page which gets loaded. Only the tabs
    // which were open before that need it from here: Chrome does not run it in those when the extension gets
    // installed, updated or enabled.
    async function runScript(tab) {
        var url = tab.url;
        if (isScriptingBlocked(url)) {
            return;
        } else if (
            url.indexOf('http://')  === 0 ||
            url.indexOf('https://') === 0
        ) {
            // Do nothing
        } else {
            // URLs might begin with:
            //     file:/// (not covered by the host permissions in the manifest)
            //     chrome://
            //     chrome-devtools://
            //     chrome-error://
            //     view-source:
            return;
        }

        // A discarded tab has no page; it gets the content script when the browser loads it again
        if (tab.discarded) {
            return;
        }

        try {
            await chrome.scripting.executeScript({
                target: {
                    tabId: tab.id,
                    allFrames: true
                },
                files: [
                    'scripts/close-tab-by-double-right-click.js'
                ],
                // Otherwise a tab which is still loading would only get the script once it has loaded
                injectImmediately: true
            });
        } catch (e) {
            // Expected for pages which cannot be scripted (error pages, no access, closed tabs)
            console.debug('Could not inject the content script', e, tab);
        }
    }

    function closeTabByTabId(tabId) {
        if (removedTabs[tabId]) {
            return;
        } else {
            chrome.tabs.remove(tabId);
            removedTabs[tabId] = true;

            setTimeout(function () {
                delete removedTabs[tabId];
            }, 2500);
        }
    }

    function closeTab(tab) {
        closeTabByTabId(tab.id);
    }

    function removeContextMenuEntry() {
        /*
            Note:
            Ideally, we would want to remove only the entry which was added earlier, but the background script can
            get restarted at any time, which loses track of that entry (and there is no API to check which entries
            exist). Hence, using "chrome.contextMenus.removeAll();".
        */
        chrome.contextMenus.removeAll();
    }

    function addContextMenuEntry() {
        removeContextMenuEntry();

        chrome.contextMenus.create({
            id: CONTEXT_MENU_ENTRY_ID,
            title: 'Close Tab',
            contexts: ['all']
        });
    }

    function addContextMenuEntryIfRequired(tabId) {
        chrome.tabs.get(tabId, function (tab) {
            if (chrome.runtime.lastError) {
                // do nothing
            }

            var url = tab && tab.url;
            if (tab && tab.active) {
                chrome.windows.getLastFocused(function (win) {
                    if (tab.windowId === win.id) {
                        if (!url) {
                            // Nothing got loaded into the tab so far (eg: a link opened in a new tab, while the
                            // server has not answered yet), so there is no page for the content script to run in
                            addContextMenuEntry();
                        } else if (isScriptingBlocked(url)) {
                            addContextMenuEntry();
                        } else if (
                            url.indexOf('http://') === 0 ||
                            url.indexOf('https://') === 0
                        ) {
                            // TODO: If it is a native error page (eg: "This site can't be reached"), then add the context menu entry
                            removeContextMenuEntry();
                        } else {
                            // URLs might begin with:
                            //     file:/// (not covered by the host permissions in the manifest)
                            //     chrome://
                            //     chrome-devtools://
                            //     chrome-error://
                            //     view-source:
                            addContextMenuEntry();
                        }
                    }
                });
            }
        });
    }

    // Apply the script to all tabs
    chrome.tabs.query({}, function (tabs) {
        tabs.forEach(function (tab) {
            runScript(tab);
        });
    });

    chrome.tabs.onUpdated.addListener(function (tabId) {
        // Without this Undoing close tab (Ctrl + Shift + T) would re-open the closed tab and the context menu entry would exist in the file
        // This probably can't be added/called directly to/from the content script (through message-passing) because runScript might be called on multiple tabs at once (currently it happens when the background script starts)
        addContextMenuEntryIfRequired(tabId);
    });

    // chrome.tabs.onUpdated does not fire on new tabs for cached pages
    // https://code.google.com/p/chromium/issues/detail?id=154631
    chrome.tabs.onReplaced.addListener(function () {
        removeContextMenuEntry();
    });

    chrome.runtime.onMessage.addListener(
        function (request, sender, sendResponse) {      // eslint-disable-line no-unused-vars
            if (request.closeTab) {
                closeTab(sender.tab);
            }
        }
    );

    // Registered at the top level, otherwise the click which wakes up an idle background script would have no listener
    chrome.contextMenus.onClicked.addListener(function (info, tab) {
        // The entry is shared by all tabs, so close the tab which was clicked
        if (info.menuItemId === CONTEXT_MENU_ENTRY_ID && tab) {
            closeTab(tab);
        }
    });

    chrome.tabs.onActivated.addListener(function (activeInfo) {
        addContextMenuEntryIfRequired(activeInfo.tabId);
    });

    chrome.windows.onFocusChanged.addListener(
        function (windowId) {
            if (windowId === chrome.windows.WINDOW_ID_NONE) {
                // do nothing
            } else {
                chrome.windows.get(windowId, {populate: true}, function (win) {
                    if (chrome.runtime.lastError) {
                        // do nothing
                    }

                    // The window can already be gone, in which case "win" is undefined
                    var tabs = win && win.tabs;
                    if (tabs) {
                        var i;
                        for (i = 0; i < tabs.length; i += 1) {
                            var tab = tabs[i];
                            if (tab.active) {
                                addContextMenuEntryIfRequired(tab.id);
                            }
                        }
                    }
                });
            }
        }
    );
}());
