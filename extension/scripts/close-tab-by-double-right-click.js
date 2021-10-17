/* global chrome, utils */

if (window.DRCsetup === undefined) {
    setTimeout(async function () {
        const MAXIMUM_TIME_BETWEEN_CLICKS_TYPE = 'MAXIMUM_TIME_BETWEEN_CLICKS_TYPE';
        const MAXIMUM_TIME_BETWEEN_CLICKS_VALUE = 'MAXIMUM_TIME_BETWEEN_CLICKS_VALUE';

        const TIME_BETWEEN_CLICKS_RANGE_MIN = 100;
        const TIME_BETWEEN_CLICKS_RANGE_MAX = 2000;
        const TIME_BETWEEN_CLICKS_DEFAULT = 500;

        // Note:
        //     In Firefox, using sync storage requires an add-on ID (https://extensionworkshop.com/documentation/develop/extensions-and-the-add-on-id/#when-do-you-need-an-add-on-id)
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

        var recieveRightClick = (function () {
            var counter = 0,
                lastTime = new Date(),
                tabRemoveAlreadyRequested = false;
            return function (e) {
                if (e.which !== 3) {
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
                if ((counter === 2 && timeDiff >= 50) || counter > 2) {
                    if (!tabRemoveAlreadyRequested) {
                        tabRemoveAlreadyRequested = true;
                        chrome.runtime.sendMessage({closeTab: true});
                    }
                }
            };
        }());

        var interval = setInterval(function () {
            if (document.body) {
                // document.body events seem to be getting affected by prevention of event bubbling
                // document.body.onmouseup = function (e) {
                //     recieveRightClick(e);
                // };

                // Not 100% sure, but it seems that if we register "document.onmouseup"
                // without checking for "document.body", then it may not behave properly.
                // In that case, it seems to be providing a delayed execution of closing the tab
                // (which may be harmful if user keeps on double-right-clicking and the clicks
                // might be received by other tabs as the current tab closes),
                // probably due to the architecture of the browser.
                document.onmouseup = function (e) {
                    recieveRightClick(e);
                };

                var isLinux = navigator.platform.toUpperCase().indexOf('LINUX') >= 0,
                    isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
                if (isLinux && isChrome) {
                    // HACK: Attaching "document.onmousedown" as a hack for Linux due to the following Chromium bug, which is marked as Won't Fix:
                    //       https://bugs.chromium.org/p/chromium/issues/detail?id=506801 (Right-click should fire mouseup event after contextmenu)
                    document.onmousedown = function (e) {
                        recieveRightClick(e);
                    };
                }

                clearInterval(interval);
            }
        }, 100);

        window.DRCsetup = true;
    });
}
