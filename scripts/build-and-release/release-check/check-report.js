// Prints one "ok" or "FAIL" line per check of release-check.js and release-check-zips.js, and remembers whether any
// check failed, so that a script can run all its checks first and set the exit code at the end.

import { styleText } from 'node:util';

export const createCheckReport = function () {
    let failedCount = 0;

    return {
        check: function (passed, message) {
            if (!passed) {
                failedCount++;
            }
            console.log(`${passed ? styleText('green', '  ok  ') : styleText('red', 'FAIL  ')}${message}`);
            return passed;
        },
        get failedCount() {
            return failedCount;
        }
    };
};
