/* global chrome, utils */

var flagFirefox102Plus = (function () {
    try {
        const firefoxVersion = parseInt(
            navigator.userAgent.split('Firefox/')[1],
            10
        );
        if (firefoxVersion >= 102) {
            return true;
        }
    } catch (e) {
        // do nothing
    }
    return false;
}());

if (window.DRCsetup === undefined) {
    setTimeout(async function () {
        const MAXIMUM_TIME_BETWEEN_CLICKS_TYPE = 'MAXIMUM_TIME_BETWEEN_CLICKS_TYPE';
        const MAXIMUM_TIME_BETWEEN_CLICKS_VALUE = 'MAXIMUM_TIME_BETWEEN_CLICKS_VALUE';

        const TIME_BETWEEN_CLICKS_RANGE_MIN = 100;
        const TIME_BETWEEN_CLICKS_RANGE_MAX = 2000;
        const TIME_BETWEEN_CLICKS_DEFAULT = 500;

        // Note:
        //     In Firefox, using sync storage requires an add-on ID (https://extensionworkshop.com/documentation/develop/extensions-and-the-add-on-id/#when-do-you-need-an-add-on-id)
        //     To handle that, during development, add the following property at JSON root in manifest.json
        //         "applications": {
        //             "gecko": {
        //                 "id": "any-unique-enough-email-during-development@example.com"
        //             }
        //         }
        var chromeStorageForExtensionData = chrome.storage.sync || chrome.storage.local;

        let maxTimeBetweenClicksType;
        let maxTimeBetweenClicksValue;

        try {
            let fromStorageMaxTimeBetweenClicksType = await utils.chromeStorageGet(chromeStorageForExtensionData, MAXIMUM_TIME_BETWEEN_CLICKS_TYPE);
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
                let fromStorageMaxTimeBetweenClicksValue = await utils.chromeStorageGet(chromeStorageForExtensionData, MAXIMUM_TIME_BETWEEN_CLICKS_VALUE);
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

        var recieveClick = (function () {
            var counter = 0,
                lastTime = new Date(),
                tabRemoveAlreadyRequested = false;
            return function (e, whichClick) {
                if (whichClick === 'right') {
                    if (e.which !== 3) {
                        return;
                    }
                } else if (whichClick === 'left') {
                    if (e.which !== 1) {
                        return;
                    }
                }

                if (e.which === 1 && counter >= 1) {
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
                        (timeDiff >= 50 || flagFirefox102Plus) // For right-click-context-menu-open state on a page, if we do left-click-followed-by-right-click (to be used in Firefox 102+ versions), the timeDiff might have a very small value (eg: 5ms)
                    )
                ) {
                    if (!tabRemoveAlreadyRequested) {
                        tabRemoveAlreadyRequested = true;

                        // Note: Ideally, `chrome.runtime` should be available in all cases, but if the extension instance is disabled
                        //       due to disabling / reloading extension, then `chrome.runtime` wouldn't be available.
                        if (chrome.runtime) {
                            chrome.runtime.sendMessage({closeTab: true});
                        }
                    }
                }
            };
        }());

        var interval = setInterval(function () {
            if (document.body) {
                // document.body events seem to be getting affected by prevention of event bubbling
                // document.body.onmouseup = function (e) {
                //     recieveClick(e, 'right');
                //     recieveClick(e, 'left');
                // };

                // Not 100% sure, but it seems that if we register "document.onmouseup"
                // without checking for "document.body", then it may not behave properly.
                // In that case, it seems to be providing a delayed execution of closing the tab
                // (which may be harmful if user keeps on double-right-clicking and the clicks
                // might be received by other tabs as the current tab closes),
                // probably due to the architecture of the browser.
                document.onmouseup = function (e) {
                    recieveClick(e, 'right');
                    recieveClick(e, 'left');
                };

                var isLinux = navigator.platform.toUpperCase().indexOf('LINUX') >= 0,
                    isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);

                // HACK:
                //       * Attaching "document.onmousedown" as a hack for Linux due to the following Chromium bug, which is marked as Won't Fix:
                //         https://bugs.chromium.org/p/chromium/issues/detail?id=506801 (Right-click should fire mouseup event after contextmenu)
                //       * Like Chromium for Linux, similar effect/browser-behavior seems to happen for Firefox 102 onwards
                //         (https://github.com/webextensions/close-tab-by-double-right-click/issues/12)
                if (
                    isLinux &&
                    (isChrome || flagFirefox102Plus)
                ) {
                    document.onmousedown = function (e) {
                        recieveClick(e, 'right');
                        recieveClick(e, 'left');
                    };
                }

                clearInterval(interval);
            }
        }, 100);

        window.DRCsetup = true;
    });
}
