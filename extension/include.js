(function () {
    const scheduledTimerForTabs = {};

    const removedTabs = {};

    const CONTEXT_MENU_ENTRY_ID = 'close-tab';

    function runScriptByTabId(tabId, pageAlreadyLoaded) {
        chrome.tabs.get(tabId, function (tab) {
            if (!tab) {
                return;
            }

            var url = tab.url;
            if (
                url.indexOf('https://chromewebstore.google.com/') === 0 ||
                url.indexOf('https://chrome.google.com/webstore/') === 0 ||
                url.indexOf('https://addons.mozilla.org/') === 0
            ) {
                return;
            } else if (
                url.indexOf('http://')  === 0 ||
                url.indexOf('https://') === 0 ||
                url.indexOf('file:///') === 0
            ) {
                // Do nothing
            } else {
                // URLs might begin with:
                //     chrome://
                //     chrome-devtools://
                //     chrome-error://
                //     view-source:
                return;
            }

            if (scheduledTimerForTabs[tabId]) {
                clearInterval(scheduledTimerForTabs[tabId]);
                delete scheduledTimerForTabs[tabId];
            }

            var limit = 20;
            var fn = function () {
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
                                        'utils.js',
                                        'scripts/close-tab-by-double-right-click.js'
                                    ]
                                });
                            } catch (e) {
                                // Expected for pages which cannot be scripted (error pages, no access, closed tabs)
                                console.debug('Could not inject the content script', e, tab);
                            }
                        }
                    } else {
                        clearInterval(t);
                    }
                });
            };

            fn();

            var t;
            if (pageAlreadyLoaded) {
                // do nothing
            } else {
                t = setInterval(fn, 2500); // Handling dynamic iframes added to the page
                scheduledTimerForTabs[tabId] = t;
            }
        });
    }

    function runScript(tab, pageAlreadyLoaded) {
        runScriptByTabId(tab.id, pageAlreadyLoaded);
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
            if (url && tab.active) {
                chrome.windows.getLastFocused(function (win) {
                    if (tab.windowId === win.id) {
                        if (
                            url.indexOf('https://chromewebstore.google.com/') === 0 ||
                            url.indexOf('https://chrome.google.com/webstore/') === 0 ||
                            url.indexOf('https://addons.mozilla.org/') === 0
                        ) {
                            addContextMenuEntry();
                        } else if (
                            url.indexOf('http://') === 0 ||
                            url.indexOf('https://') === 0 ||
                            url.indexOf('file:///') === 0
                        ) {
                            // TODO: If it is a native error page (eg: "This site can't be reached"), then add the context menu entry
                            removeContextMenuEntry();
                        } else {
                            // URLs might begin with:
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
            runScript(tab, true);
        });
    });

    chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
        // Called on every update of the tab; the script gets injected once the tab's status is "complete"
        runScript(tab);

        // Without this Undoing close tab (Ctrl + Shift + T) would re-open the closed tab and the context menu entry would exist in the file
        // This probably can't be added/called directly to/from the content script (through message-passing) because runScript might be called on multiple tabs at once (currently it happens when the background script starts)
        addContextMenuEntryIfRequired(tabId);
    });

    // chrome.tabs.onUpdated does not fire on new tabs for cached pages
    // https://code.google.com/p/chromium/issues/detail?id=154631
    chrome.tabs.onReplaced.addListener(function (addedTabId) {
        runScriptByTabId(addedTabId);
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
