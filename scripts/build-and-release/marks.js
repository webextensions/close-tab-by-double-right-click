// The marks which start a result line of the build and release scripts: a green check mark for success, a red cross
// for failure. styleText leaves the colors out where the stream is not a terminal (or with NO_COLOR), so logs and tests
// get the plain marks.

import { styleText } from 'node:util';

export const successMark = function (stream = process.stdout) {
    return styleText('green', '\u2714', { stream });
};

export const failureMark = function (stream = process.stdout) {
    return styleText('red', '\u2716', { stream });
};
