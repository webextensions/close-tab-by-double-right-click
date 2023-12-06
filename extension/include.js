/*global chrome*/

(function () {
    'use strict';
    var contextMenuEntry;

    const removedTabs = {};

    // eslint-disable-next-line no-unused-vars
    function runScriptByTabId(tabId, pageAlreadyLoaded) {
        chrome.tabs.get(tabId, function (tab) {
            if (!tab) {
                return;
            }

            var url = tab.url;
            if (
                url.indexOf('http://')  === 0 ||
                url.indexOf('https://') === 0 ||
                url.indexOf('file:///') === 0 ||
                url.indexOf('ftp:///')  === 0
            ) {
                if (url.indexOf('https://chrome.google.com/webstore/') === 0) {
                    return;
                } else {
                    // Do nothing
                }
            } else {
                // URLs might begin with:
                //     chrome://
                //     chrome-devtools://
                //     chrome-error://
                //     view-source:
                return;
            }

            var limit = 40,
                fn = function () {
                    limit -= 1;
                    if (limit <= 0) {
                        clearInterval(t);
                    }

                    chrome.tabs.get(tabId, async function (tab) {
                        if (chrome.runtime.lastError) {
                            // do nothing
                        }

                        // Chrome unnecessarily logs an error if
                        // the tab with "tabId" is not found for chrome.tabs.get().
                        // Note: Even in such cases, chrome.tabs.get() does call the callback
                        // function with the undefined value for "tab"
                        if (tab) {
                            if (tab.status === 'complete') {
                                try {
                                    await chrome.scripting.executeScript({
                                        target: {
                                            tabId,
                                            allFrames: true
                                        },
                                        files: [
                                            "utils.js",
                                            "scripts/close-tab-by-double-right-click.js"
                                        ]
                                    });
                                } catch (e) {
                                    if (chrome.runtime.lastError) {
                                        // do nothing
                                    }
                                }
                            }
                        } else {
                            clearInterval(t);
                        }
                    });
                },
                t = setInterval(fn, 1500);    // Handling dynamic iframes added to the page
            fn();
        });
    }

    function runScript(tab, pageAlreadyLoaded) {
        runScriptByTabId(tab.id, pageAlreadyLoaded);
    }

    function closeTabByTabId(tabId) {
        // chrome.tabs.remove(tabId);

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

    function removeContextMenuEntry(tabId) { // eslint-disable-line no-unused-vars
        if (contextMenuEntry) {
            /*
                Note:
                Ideally, we would want to use "chrome.contextMenus.remove(contextMenuEntry);", but, due to lack of
                ability to add checks if the "contextMenuEntry" still exists, there can be some unwanted error logs
                under some scenario. Hence, using "chrome.contextMenus.removeAll();".
            */
            chrome.contextMenus.removeAll(); // chrome.contextMenus.remove(contextMenuEntry);
        }
    }

    function addContextMenuEntry(tabId) {
        removeContextMenuEntry(tabId);

        contextMenuEntry = chrome.contextMenus.create({
            id: 'close-tab-' + tabId,
            title: 'Close Tab',
            contexts: ['all']
            // onclick: function (info, tab) {
            //     closeTab(tab);
            // }
        });

        // eslint-disable-next-line no-unused-vars
        chrome.contextMenus.onClicked.addListener(function (info, tab) {
            if (info.menuItemId.startsWith('close-tab-')) {
                // closeTab(tab);

                const tabId = parseInt(info.menuItemId.split('-')[2], 10);
                closeTabByTabId(tabId);
            }
        });
    }

    function addContextMenuEntryIfRequired(tabId) {
        chrome.tabs.get(tabId, function (tab) {
            if (chrome.runtime.lastError) {
                // do nothing
            }

            var url = tab && tab.url;
            if (url && tab.active) {
                chrome.windows.getLastFocused(function (win) {
                    if (tab.windowId === win.id) {
                        if (
                            url.indexOf('https://chrome.google.com/webstore/') === 0 ||
                            url.indexOf('https://addons.mozilla.org/') === 0
                        ) {
                            addContextMenuEntry(tabId);
                        } else if (
                            url.indexOf('http://') === 0 ||
                            url.indexOf('https://') === 0 ||
                            url.indexOf('file:///') === 0 ||
                            url.indexOf('ftp:///') === 0
                        ) {
                            // TODO: If it is a native error page (eg: "This site can’t be reached"), then add the context menu entry
                            removeContextMenuEntry(tabId);
                        } else {
                            // URLs might begin with:
                            //     chrome://
                            //     chrome-devtools://
                            //     chrome-error://
                            //     view-source:
                            addContextMenuEntry(tabId);
                        }
                    }
                });
            }
        });
    }

    /*
    chrome.tabs.query({}, function (tabs) {
        tabs.forEach(function (tab) {
            runScript(tab, true);
        });
    });
    */
    // Run this also when the extension is turned from disabled to enabled in chrome://extensions
    chrome.management.onEnabled.addListener(function (extensionInfo) { // eslint-disable-line no-unused-vars
        // console.log('extensionInfo', extensionInfo);
        chrome.tabs.query({}, function (tabs) {
            tabs.forEach(function (tab) {
                runScript(tab, true);
            });
        });
    });

    // Run this only once (on extension install/update)
    chrome.runtime.onInstalled.addListener(function (details) {
        if (details.reason === 'install' || details.reason === 'update') {
            chrome.tabs.query({}, function (tabs) {
                tabs.forEach(function (tab) {
                    runScript(tab, true);
                });
            });
        }
    });

    chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
        // Run the script as quickly as possible (changeInfo.status === 'loading')
        runScript(tab);

        // Without this Undoing close tab (Ctrl + Shift + T) would re-open the closed tab and the context menu entry would exist in the file
        // This probably can't be added/called directly to/from the content script (through message-passing) because runScript might be called on multiple tabs at once (currently it happens on "onInstalled")
        addContextMenuEntryIfRequired(tabId);
    });

    // chrome.tabs.onUpdated does not fire on new tabs for cached pages
    // https://code.google.com/p/chromium/issues/detail?id=154631
    chrome.tabs.onReplaced.addListener(function (tabId, changeInfo, tab) {      // eslint-disable-line no-unused-vars
        runScriptByTabId(tabId);
        removeContextMenuEntry(tabId);
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
