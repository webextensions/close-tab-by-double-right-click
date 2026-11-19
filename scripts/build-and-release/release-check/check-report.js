// Prints one line per check of release-check.js and release-check-zips.js (with a check mark or a cross), and remembers
// whether any check failed, so that a script can run all its checks first and set the exit code at the end.

import { failureMark, successMark } from '../marks.js';

export const createCheckReport = function () {
    let failedCount = 0;

    return {
        check: function (passed, message) {
            if (!passed) {
                failedCount++;
            }
            console.log(`${passed ? successMark() : failureMark()} ${message}`);
            return passed;
        },
        get failedCount() {
            return failedCount;
        }
    };
};
