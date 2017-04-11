/*global chrome*/

(function () {
    'use strict';
    var contextMenuEntry;

    function runScriptByTabId(tabId) {
        chrome.tabs.get(tabId, function (tab) {
            var url = tab.url;
            if (
                url.indexOf('chrome://') === 0 ||
                url.indexOf('chrome-devtools://') === 0 ||
                url.indexOf('view-source:') === 0
            ) {
                return;
            } else if (
                url.indexOf('http://') === 0 ||
                url.indexOf('https://') === 0 ||
                url.indexOf('file:///') === 0 ||
                url.indexOf('ftp:///') === 0
            ) {
                // doing nothing yet
            } else {
                // doing nothing yet
            }

            var limit = 40,
                fn = function () {
                    limit -= 1;
                    if (limit <= 0) {
                        clearInterval(t);
                    }

                    chrome.tabs.get(tabId, function (tab) {
                        // Chrome unnecessarily logs an error if
                        // the tab with "tabId" is not found for chrome.tabs.get().
                        // Note: Even in such cases, chrome.tabs.get() does call the callback
                        // function with the undefined value for "tab"
                        if (tab) {
                            // Run the script for all the iframes
                            // ("allFrames: true" parameter does not seem to be of use when "changeInfo.status === 'loading'")
                            chrome.tabs.executeScript(tabId, {allFrames: true, runAt: 'document_end', file: "scripts/close-tab-by-double-right-click.js"});
                        } else {
                            clearInterval(t);
                        }
                    });
                },
                t = setInterval(fn, 1500);    // Handling dynamic iframes added to the page
            fn();
        });
    }

    function runScript(tab) {
        runScriptByTabId(tab.id);
    }

    function closeTabByTabId(tabId) {
        chrome.tabs.remove(tabId);
    }

    function closeTab(tab) {
        closeTabByTabId(tab.id);
    }

    function removeContextMenuEntry() {
        if (contextMenuEntry) {
            chrome.contextMenus.remove(contextMenuEntry);
        }
    }

    function addContextMenuEntry() {
        removeContextMenuEntry();

        contextMenuEntry = chrome.contextMenus.create({
            title: 'Close Tab',
            contexts: ['all'],
            onclick: function (info, tab) {
                closeTab(tab);
            }
        });
    }

    function addContextMenuEntryIfRequired(tabId) {
        chrome.tabs.get(tabId, function (tab) {
            var url = tab && tab.url;
            if (url && tab.active) {
                chrome.windows.getLastFocused(function (win) {
                    if (tab.windowId === win.id) {
                        if (
                            url.indexOf('https://chrome.google.com/') === 0 ||
                            url.indexOf('view-source:') === 0
                        ) {
                            addContextMenuEntry();
                        } else if (
                            url.indexOf('http://') === 0 ||
                            url.indexOf('https://') === 0 ||
                            url.indexOf('file:///') === 0 ||
                            url.indexOf('ftp:///') === 0
                        ) {
                            removeContextMenuEntry();
                        } else {
                            addContextMenuEntry();
                        }
                    }
                });
            }
        });
    }

    chrome.runtime.onInstalled.addListener(function (details) {     // eslint-disable-line no-unused-vars
        chrome.tabs.query({}, function (tabs) {
            tabs.forEach(function (tab) {
                runScript(tab);
            });
        });
    });

    addContextMenuEntry();

    chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
        // Run the script as quickly as possible (changeInfo.status === 'loading')
        runScript(tab);
        addContextMenuEntryIfRequired(tabId);    // Without this Undoing close tab (Ctrl + Shift + T) would re-open the closed tab and the context menu entry would exist in the file
                            // This probably can't be added/called directly to/from the content script (through message-passing) because runScript might be called on multiple tabs at once (currently it happens on "onInstalled")
    });

    // chrome.tabs.onUpdated does not fire on new tabs for cached pages
    // https://code.google.com/p/chromium/issues/detail?id=154631
    chrome.tabs.onReplaced.addListener(function (tabId, changeInfo, tab) {      // eslint-disable-line no-unused-vars
        runScriptByTabId(tabId);
        removeContextMenuEntry();
    });

    chrome.runtime.onMessage.addListener(
        function (request, sender, sendResponse) {      // eslint-disable-line no-unused-vars
            if (request.closeTab) {
                closeTab(sender.tab);
            }
        }
    );

    chrome.tabs.onActivated.addListener(function (activeInfo) {
        addContextMenuEntryIfRequired(activeInfo.tabId);
    });

    chrome.windows.onFocusChanged.addListener(
        function (windowId) {
            if (windowId === chrome.windows.WINDOW_ID_NONE) {
                // do nothing
            } else {
                chrome.windows.get(windowId, {populate: true}, function (win) {
                    var tabs = win.tabs;
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
