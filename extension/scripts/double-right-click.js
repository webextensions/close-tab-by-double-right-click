if (window.DRCattachListeners) {
    // Injected again: a page can erase the listeners (eg: through document.open()), so attach them again. Attaching a
    // listener which is still there has no effect.
    window.DRCattachListeners();
} else {
    // [target, type, listener, capture] for each listener of this script
    const listeners = [];

    window.DRCattachListeners = function () {
        listeners.forEach(function ([target, type, listener, capture]) {
            target.addEventListener(type, listener, capture);
        });
    };

    // document.open() erases the listeners and then replaces the root element, which is the only change this observer
    // gets told about. It survives that, so it attaches the listeners again.
    new MutationObserver(function () {
        window.DRCattachListeners();
    }).observe(document, { childList: true });

    // Note: The "on<event>" properties (eg: document.onmouseup) must not be used, since Firefox shares them with the page
    // Listens in the capture phase unless told otherwise
    const listen = function (target, type, handler, capture = true) {
        const listener = function (e) {
            // Ignores the events which scripts create: otherwise any frame of a page could close the tab
            if (e.isTrusted) {
                handler(e);
            }
        };
        listeners.push([target, type, listener, capture]);
        target.addEventListener(type, listener, capture);
    };

    const MAXIMUM_TIME_BETWEEN_CLICKS_TYPE = 'MAXIMUM_TIME_BETWEEN_CLICKS_TYPE';
    const MAXIMUM_TIME_BETWEEN_CLICKS_VALUE = 'MAXIMUM_TIME_BETWEEN_CLICKS_VALUE';

    const TIME_BETWEEN_CLICKS_RANGE_MIN = 100;
    const TIME_BETWEEN_CLICKS_RANGE_MAX = 2000;
    const TIME_BETWEEN_CLICKS_DEFAULT = 500;

    // The values which the dropdown of the options page offers: 100 to 750 ms in steps of 50, then up to 2000 ms in steps
    // of 100. Any other value (eg: 850, which it offered before) means the default.
    const isOfferedTimeBetweenClicks = function (value) {
        if (
            !Number.isInteger(value) ||
            value < TIME_BETWEEN_CLICKS_RANGE_MIN ||
            value > TIME_BETWEEN_CLICKS_RANGE_MAX
        ) {
            return false;
        }
        return value < 800 ? value % 50 === 0 : value % 100 === 0;
    };

    // The default applies until the setting has been read, which happens at the end of this file
    let maxTimeBetweenClicksValue = TIME_BETWEEN_CLICKS_DEFAULT;

    // The modifier keys which were held during a mouse event
    var readModifiers = function (e) {
        return { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey };
    };

    // When the user made an event, in milliseconds since the epoch. Unlike the time when its listener runs, a busy page
    // cannot delay it. Each document counts the "timeStamp" of its events from its own start, and this script also
    // listens in the placeholder documents of frames, which start later than the page. The start comes from the
    // document which the event reaches: inside a frame, Chromium gives "pointerrawupdate" the window of the top page as
    // its "view".
    const eventTime = function (e) {
        // Each listener of this script is on a document or on a window
        const target = e.currentTarget;
        const view = (target && target.defaultView) || (target && target.performance ? target : window);
        return view.performance.timeOrigin + e.timeStamp;
    };

    // The current time on the same clock as eventTime()
    const now = function () {
        return performance.timeOrigin + performance.now();
    };

    // The background script decides what the gesture does, from the modifier keys held on its first click (only the
    // first click reports them in Chromium on Wayland) and the user's settings.
    var gestureReported = false;
    var reportDoubleRightClick = function (modifiers) {
        if (!gestureReported) {
            gestureReported = true;

            // Ignores the further clicks of the same gesture (eg: a triple right click), whatever keys they had, until
            // those clicks stop counting, so that the next gesture counts again (eg: to reopen one more tab, or after
            // the user chose to stay on a page which asks before leaving). The background script ignores repeated
            // close requests for the same tab for longer.
            setTimeout(function () {
                gestureReported = false;
            }, maxTimeBetweenClicksValue);

            // Note: Once the extension got disabled, removed or reloaded, this script is left behind without a working
            //       extension context: `chrome.runtime` is then missing or has no `id`, and sending a message would throw.
            if (chrome.runtime && chrome.runtime.id) {
                chrome.runtime.sendMessage({
                    gesture: 'doubleRightClick',
                    shiftKey: modifiers.shiftKey,
                    ctrlKey: modifiers.ctrlKey,
                    altKey: modifiers.altKey,
                    metaKey: modifiers.metaKey
                });
            }
        }
    };

    var receiveRightClick = (function () {
        var counter = 0,
            lastTime = new Date(),
            lastModifiers = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };
        return function (e) {
            if (e.button !== 2) {
                return;
            }

            var modifiersOnFirstClick = lastModifiers;
            lastModifiers = readModifiers(e);

            counter++;

            setTimeout(function () {
                if (counter > 0) {
                    counter--;
                }
            }, maxTimeBetweenClicksValue);

            var thisTime = eventTime(e),
                timeDiff = thisTime - lastTime;
            lastTime = thisTime;

            // Using timeDiff >= 50 is used to avoid the following cases:
            //     1. Receiving too many clicks if the mouse's mechanics is faulty in the sense that it receives multiple clicks even though the
            //        user intended to click only once
            //     2. User is clicking too fast and might close more tabs than he/she wishes to
            if (
                counter > 2 ||
                (
                    counter === 2 &&
                    timeDiff >= 50
                )
            ) {
                reportDoubleRightClick(modifiersOnFirstClick);
            }
        };
    }());

    // The listeners below get attached right away, without waiting for the page (or even its <body>) to load: a slow
    // page can take minutes for that, and the double right click has to work in the meantime.

    // Also true on ChromeOS ("CrOS") and Android ("Linux; Android"). The user agent can be overridden, so
    // navigator.platform is checked as well.
    var isLinux = /Linux|CrOS/.test(navigator.userAgent) || /Linux/i.test(navigator.platform);
    var isFirefox = !!chrome.runtime && chrome.runtime.getURL('').startsWith('moz-extension://');
    var isChromium = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);

    // Only used on Linux: whether the "mousedown" of the latest right click was counted, whether Shift was
    // held during it, the "contextmenu" event received since then, and when the page was done with that event
    var rightPressCounted = false,
        rightPressWithShift = false,
        lastContextMenuEvent = null,
        contextMenuHandledAt = null;

    // How long the browser takes to show its context menu once the page is done with "contextmenu" (12 to 25 ms seen
    // in Firefox), in milliseconds
    const MENU_OPENING_TIME = 50;

    // The browser opens its native context menu only once the page is done with "contextmenu". A page which is busy
    // meanwhile (eg: a heavy site) gets the "mouseup" of a short right click before that menu could open and swallow
    // it, so that "mouseup" belongs to the right click which was already counted on "mousedown".
    var isReleaseBeforeMenuCouldOpen = function (e) {
        return (
            !!lastContextMenuEvent &&
            !lastContextMenuEvent.defaultPrevented &&
            (contextMenuHandledAt === null || eventTime(e) < contextMenuHandledAt + MENU_OPENING_TIME)
        );
    };

    listen(document, 'mouseup', function (e) {
        if (e.button === 2 && rightPressCounted) {
            rightPressCounted = false;
            var nativeContextMenuOpened = lastContextMenuEvent ?
                !lastContextMenuEvent.defaultPrevented :
                // On Shift + right click, Firefox opens its context menu without sending "contextmenu" to the page
                (isFirefox && rightPressWithShift);
            // Without a native context menu (eg: the page shows its own one), nothing swallows this
            // "mouseup", and it belongs to the right click which was already counted on "mousedown"
            if (!nativeContextMenuOpened || isReleaseBeforeMenuCouldOpen(e)) {
                return;
            }
        }
        receiveRightClick(e);
    });

    // HACK:
    //       * Listening for "mousedown" as a hack for Linux due to the following Chromium bug, which is marked as Won't Fix:
    //         https://bugs.chromium.org/p/chromium/issues/detail?id=506801 (Right-click should fire mouseup event after contextmenu)
    //       * Firefox for Linux behaves the same way (since Firefox 102, still the case in Firefox 160): the context menu swallows
    //         the "mouseup" of the first right click and the "mousedown" of the second one
    //         (https://github.com/webextensions/double-right-click/issues/12)
    if (isLinux) {
        listen(document, 'mousedown', function (e) {
            if (e.button === 2) {
                rightPressCounted = true;
                rightPressWithShift = e.shiftKey;
                lastContextMenuEvent = null;
                contextMenuHandledAt = null;
            }
            receiveRightClick(e);
        });
        // "defaultPrevented" is read on "mouseup", by when the page has had its chance to cancel the event
        listen(window, 'contextmenu', function (e) {
            lastContextMenuEvent = e;
            contextMenuHandledAt = null;
            // For a page which stops the event before it bubbles up to the window. A busy page delays this as well.
            setTimeout(function () {
                if (lastContextMenuEvent === e && contextMenuHandledAt === null) {
                    contextMenuHandledAt = now();
                }
            });
        });
        // Runs after the listeners of the page, except those which it attaches to the window later
        listen(window, 'contextmenu', function () {
            contextMenuHandledAt = now();
        }, false);
    }

    // Chromium on Wayland: while the context menu is open, a second right click on the same spot only closes
    // the menu and never reaches the page. All the page gets is a "mousemove" without buttons at the unchanged
    // pointer position, so that is treated as the second right click, unless a key event (menu closed
    // through the keyboard) or another mouse event follows shortly. A left click on the same spot cannot be
    // told apart and counts as well. So does a key which closes the menu and is released later than
    // CONFIRMATION_DELAY, since the page only receives its "keyup".
    // Chromium holds a "mousemove" back until it renders the next frame of the page, which takes up to 5 seconds on
    // a page which has not rendered anything yet (eg: it waits for a slow stylesheet or script in its <head>).
    // "pointerrawupdate" arrives without that delay. It costs the page some performance, so it is only listened for
    // while a right press waits for its second click, and it only exists on pages served over https.
    // The pointer positions are compared in screen coordinates: inside a frame of the same site, Chromium gives
    // "pointerrawupdate" the position within the top page, and "mousedown" and "mousemove" the one within the frame.
    if (isLinux && isChromium) {
        const MAX_POINTER_SHIFT = 4; // In pixels
        const CONFIRMATION_DELAY = 150; // In milliseconds
        let rightPress = null;
        let confirmationTimer = null;
        const receivePointerRawUpdate = function (e) {
            if (e.isTrusted) {
                receivePointerMove(e);
            }
        };
        const forget = function () {
            rightPress = null;
            clearTimeout(confirmationTimer);
            confirmationTimer = null;
            document.removeEventListener('pointerrawupdate', receivePointerRawUpdate, true);
        };
        const hasPointerShifted = function (e) {
            return (
                Math.abs(e.screenX - rightPress.x) > MAX_POINTER_SHIFT ||
                Math.abs(e.screenY - rightPress.y) > MAX_POINTER_SHIFT
            );
        };
        listen(document, 'mousedown', function (e) {
            forget();
            if (e.button === 2) {
                // That "mousemove" reports no modifier keys, even while they are held, so the press tells which were
                rightPress = { x: e.screenX, y: e.screenY, time: eventTime(e), modifiers: readModifiers(e) };
                document.addEventListener('pointerrawupdate', receivePointerRawUpdate, true);
            }
        });
        // A "mouseup" means that no context menu is swallowing the events
        listen(document, 'mouseup', forget);
        // Except for the modifier keys, which do not close the menu: the page gets the "keyup" of a modifier key released
        // right after the second click (eg: of a Shift + double right click) within CONFIRMATION_DELAY
        const MODIFIER_KEYS = ['Shift', 'Control', 'Alt', 'Meta'];
        const forgetUnlessModifierKey = function (e) {
            if (!MODIFIER_KEYS.includes(e.key)) {
                forget();
            }
        };
        listen(document, 'keydown', forgetUnlessModifierKey);
        listen(document, 'keyup', forgetUnlessModifierKey);
        const receivePointerMove = function (e) {
            if (!rightPress) {
                return;
            }
            if (hasPointerShifted(e)) {
                forget();
                return;
            }
            if (confirmationTimer || e.buttons !== 0) {
                return;
            }
            const elapsed = eventTime(e) - rightPress.time;
            if (elapsed < 50 || elapsed > maxTimeBetweenClicksValue) {
                forget();
                return;
            }
            const modifiers = rightPress.modifiers;
            confirmationTimer = setTimeout(function () {
                forget();
                reportDoubleRightClick(modifiers);
            }, CONFIRMATION_DELAY);
        };
        listen(document, 'mousemove', receivePointerMove);
    }

    // A frame which still waits for its own page shows an empty placeholder document, in which the browser does not run
    // this script, so a double right click on such a frame would do nothing. The placeholder belongs to this page
    // (whatever site the frame is loading), so this page listens there itself, and counts the clicks on the frame
    // together with its own. Those listeners go away with the placeholder: once the page of the frame arrives, it gets
    // this script by itself.
    // "mouseover" tells that the pointer is on a frame, which it is before any click there. The browser also sends it
    // for a pointer which rests where a frame shows up.
    const placeholdersListenedTo = new WeakSet();
    listen(document, 'mouseover', function (e) {
        const frame = e.target;
        if (!frame || (frame.localName !== 'iframe' && frame.localName !== 'frame')) {
            return;
        }
        // A frame without a page to load keeps its empty document, where the browser does run this script
        const src = frame.getAttribute('src');
        if (!src || /^(about|javascript):/i.test(src)) {
            return;
        }
        // Not available once the frame shows a page of another site
        const placeholder = frame.contentDocument;
        if (!placeholder || placeholder.URL !== 'about:blank' || placeholdersListenedTo.has(placeholder)) {
            return;
        }
        placeholdersListenedTo.add(placeholder);
        listeners.forEach(function ([, type, listener, capture]) {
            placeholder.addEventListener(type, listener, capture);
        });
    });

    // Read on start, and again on each change of the setting, so that the pages which are already open follow it at
    // once. Both keys come in one read, so that two reads at the same time cannot mix their halves.
    const readMaxTimeBetweenClicks = async function () {
        var chromeStorageForExtensionData = chrome.storage.sync || chrome.storage.local;

        let values;
        try {
            values = await chromeStorageForExtensionData.get([
                MAXIMUM_TIME_BETWEEN_CLICKS_TYPE,
                MAXIMUM_TIME_BETWEEN_CLICKS_VALUE
            ]);
        } catch (e) {
            values = {};
            console.log('Caught an unexpected error while trying to read the maximum time between clicks');
            console.log(e);
        }

        if (values[MAXIMUM_TIME_BETWEEN_CLICKS_TYPE] === 'custom') {
            const value = parseInt(values[MAXIMUM_TIME_BETWEEN_CLICKS_VALUE], 10);
            maxTimeBetweenClicksValue = isOfferedTimeBetweenClicks(value) ? value : TIME_BETWEEN_CLICKS_DEFAULT;
        } else {
            maxTimeBetweenClicksValue = TIME_BETWEEN_CLICKS_DEFAULT;
        }

        // Read by the tests; only this script's isolated world sees it, not the page
        window.DRCmaxTimeBetweenClicks = maxTimeBetweenClicksValue;
        window.DRCready = true;
    };

    // Every frame of every tab hears of each change, also of the other settings, so the keys get checked first
    chrome.storage.onChanged.addListener(function (changes) {
        if (
            Object.hasOwn(changes, MAXIMUM_TIME_BETWEEN_CLICKS_TYPE) ||
            Object.hasOwn(changes, MAXIMUM_TIME_BETWEEN_CLICKS_VALUE)
        ) {
            readMaxTimeBetweenClicks();
        }
    });

    // A page kept in the back/forward cache may have missed a change while it was frozen. Once the extension got
    // disabled, removed or reloaded, the page can come back with this script left behind, which can read nothing.
    listen(window, 'pageshow', function (e) {
        if (e.persisted && chrome.runtime && chrome.runtime.id) {
            readMaxTimeBetweenClicks();
        }
    });

    // Keep this as the last statement: Firefox rejects the injection unless the file ends on a value which can be cloned
    setTimeout(readMaxTimeBetweenClicks);
}
