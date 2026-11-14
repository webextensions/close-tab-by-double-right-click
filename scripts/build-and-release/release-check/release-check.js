// Runs as "npm run release:check", before "npm version" (see RELEASING.md). Checks that the repository is ready for a
// new version: on main, nothing uncommitted, the same commits as GitHub, the same version in package.json and the
// manifest, that version tagged, and something to release since that tag. Then prints the commits since that tag, as
// a draft of the release notes.
//
// It runs "git fetch origin" first, which updates only the remote-tracking refs. Otherwise it changes nothing. It
// works on the repository in the current folder (npm runs it in the project root).

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { createCheckReport } from './check-report.js';

const execFileAsync = promisify(execFile);

const RELEASE_BRANCH = 'main';
const REMOTE = 'origin';

const repoRoot = process.cwd();

const git = async function (...args) {
    const { stdout } = await execFileAsync('git', args, { cwd: repoRoot });
    // Only the end: the first line of "git status --porcelain" may start with a space
    return stdout.trimEnd();
};

const gitSucceeds = async function (...args) {
    try {
        await git(...args);
        return true;
    } catch {
        return false;
    }
};

const readVersion = async function (relativePath) {
    return JSON.parse(await readFile(path.join(repoRoot, relativePath), 'utf8')).version;
};

const report = createCheckReport();
const { check } = report;

let fetchError = null;
try {
    await git('fetch', REMOTE);
} catch (err) {
    fetchError = err;
}
check(!fetchError, fetchError
    ? `git fetch ${REMOTE} failed: ${fetchError.stderr?.trim() || fetchError.message}`
    : `fetched ${REMOTE}`);

const branch = await git('branch', '--show-current');
check(branch === RELEASE_BRANCH, branch === RELEASE_BRANCH
    ? `on branch ${RELEASE_BRANCH}`
    : `on ${branch ? `branch ${branch}` : 'a detached HEAD'}, not on ${RELEASE_BRANCH} (git switch ${RELEASE_BRANCH})`);

const changes = await git('status', '--porcelain');
check(!changes, changes
    ? `the working tree has changes which are not committed (npm version refuses to run then):\n${changes}`
    : 'working tree clean');

const remoteBranch = `${REMOTE}/${RELEASE_BRANCH}`;
if (await gitSucceeds('rev-parse', '--verify', '--quiet', `refs/remotes/${remoteBranch}`)) {
    const [behind, ahead] = (await git('rev-list', '--left-right', '--count', `${remoteBranch}...HEAD`))
        .split(/\s+/)
        .map(Number);
    const problems = [];
    if (ahead) {
        problems.push(`${ahead} commit(s) not pushed (git push)`);
    }
    if (behind) {
        problems.push(`${behind} commit(s) behind (git pull)`);
    }
    check(!problems.length, problems.length
        ? `HEAD differs from ${remoteBranch}: ${problems.join(', ')}`
        : `up to date with ${remoteBranch}`);
} else {
    check(false, `${remoteBranch} does not exist`);
}

const packageVersion = await readVersion('package.json');
const manifestVersion = await readVersion(path.join('extension', 'manifest.json'));
check(packageVersion === manifestVersion, packageVersion === manifestVersion
    ? `package.json and extension/manifest.json both have version ${packageVersion}`
    : `package.json has version ${packageVersion}, but extension/manifest.json has ${manifestVersion}`);

const lastTag = `v${packageVersion}`;
let commitsSinceTag = '';
if (check(await gitSucceeds('rev-parse', '--verify', '--quiet', `refs/tags/${lastTag}`), `tag ${lastTag} exists`)) {
    commitsSinceTag = await git('log', '--oneline', '--no-decorate', `${lastTag}..HEAD`);
    const count = commitsSinceTag ? commitsSinceTag.split('\n').length : 0;
    check(count > 0, count
        ? `${count} commit(s) since ${lastTag}`
        : `no commits since ${lastTag}: nothing to release`);
}

if (commitsSinceTag) {
    console.log(`\nCommits since ${lastTag} (a draft for the release notes):\n${commitsSinceTag}`);
}

const { failedCount } = report;
if (failedCount) {
    console.log(`\n${failedCount} check(s) failed: fix them before running "npm version"`);
} else {
    console.log('\nReady: run "npm version patch", "npm version minor" or "npm version major" (see RELEASING.md)');
}
process.exitCode = failedCount ? 1 : 0;
