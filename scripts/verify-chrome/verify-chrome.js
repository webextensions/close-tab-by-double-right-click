// Checks the double right click gesture in a real Chromium window with real mouse and keyboard input.
//
// The Playwright tests cannot cover this: their synthetic clicks never open the native context menu, and that menu is
// what swallows parts of a double right click on Linux (differently under Wayland and under X11). This script instead:
//
// - launches Playwright's Chromium with a visible window and the extension loaded, once per display mode
// - sends OS-level clicks and key presses through scripts/real-input/real_input.py (GNOME's RemoteDesktop D-Bus API)
// - reads the outcome (tab closed or still open) back through Playwright
//
// Requirements: Linux with GNOME, python3-gi, and "npx playwright install chromium".
// It takes over the mouse and keyboard for about two minutes: do not touch them while it runs.
//
// Usage: npm run verify:chrome (generates dist/chrome first), or
// node scripts/verify-chrome/verify-chrome.js [path/to/extension]

import { execFile } from 'node:child_process';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

import { chromium } from '@playwright/test';

import {
    CANCEL_CONTEXT_MENU_PAGE,
    STALLED_HEAD_PAGE,
    STALLED_IMAGE_PAGE,
    STALLED_PATH,
    TEST_PAGE,
    isContentScriptReady
} from '../../tests/shared/test-pages.js';

const execFileAsync = promisify(execFile);

const projectRoot = path.join(import.meta.dirname, '..', '..');
const extensionPath = path.resolve(process.argv[2] ?? path.join(projectRoot, 'dist', 'chrome'));
const realInputScript = path.join(projectRoot, 'scripts', 'real-input', 'real_input.py');

// The content script only runs in http(s) pages, so serve the test pages from a fake https origin
const TEST_ORIGIN = 'https://drc.test';
const TEST_URL = `${TEST_ORIGIN}/verify-chrome`;
// A page which shows its own context menu cancels the browser's one, so nothing swallows parts of a right click there
const CANCEL_CONTEXT_MENU_URL = `${TEST_ORIGIN}/cancel-context-menu`;
// Pages which never finish loading: the first one stalls before it gets a body, the second one shows its content
const STALLED_HEAD_URL = `${TEST_ORIGIN}/stalled-head`;
const STALLED_IMAGE_URL = `${TEST_ORIGIN}/stalled-image`;
const STALLED_URLS = [STALLED_HEAD_URL, STALLED_IMAGE_URL];

// A spot inside the page of the full screen window
const POINTER = { x: 600, y: 450 };

// Chromium picks Wayland on a Wayland session, where X11 (through XWayland) still works and behaves differently
const displayModes = process.env.XDG_SESSION_TYPE === 'wayland' ? ['wayland', 'x11'] : ['x11'];

// [name, whether the tab should get closed, real_input.py commands, page (TEST_URL unless given)]
const checks = [
    ['single right click keeps the tab open', false, ['right', 'sleep', 1.2]],
    ['double right click (mouse not moved) closes the tab', true, ['right', 'sleep', 0.15, 'right', 'sleep', 1.2]],
    ['double right click 420 ms apart closes the tab', true, ['right', 'sleep', 0.42, 'right', 'sleep', 1.2]],
    ['double right click with the pointer shifted by 3 px closes the tab', true, ['right', 'sleep', 0.1, 'rel', -3, -3, 'right', 'sleep', 1.2]],
    ['right clicks 800 ms apart keep the tab open (default 500 ms)', false, ['right', 'sleep', 0.8, 'right', 'sleep', 1.2]],
    ['right click followed by a quick Escape keeps the tab open', false, ['right', 'sleep', 0.15, 'esc', 'sleep', 1.2]],
    ['right click followed by a left click 120 px away keeps the tab open', false, ['right', 'sleep', 0.15, 'rel', -120, -120, 'left', 'sleep', 1.2]],
    [
        'single right click held for 120 ms on a page which cancels the context menu keeps the tab open',
        false,
        ['right-hold', 0.12, 'sleep', 1.2],
        CANCEL_CONTEXT_MENU_URL
    ],
    [
        'double right click on a page which cancels the context menu closes the tab',
        true,
        ['right-hold', 0.12, 'sleep', 0.15, 'right-hold', 0.12, 'sleep', 1.2],
        CANCEL_CONTEXT_MENU_URL
    ],
    [
        'single right click on a page which shows its content while it keeps loading keeps the tab open',
        false,
        ['right', 'sleep', 1.2],
        STALLED_IMAGE_URL
    ],
    [
        'double right click on a page which shows its content while it keeps loading closes the tab',
        true,
        ['right', 'sleep', 0.15, 'right', 'sleep', 1.2],
        STALLED_IMAGE_URL
    ],
    [
        'single right click on a page which is stalled in its <head> keeps the tab open',
        false,
        ['right', 'sleep', 1.2],
        STALLED_HEAD_URL
    ],
    [
        'double right click on a page which is stalled in its <head> closes the tab',
        true,
        ['right', 'sleep', 0.15, 'right', 'sleep', 1.2],
        STALLED_HEAD_URL
    ]
];

const results = [];

const realInput = async function (...commands) {
    await execFileAsync('python3', [realInputScript, ...commands.map(String)]);
};

const openTestPage = async function (context, serviceWorker, url) {
    const page = await context.newPage();
    // A stalled page never fires its "load" event
    await page.goto(url, { waitUntil: STALLED_URLS.includes(url) ? 'commit' : 'load' });

    const deadline = Date.now() + 15000;
    while (!(await isContentScriptReady(serviceWorker, url))) {
        if (Date.now() > deadline) {
            throw new Error('The content script did not get injected into the test page');
        }
        await sleep(200);
    }

    await page.bringToFront();
    // The left click focuses the window; the extension ignores left clicks
    await realInput('move', POINTER.x, POINTER.y, 'left', 'sleep', 0.6);
    return page;
};

const undoPointerShifts = function (commands) {
    const undo = [];
    commands.forEach((command, index) => {
        if (command === 'rel') {
            undo.push('rel', -commands[index + 1], -commands[index + 2]);
        }
    });
    return undo;
};

const runChecks = async function (displayMode) {
    const context = await chromium.launchPersistentContext('', {
        channel: 'chromium',
        headless: false,
        viewport: null,
        args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
            `--ozone-platform=${displayMode}`,
            '--start-fullscreen'
        ]
    });

    try {
        await context.route(TEST_URL, (route) => route.fulfill({ contentType: 'text/html', body: TEST_PAGE }));
        await context.route(CANCEL_CONTEXT_MENU_URL, (route) => {
            return route.fulfill({ contentType: 'text/html', body: CANCEL_CONTEXT_MENU_PAGE });
        });
        await context.route(STALLED_HEAD_URL, (route) => route.fulfill({ contentType: 'text/html', body: STALLED_HEAD_PAGE }));
        await context.route(STALLED_IMAGE_URL, (route) => route.fulfill({ contentType: 'text/html', body: STALLED_IMAGE_PAGE }));
        // Never answered
        await context.route(`${TEST_ORIGIN}${STALLED_PATH}**`, () => {});

        let [serviceWorker] = context.serviceWorkers();
        if (!serviceWorker) {
            serviceWorker = await context.waitForEvent('serviceworker');
        }

        let page;
        for (const [name, shouldClose, commands, url = TEST_URL] of checks) {
            if (page && !page.isClosed() && page.url() !== url) {
                await page.close();
            }
            if (!page || page.isClosed()) {
                page = await openTestPage(context, serviceWorker, url);
            }

            await realInput(...commands);
            // Lets Playwright notice that the tab got closed
            await sleep(400);

            const closed = page.isClosed();
            const passed = closed === shouldClose;
            results.push(passed);
            console.log(`${passed ? 'PASS' : 'FAIL'}  [${displayMode}] ${name}`);

            if (!closed) {
                // Closes the context menu, and returns the pointer without parking it in a screen corner again
                // (which would open the GNOME overview)
                await realInput('esc', 'sleep', 0.4, ...undoPointerShifts(commands));
            }
        }
    } finally {
        await realInput('esc').catch(() => {});
        await context.close();
    }
};

for (const displayMode of displayModes) {
    try {
        await runChecks(displayMode);
    } catch (err) {
        results.push(false);
        console.log(`FAIL  [${displayMode}] ${err.message.split('\n')[0]}`);
    }
}

const failed = results.filter((passed) => !passed).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
