// Runs a chosen mix of the project's checks: the two lints, the end-to-end tests (all of them or single spec files),
// the tests against real sites, and the checks with real mouse and keyboard input. It shows a list to pick from, with
// a rough time for each item, and remembers the picks in .test-custom.json (git-ignored) for the next run.
//
// It builds the dist/ folders which the picks need once, then runs the picks one after the other, fastest first, and
// keeps going when one of them fails. Right before each check with real input, it counts down for 5 seconds (Ctrl+C
// aborts). At the end, it prints which picks passed.
//
// Usage: npm run test:custom [-- --last] [-- --dry-run]
// - --last: run the picks of the last run (the default picks if there is none) without showing the list
// - --dry-run: print what would run, without saving the picks, building or running anything
//
// A .test-custom.json which is not valid JSON, or not in the expected shape, gets removed.

import { spawn } from 'node:child_process';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs, styleText } from 'node:util';

import { cancel, groupMultiselect, intro, isCancel, log, outro } from '@clack/prompts';

const { values: { last: useLastPicks, 'dry-run': dryRun } } = parseArgs({
    options: { 'last': { type: 'boolean' }, 'dry-run': { type: 'boolean' } }
});

const projectRoot = path.join(import.meta.dirname, '..', '..');
const STATE_FILE = '.test-custom.json';
const statePath = path.join(projectRoot, STATE_FILE);
const buildScript = path.join('scripts', 'build-and-release', 'build-dist', 'build-dist.js');

// Stands for every spec file in tests/e2e/, so that a spec file added later gets picked as well
const ALL_E2E_SPECS = 'test:e2e';
const DEFAULT_PICKS = ['lint', 'lint:firefox', ALL_E2E_SPECS, 'verify:firefox', 'verify:chrome'];
const REAL_INPUT_COUNTDOWN_SECONDS = 5;

// The rough time of each end-to-end spec file
const e2eSpecTimes = {
    'build.spec.js': '1-3 s',
    'close-tab.spec.js': '20-30 s',
    'context-menu-dismissal.spec.js': '12-20 s',
    'context-menu.spec.js': '5-12 s',
    'extension-lifecycle.spec.js': '3-6 s',
    'gestures.spec.js': '25-40 s',
    'injection-failure.spec.js': '1-3 s',
    'late-frame.spec.js': '5-10 s',
    'linux-detection.spec.js': '1-3 s',
    'loading-page.spec.js': '5-10 s',
    'manifest.spec.js': '1-3 s',
    'options.spec.js': '20-35 s',
    'popup.spec.js': '3-6 s',
    'release-check.spec.js': '6-12 s',
    'reopen-tab.spec.js': '20-35 s',
    'setup.spec.js': '1-3 s',
    'untrusted-events.spec.js': '3-6 s',
    'window-focus.spec.js': '2-5 s'
};

const e2eSpecFiles = (await readdir(path.join(projectRoot, 'tests', 'e2e')))
    .filter((file) => file.endsWith('.spec.js'))
    .sort();
const e2eSpecIds = e2eSpecFiles.map((file) => `tests/e2e/${file}`);

// What can be picked, in the order it runs. The commands are those of the scripts of package.json without their
// build step: keep them in sync.
const groups = [
    {
        name: 'Lint',
        items: [
            { id: 'lint', label: 'lint (ESLint)', time: '1-5 s', command: ['eslint', '.'] },
            {
                id: 'lint:firefox',
                label: 'lint:firefox (web-ext lint)',
                time: '1-5 s',
                build: 'firefox',
                command: ['web-ext', 'lint']
            }
        ]
    },
    {
        name: 'End-to-end tests in Chromium (test:e2e, about 100-180 s in all)',
        items: e2eSpecFiles.map((file, index) => ({
            id: e2eSpecIds[index],
            label: file,
            time: e2eSpecTimes[file] ?? 'time unknown'
        })),
        // All picked spec files run in one go
        toSteps: function (pickedItems) {
            if (!pickedItems.length) {
                return [];
            }
            const all = pickedItems.length === e2eSpecFiles.length;
            return [{
                id: all ? ALL_E2E_SPECS : `test:e2e (${pickedItems.length} of ${e2eSpecFiles.length} files)`,
                time: all ? '100-180 s' : undefined,
                build: 'chrome',
                command: ['playwright', 'test', ...(all ? [] : pickedItems.map((item) => item.id))]
            }];
        }
    },
    {
        name: 'Real sites in Chromium (need internet access)',
        items: [
            {
                id: 'test:sites',
                label: 'test:sites (visible windows)',
                time: '3-6 min',
                build: 'chrome',
                command: ['playwright', 'test', '--config', 'playwright.sites.config.js', '--headed']
            },
            {
                id: 'test:sites:headless',
                label: 'test:sites:headless (no windows)',
                time: '3-6 min',
                build: 'chrome',
                command: ['playwright', 'test', '--config', 'playwright.sites.config.js']
            }
        ]
    },
    {
        name: 'Real mouse and keyboard input (take them over; Linux with GNOME only)',
        items: [
            {
                id: 'verify:firefox',
                label: 'verify:firefox',
                time: '3-5 min',
                build: 'firefox',
                realInput: true,
                command: ['python3', 'scripts/verify-firefox/verify-firefox.py']
            },
            {
                id: 'verify:chrome',
                label: 'verify:chrome',
                time: '3-5 min',
                build: 'chrome',
                realInput: true,
                command: [process.execPath, 'scripts/verify-chrome/verify-chrome.js']
            },
            {
                id: 'verify:firefox:sites',
                label: 'verify:firefox:sites (internet)',
                time: '4-7 min',
                build: 'firefox',
                realInput: true,
                command: ['python3', 'scripts/verify-firefox/verify-firefox.py', '--sites']
            },
            {
                id: 'verify:chrome:sites',
                label: 'verify:chrome:sites (internet)',
                time: '8-12 min',
                build: 'chrome',
                realInput: true,
                command: [process.execPath, 'scripts/verify-chrome/verify-chrome.js', '--sites']
            }
        ]
    }
];
const itemIds = groups.flatMap((group) => group.items.map((item) => item.id));

// Leaves out what no longer exists, and puts the picks in the order of the list
const sortPicks = function (picks) {
    return itemIds.filter((id) => picks.includes(id));
};

// The saved picks name all spec files as ALL_E2E_SPECS; the list names each of them
const expandPicks = function (savedPicks) {
    return sortPicks(savedPicks.flatMap((id) => (id === ALL_E2E_SPECS ? e2eSpecIds : [id])));
};
const collapsePicks = function (picks) {
    if (!e2eSpecIds.length || !e2eSpecIds.every((id) => picks.includes(id))) {
        return picks;
    }
    const firstSpecIndex = picks.findIndex((id) => e2eSpecIds.includes(id));
    const otherPicks = picks.filter((id) => !e2eSpecIds.includes(id));
    otherPicks.splice(firstSpecIndex, 0, ALL_E2E_SPECS);
    return otherPicks;
};

const isValidState = function (state) {
    return state !== null && typeof state === 'object' && !Array.isArray(state) &&
        Array.isArray(state.selected) && state.selected.every((id) => typeof id === 'string');
};

// Returns the saved picks (with what no longer exists left out), or the default picks
const loadPicksAsync = async function () {
    let text;
    try {
        text = await readFile(statePath, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') {
            return { picks: expandPicks(DEFAULT_PICKS), saved: false };
        }
        throw err;
    }

    let state;
    let problem;
    try {
        state = JSON.parse(text);
        if (!isValidState(state)) {
            problem = 'it was not in the expected shape';
        }
    } catch {
        problem = 'it was not valid JSON';
    }
    if (problem) {
        await rm(statePath);
        log.warn(`Removed ${STATE_FILE}: ${problem}`);
        return { picks: expandPicks(DEFAULT_PICKS), saved: false };
    }

    const picks = expandPicks(state.selected);
    return picks.length ? { picks, saved: true } : { picks: expandPicks(DEFAULT_PICKS), saved: false };
};

const formatDuration = function (milliseconds) {
    const seconds = Math.round(milliseconds / 1000);
    return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
};

const formatCommand = function (command) {
    return command.map((part) => (part === process.execPath ? 'node' : part)).join(' ');
};

// Resolves with the exit code of the command, or 1 if it could not be started
const runAsync = function (command) {
    return new Promise((resolve) => {
        const child = spawn(command[0], command.slice(1), { cwd: projectRoot, stdio: 'inherit' });
        child.on('error', (err) => {
            log.error(`Could not run ${formatCommand(command)}: ${err.message}`);
            resolve(1);
        });
        child.on('exit', (code, signal) => {
            resolve(signal ? 1 : code);
        });
    });
};

if (!useLastPicks && !(process.stdin.isTTY && process.stdout.isTTY)) {
    console.error('test:custom needs an interactive terminal, or pass --last');
    process.exit(1);
}

intro('test:custom');

const { picks: loadedPicks, saved } = await loadPicksAsync();

let picks;
if (useLastPicks) {
    picks = loadedPicks;
    log.info(`${saved ? 'Picks of the last run' : 'Default picks'}: ${collapsePicks(picks).join(', ')}`);
} else {
    const labelWidth = Math.max(...groups.flatMap((group) => group.items.map((item) => item.label.length)));
    const answer = await groupMultiselect({
        message: 'What should run?',
        options: Object.fromEntries(groups.map((group) => [
            group.name,
            group.items.map((item) => ({
                value: item.id,
                label: `${item.label.padEnd(labelWidth)}  ${styleText('dim', `about ${item.time}`)}`
            }))
        ])),
        initialValues: loadedPicks,
        required: true
    });
    if (isCancel(answer)) {
        cancel('Nothing run');
        process.exit(0);
    }
    picks = sortPicks(answer);
}

if (!dryRun) {
    await writeFile(statePath, JSON.stringify({ selected: collapsePicks(picks) }, null, 4) + '\n');
}

const pickedIds = new Set(picks);
const steps = groups.flatMap(function (group) {
    const pickedItems = group.items.filter((item) => pickedIds.has(item.id));
    return group.toSteps ? group.toSteps(pickedItems) : pickedItems;
});
const browsers = [...new Set(steps.map((step) => step.build).filter(Boolean))];
const buildCommand = [process.execPath, buildScript, ...browsers];

if (dryRun) {
    if (browsers.length) {
        log.info(`Would build: ${formatCommand(buildCommand)}`);
    }
    for (const step of steps) {
        log.info(`Would run ${step.id}: ${formatCommand(step.command)}${step.realInput ? ' (real input)' : ''}`);
    }
    outro('Dry run: nothing saved, built or run');
    process.exit(0);
}

// Ctrl+C reaches the running command as well. Stop after it, and still print what ran.
let interrupted = false;
process.on('SIGINT', function () {
    interrupted = true;
});

if (browsers.length) {
    log.step(`Building ${browsers.map((browser) => `dist/${browser}`).join(' and ')}`);
    const buildExitCode = await runAsync(buildCommand);
    if (interrupted) {
        outro(styleText('yellow', 'Interrupted during the build: nothing else ran'));
        process.exit(130);
    }
    if (buildExitCode !== 0) {
        outro(styleText('red', 'The build failed: nothing else ran'));
        process.exit(1);
    }
}

const results = [];
for (const step of steps) {
    if (interrupted) {
        results.push({ step, status: 'not run' });
        continue;
    }
    if (step.realInput) {
        log.warn(
            `${step.id} takes over the mouse and keyboard for about ${step.time}: do not touch them while it runs.\n` +
            `It starts in ${REAL_INPUT_COUNTDOWN_SECONDS} seconds. Ctrl+C aborts.`
        );
        for (let seconds = REAL_INPUT_COUNTDOWN_SECONDS; seconds > 0 && !interrupted; seconds--) {
            process.stdout.write(`${seconds}... `);
            await sleep(1000);
        }
        process.stdout.write('\n');
        if (interrupted) {
            results.push({ step, status: 'not run' });
            continue;
        }
    }

    log.step(`${step.id}: ${formatCommand(step.command)}${step.time ? ` (about ${step.time})` : ''}`);
    const startTime = Date.now();
    const exitCode = await runAsync(step.command);
    const duration = Date.now() - startTime;
    if (interrupted) {
        results.push({ step, status: 'interrupted', duration });
    } else {
        results.push({ step, status: exitCode === 0 ? 'passed' : `failed (exit ${exitCode})`, duration });
    }
}

const statusColors = { 'passed': 'green', 'not run': 'dim', 'interrupted': 'yellow' };
const idWidth = Math.max(...results.map((result) => result.step.id.length));
const statusWidth = Math.max(...results.map((result) => result.status.length));
log.message(results.map(function ({ step, status, duration }) {
    const statusText = styleText(statusColors[status] ?? 'red', status.padEnd(statusWidth));
    return `${statusText}  ${step.id.padEnd(idWidth)}  ${duration === undefined ? '' : formatDuration(duration)}`.trimEnd();
}).join('\n'));

if (interrupted) {
    outro(styleText('yellow', 'Interrupted'));
    process.exit(130);
}
const failedCount = results.filter((result) => result.status !== 'passed').length;
outro(failedCount ? styleText('red', `${failedCount} of ${results.length} failed`) : styleText('green', 'All passed'));
process.exitCode = failedCount ? 1 : 0;
