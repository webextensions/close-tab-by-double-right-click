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
    // "Close tab" context menu entry instead
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
                    'scripts/double-right-click.js'
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

    // Reopening a closed tab needs the "sessions" permission, which is optional: the user grants it on the options
    // page. It gets checked on each gesture, since nothing kept in memory survives a restart of the background script.
    async function isReopenEnabled() {
        return await chrome.permissions.contains({ permissions: ['sessions'] });
    }

    // Reopens the tab which got closed last (closed windows are skipped)
    async function reopenLastClosedTab() {
        try {
            const sessions = await chrome.sessions.getRecentlyClosed();
            const lastClosed = sessions.find(function (session) {
                return session.tab;
            });
            if (lastClosed) {
                // Firefox requires the sessionId
                await chrome.sessions.restore(lastClosed.tab.sessionId);
            }
        } catch (e) {
            console.debug('Could not reopen the last closed tab', e);
        }
    }

    // What a double right click does, as chosen on the options page, without a modifier key and with each one held on
    // its first click. A missing or unknown choice means the default.
    const DOUBLE_RIGHT_CLICK_ACTION = 'DOUBLE_RIGHT_CLICK_ACTION';
    const MODIFIER_ACTION_KEYS = {
        shiftKey: 'SHIFT_DOUBLE_RIGHT_CLICK_ACTION',
        ctrlKey: 'CTRL_DOUBLE_RIGHT_CLICK_ACTION',
        altKey: 'ALT_DOUBLE_RIGHT_CLICK_ACTION',
        metaKey: 'META_DOUBLE_RIGHT_CLICK_ACTION'
    };
    const ACTION_SAME_AS_DOUBLE_RIGHT_CLICK = 'sameAsDoubleRightClick';
    const ACTION_DEFAULT = 'closeTab';

    // The actions which the user can choose from, by the names which the settings keep
    const ACTIONS = {
        nothing: function () {},
        closeTab: function (tab) {
            closeTab(tab);
        },
        reopenClosedTab: async function () {
            // Once the user revoked the permission, it does nothing (the options page shows that it is missing)
            if (await isReopenEnabled()) {
                await reopenLastClosedTab();
            }
        },
        goBack: async function (tab) {
            await chrome.tabs.goBack(tab.id);
        },
        reload: async function (tab) {
            await chrome.tabs.reload(tab.id);
        },
        hardReload: async function (tab) {
            await chrome.tabs.reload(tab.id, { bypassCache: true });
        },
        newTab: async function (tab) {
            await chrome.tabs.create({ windowId: tab.windowId });
        },
        duplicateTab: async function (tab) {
            await chrome.tabs.duplicate(tab.id);
        }
    };

    const chromeStorageForExtensionData = chrome.storage.sync || chrome.storage.local;

    async function readAction(storageKey) {
        const action = (await chromeStorageForExtensionData.get(storageKey))[storageKey];
        return Object.hasOwn(ACTIONS, action) || action === ACTION_SAME_AS_DOUBLE_RIGHT_CLICK ? action : undefined;
    }

    // The action for the modifier keys held on the first click: its own one if set, otherwise the one of the double
    // right click. Several modifier keys held together do nothing. The Meta key (Cmd) only counts on macOS: elsewhere
    // the system takes it (the Windows key, Super on Linux).
    async function findAction(request) {
        const isMac = (await chrome.runtime.getPlatformInfo()).os === 'mac';
        const heldModifiers = Object.keys(MODIFIER_ACTION_KEYS).filter(function (modifier) {
            return request[modifier] && (modifier !== 'metaKey' || isMac);
        });
        if (heldModifiers.length > 1) {
            return 'nothing';
        }
        if (heldModifiers.length === 1) {
            const action = await readAction(MODIFIER_ACTION_KEYS[heldModifiers[0]]);
            if (action && action !== ACTION_SAME_AS_DOUBLE_RIGHT_CLICK) {
                return action;
            }
        }
        const action = await readAction(DOUBLE_RIGHT_CLICK_ACTION);
        return action && action !== ACTION_SAME_AS_DOUBLE_RIGHT_CLICK ? action : ACTION_DEFAULT;
    }

    // The settings get read on each gesture, since nothing kept in memory survives a restart of the background script
    async function handleDoubleRightClick(request, tab) {
        let action;
        try {
            action = await findAction(request);
        } catch (e) {
            // Closing the tab could lose what the user did not want to lose
            action = 'nothing';
            console.debug('Could not read what the double right click does', e);
        }
        try {
            await ACTIONS[action](tab);
        } catch (e) {
            // Expected for example when going back in a tab without history
            console.debug('Could not do what the double right click does', action, e);
        }
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
            title: 'Close tab',
            contexts: ['all']
        });
    }

    // How long the scripting probe below may take to answer on a page which has started to arrive (in milliseconds)
    const PROBE_ANSWER_TIME = 300;

    // Counts the checks below, so that a slow answer of an older check cannot undo the outcome of a newer one. Nothing
    // is lost when a restart of the background script resets it.
    let latestContextMenuCheck = 0;

    function addContextMenuEntryIfRequired(tabId) {
        chrome.tabs.get(tabId, function (tab) {
            if (chrome.runtime.lastError) {
                // do nothing
            }

            var url = tab && tab.url;
            if (tab && tab.active) {
                chrome.windows.getLastFocused(function (win) {
                    if (tab.windowId === win.id) {
                        const contextMenuCheck = ++latestContextMenuCheck;
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
                            // A page of the browser itself can be showing under such a URL (eg: "This site can't be
                            // reached"), where the content script cannot run. Trying to run a script tells.
                            // In the PDF viewer of the browser, the script runs (in Chrome) but the viewer gets
                            // the clicks instead of the content script, so the script reports the type of the document.
                            // The script gets no answer while the page has not started to arrive: a slow server can
                            // send the headers of its answer long before the page itself. Chrome then already shows
                            // the new document, still without anything in it, where the content script cannot run
                            // yet either, so the entry stands in until the answer comes. (Firefox keeps the previous
                            // page until the new one starts to arrive.)
                            const probeUnanswered = setTimeout(function () {
                                if (contextMenuCheck === latestContextMenuCheck) {
                                    addContextMenuEntry();
                                }
                            }, PROBE_ANSWER_TIME);
                            chrome.scripting.executeScript({
                                target: { tabId },
                                func: function () {
                                    return document.contentType;
                                },
                                // Otherwise the answer would only come once the page has loaded
                                injectImmediately: true
                            }).then(function (results) {
                                clearTimeout(probeUnanswered);
                                if (contextMenuCheck === latestContextMenuCheck) {
                                    if (results[0] && results[0].result === 'application/pdf') {
                                        addContextMenuEntry();
                                    } else {
                                        removeContextMenuEntry();
                                    }
                                }
                            }, function () {
                                clearTimeout(probeUnanswered);
                                if (contextMenuCheck === latestContextMenuCheck) {
                                    addContextMenuEntry();
                                }
                            });
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
            if (request.gesture === 'doubleRightClick') {
                handleDoubleRightClick(request, sender.tab);
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
