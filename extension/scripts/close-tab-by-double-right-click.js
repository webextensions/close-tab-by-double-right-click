/*global chrome*/

if (window.DRCsetup === undefined) {
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
            }, 500);

            var thisTime = new Date(),
                timeDiff = thisTime - lastTime;
            lastTime = thisTime;

            // Using timeDiff >= 100 is used to avoid the following cases:
            //     1. Receiving too many clicks if the mouse's mechanics is faulty in the sense that it receives multiple clicks even though the
            //        user intended to click only once
            //     2. User is clicking too fast and might close more tabs than he/she wishes to
            if ((counter === 2 && timeDiff >= 100) || counter > 2) {
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
            // document.body.onmousedown = document.body.onmouseup = function (e) {
                // recieveRightClick(e);
            // };

            // Not 100% sure, but it seems that if we register "document.onmouseup"
            // without checking for "document.body", then it may not behave properly.
            // In that case, it seems to be providing a delayed execution of closing the tab
            // (which may be harmful if user keeps on double-right-clicking and the clicks
            // might be received by other tabs as the current tab closes),
            // probably due to the architecture of the browser.
            document.onmousedown = document.onmouseup = function (e) {
                recieveRightClick(e);
            };

            clearInterval(interval);
        }
    }, 100);

    window.DRCsetup = true;
}
