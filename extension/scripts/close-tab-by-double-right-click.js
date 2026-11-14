if (window.DRCattachListeners) {
    // Injected again: a page can erase the listeners (eg: through document.open()), so attach them again. Attaching a
    // listener which is still there has no effect.
    window.DRCattachListeners();
} else {
    // [target, type, listener] for each listener of this script
    const listeners = [];

    window.DRCattachListeners = function () {
        listeners.forEach(function ([target, type, listener]) {
            target.addEventListener(type, listener, true);
        });
    };

    // Note: The "on<event>" properties (eg: document.onmouseup) must not be used, since Firefox shares them with the page
    const listen = function (target, type, handler) {
        const listener = function (e) {
            // Ignores the events which scripts create: otherwise any frame of a page could close the tab
            if (e.isTrusted) {
                handler(e);
            }
        };
        listeners.push([target, type, listener]);
        target.addEventListener(type, listener, true);
    };

    const MAXIMUM_TIME_BETWEEN_CLICKS_TYPE = 'MAXIMUM_TIME_BETWEEN_CLICKS_TYPE';
    const MAXIMUM_TIME_BETWEEN_CLICKS_VALUE = 'MAXIMUM_TIME_BETWEEN_CLICKS_VALUE';

    const TIME_BETWEEN_CLICKS_RANGE_MIN = 100;
    const TIME_BETWEEN_CLICKS_RANGE_MAX = 2000;
    const TIME_BETWEEN_CLICKS_DEFAULT = 500;

    // The default applies until the setting has been read, which happens at the end of this file
    let maxTimeBetweenClicksValue = TIME_BETWEEN_CLICKS_DEFAULT;

    var tabRemoveAlreadyRequested = false;
    var requestTabClose = function () {
        if (!tabRemoveAlreadyRequested) {
            tabRemoveAlreadyRequested = true;

            // Lets the gesture work again if the tab stays open (eg: the user chose to stay on a page which asks
            // before leaving). The background script ignores repeated requests for the same duration.
            setTimeout(function () {
                tabRemoveAlreadyRequested = false;
            }, 2500);

            // Note: Once the extension got disabled, removed or reloaded, this script is left behind without a working
            //       extension context: `chrome.runtime` is then missing or has no `id`, and sending a message would throw.
            if (chrome.runtime && chrome.runtime.id) {
                chrome.runtime.sendMessage({closeTab: true});
            }
        }
    };

    var receiveRightClick = (function () {
        var counter = 0,
            lastTime = new Date();
        return function (e) {
            if (e.button !== 2) {
                return;
            }

            counter++;

            setTimeout(function () {
                if (counter > 0) {
                    counter--;
                }
            }, maxTimeBetweenClicksValue);

            var thisTime = new Date(),
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
                requestTabClose();
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
    // held during it, and the "contextmenu" event received since then
    var rightPressCounted = false,
        rightPressWithShift = false,
        lastContextMenuEvent = null;

    listen(document, 'mouseup', function (e) {
        if (e.button === 2 && rightPressCounted) {
            rightPressCounted = false;
            var nativeContextMenuOpened = lastContextMenuEvent ?
                !lastContextMenuEvent.defaultPrevented :
                // On Shift + right click, Firefox opens its context menu without sending "contextmenu" to the page
                (isFirefox && rightPressWithShift);
            // Without a native context menu (eg: the page shows its own one), nothing swallows this
            // "mouseup", and it belongs to the right click which was already counted on "mousedown"
            if (!nativeContextMenuOpened) {
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
    //         (https://github.com/webextensions/close-tab-by-double-right-click/issues/12)
    if (isLinux) {
        listen(document, 'mousedown', function (e) {
            if (e.button === 2) {
                rightPressCounted = true;
                rightPressWithShift = e.shiftKey;
                lastContextMenuEvent = null;
            }
            receiveRightClick(e);
        });
        // "defaultPrevented" is read on "mouseup", by when the page has had its chance to cancel the event
        listen(window, 'contextmenu', function (e) {
            lastContextMenuEvent = e;
        });
    }

    // Chromium on Wayland: while the context menu is open, a second right click on the same spot only closes
    // the menu and never reaches the page. All the page gets is a "mousemove" without buttons at the unchanged
    // pointer position, so that is treated as the second right click, unless a key event (menu closed
    // through the keyboard) or another mouse event follows shortly. A left click on the same spot cannot be
    // told apart and counts as well. So does a key which closes the menu and is released later than
    // CONFIRMATION_DELAY, since the page only receives its "keyup".
    if (isLinux && isChromium) {
        const MAX_POINTER_SHIFT = 4; // In pixels
        const CONFIRMATION_DELAY = 150; // In milliseconds
        let rightPress = null;
        let confirmationTimer = null;
        const forget = function () {
            rightPress = null;
            clearTimeout(confirmationTimer);
            confirmationTimer = null;
        };
        const hasPointerShifted = function (e) {
            return (
                Math.abs(e.clientX - rightPress.x) > MAX_POINTER_SHIFT ||
                Math.abs(e.clientY - rightPress.y) > MAX_POINTER_SHIFT
            );
        };
        listen(document, 'mousedown', function (e) {
            forget();
            if (e.button === 2) {
                rightPress = { x: e.clientX, y: e.clientY, time: Date.now() };
            }
        });
        // A "mouseup" means that no context menu is swallowing the events
        listen(document, 'mouseup', forget);
        listen(document, 'keydown', forget);
        listen(document, 'keyup', forget);
        listen(document, 'mousemove', function (e) {
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
            const elapsed = Date.now() - rightPress.time;
            if (elapsed < 50 || elapsed > maxTimeBetweenClicksValue) {
                forget();
                return;
            }
            confirmationTimer = setTimeout(function () {
                forget();
                requestTabClose();
            }, CONFIRMATION_DELAY);
        });
    }

    // Keep this as the last statement: Firefox rejects the injection unless the file ends on a value which can be cloned
    setTimeout(async function () {
        var chromeStorageForExtensionData = chrome.storage.sync || chrome.storage.local;

        let maxTimeBetweenClicksType;

        try {
            let fromStorageMaxTimeBetweenClicksType = (await chromeStorageForExtensionData.get(MAXIMUM_TIME_BETWEEN_CLICKS_TYPE))[MAXIMUM_TIME_BETWEEN_CLICKS_TYPE];
            if (
                fromStorageMaxTimeBetweenClicksType === 'default' ||
                fromStorageMaxTimeBetweenClicksType === 'custom'
            ) {
                maxTimeBetweenClicksType = fromStorageMaxTimeBetweenClicksType;
            } else {
                maxTimeBetweenClicksType = 'default';
            }
        } catch (e) {
            maxTimeBetweenClicksType = 'default';
            console.log(`Caught an unexpected error while trying to read ${MAXIMUM_TIME_BETWEEN_CLICKS_TYPE}`);
            console.log(e);
        }

        if (maxTimeBetweenClicksType === 'custom') {
            try {
                let fromStorageMaxTimeBetweenClicksValue = (await chromeStorageForExtensionData.get(MAXIMUM_TIME_BETWEEN_CLICKS_VALUE))[MAXIMUM_TIME_BETWEEN_CLICKS_VALUE];
                if (fromStorageMaxTimeBetweenClicksValue) {
                    maxTimeBetweenClicksValue = parseInt(fromStorageMaxTimeBetweenClicksValue, 10);
                }
            } catch (e) {
                maxTimeBetweenClicksValue = TIME_BETWEEN_CLICKS_DEFAULT;
                console.log(`Caught an unexpected error while trying to read ${MAXIMUM_TIME_BETWEEN_CLICKS_VALUE}`);
                console.log(e);
            }
            if (
                Number.isInteger(maxTimeBetweenClicksValue) &&
                maxTimeBetweenClicksValue >= TIME_BETWEEN_CLICKS_RANGE_MIN &&
                maxTimeBetweenClicksValue <= TIME_BETWEEN_CLICKS_RANGE_MAX
            ) {
                // do nothing
            } else {
                maxTimeBetweenClicksValue = TIME_BETWEEN_CLICKS_DEFAULT;
            }
        } else {
            maxTimeBetweenClicksValue = TIME_BETWEEN_CLICKS_DEFAULT;
        }

        window.DRCready = true;
    });
}
