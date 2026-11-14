import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify, stripVTControlCharacters } from 'node:util';

import JSZip from 'jszip';

import {
    expect,
    pathToChromeBuild,
    pathToSource,
    test
} from './fixtures.js';

const execFileAsync = promisify(execFile);

const projectRoot = path.join(import.meta.dirname, '..', '..');
const scriptsDir = path.join(projectRoot, 'scripts', 'build-and-release');
const buildScript = path.join(scriptsDir, 'build-dist', 'build-dist.js');
const releaseCheckScript = path.join(scriptsDir, 'release-check', 'release-check.js');
const releaseCheckZipsScript = path.join(scriptsDir, 'release-check', 'release-check-zips.js');
const buildSourceScript = path.join(scriptsDir, 'build-source', 'build-source.js');
const pathToFirefoxBuild = path.join(projectRoot, 'dist', 'firefox');
const { version } = JSON.parse(await readFile(path.join(pathToSource, 'manifest.json'), 'utf8'));

// Keeps the git configuration of the machine (signing, hooks, default branch) out of the test repositories
const gitEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com'
};

// Runs a script in the given folder and returns its exit code and output (without colors), without throwing when it
// fails
const runScript = async function (script, cwd) {
    try {
        const { stdout, stderr } = await execFileAsync(process.execPath, [script], { cwd, env: gitEnv });
        return { exitCode: 0, stdout: stripVTControlCharacters(stdout), stderr };
    } catch (err) {
        return { exitCode: err.code, stdout: stripVTControlCharacters(err.stdout), stderr: err.stderr };
    }
};

let tempDir;

test.beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'release-check-'));
});

test.afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
});

// These tests need no browser: they run the script in a temporary copy of what it reads
test.describe('release-check-zips.js', () => {
    const zipName = (browser, zipVersion = version) => `close_tab_by_double_right_click-${zipVersion}-${browser}.zip`;

    test.beforeAll(async () => {
        await execFileAsync(process.execPath, [buildScript]);
    });

    test.beforeEach(async () => {
        await writeFile(path.join(tempDir, 'package.json'), JSON.stringify({ version }));
        await cp(pathToSource, path.join(tempDir, 'extension'), { recursive: true });
        await mkdir(path.join(tempDir, 'web-ext-artifacts'));
    });

    // Zips a build folder into web-ext-artifacts/, as "npm run build" does. "files" replaces or adds files (by their
    // path in the zip), and a null value leaves a file out.
    const writeZip = async function (name, folder, files = {}) {
        const zip = new JSZip();
        for (const file of await readdir(folder, { recursive: true, withFileTypes: true })) {
            if (file.isFile()) {
                const filePath = path.join(file.parentPath, file.name);
                zip.file(path.relative(folder, filePath).split(path.sep).join('/'), await readFile(filePath));
            }
        }
        for (const [file, content] of Object.entries(files)) {
            if (content === null) {
                zip.remove(file);
            } else {
                zip.file(file, content);
            }
        }
        await writeFile(path.join(tempDir, 'web-ext-artifacts', name), await zip.generateAsync({ type: 'nodebuffer' }));
    };

    const writeChromeZip = (files) => writeZip(zipName('chrome'), pathToChromeBuild, files);
    const writeFirefoxZip = (files) => writeZip(zipName('firefox'), pathToFirefoxBuild, files);

    test('passes for the zips of the current build', async () => {
        await writeChromeZip();
        await writeFirefoxZip();

        const { exitCode, stdout } = await runScript(releaseCheckZipsScript, tempDir);

        expect(exitCode, stdout).toBe(0);
        expect(stdout).not.toContain('FAIL');
    });

    test('fails without the zip of a browser', async () => {
        await writeChromeZip();

        const { exitCode, stdout } = await runScript(releaseCheckZipsScript, tempDir);

        expect(exitCode).toBe(1);
        expect(stdout).toContain(`holds no *-${version}-firefox.zip`);
    });

    test('fails for the zips of another version', async () => {
        await writeFile(path.join(tempDir, 'package.json'), JSON.stringify({ version: '99.0.0' }));
        await writeChromeZip();
        await writeFirefoxZip();

        const { exitCode, stdout } = await runScript(releaseCheckZipsScript, tempDir);

        expect(exitCode).toBe(1);
        expect(stdout).toContain('holds no *-99.0.0-chrome.zip');
        expect(stdout).toContain('holds no *-99.0.0-firefox.zip');
    });

    test('fails for a zip which misses a file or holds one more', async () => {
        await writeChromeZip({ 'images/double-click-16x16.png': null, 'stale.js': '' });
        await writeFirefoxZip();

        const { exitCode, stdout } = await runScript(releaseCheckZipsScript, tempDir);

        expect(exitCode).toBe(1);
        expect(stdout).toContain(`FAIL  ${zipName('chrome')}: missing images/double-click-16x16.png; not in extension/: stale.js`);
    });

    test('fails for a zip whose file differs from extension/', async () => {
        await writeChromeZip();
        await writeFirefoxZip({ 'options.js': '// changed' });

        const { exitCode, stdout } = await runScript(releaseCheckZipsScript, tempDir);

        expect(exitCode).toBe(1);
        expect(stdout).toContain(`FAIL  ${zipName('firefox')}: differs from extension/ in options.js`);
    });

    test('fails for a zip with the manifest of the other browser', async () => {
        await writeChromeZip({ 'manifest.json': await readFile(path.join(pathToFirefoxBuild, 'manifest.json')) });
        await writeFirefoxZip();

        const { exitCode, stdout } = await runScript(releaseCheckZipsScript, tempDir);

        expect(exitCode).toBe(1);
        expect(stdout).toContain(`FAIL  ${zipName('chrome')}: its manifest is not the chrome one`);
        expect(stdout).toContain('differs in background, browser_specific_settings');
    });

    test('fails for a zip whose manifest has another version', async () => {
        const manifest = JSON.parse(await readFile(path.join(pathToChromeBuild, 'manifest.json'), 'utf8'));
        await writeChromeZip({ 'manifest.json': JSON.stringify({ ...manifest, version: '0.0.1' }) });
        await writeFirefoxZip();

        const { exitCode, stdout } = await runScript(releaseCheckZipsScript, tempDir);

        expect(exitCode).toBe(1);
        expect(stdout).toContain(`FAIL  ${zipName('chrome')}: its manifest has version 0.0.1, but package.json has ${version}`);
    });
});

// These tests need no browser: they run the script in a temporary repository with a bare repository as "origin"
test.describe('release-check.js', () => {
    let repoDir;

    const git = async function (...args) {
        await execFileAsync('git', args, { cwd: repoDir, env: gitEnv });
    };

    const writeVersions = async function (packageVersion, manifestVersion = packageVersion) {
        await writeFile(path.join(repoDir, 'package.json'), JSON.stringify({ version: packageVersion }));
        await writeFile(path.join(repoDir, 'extension', 'manifest.json'), JSON.stringify({ version: manifestVersion }));
    };

    const commit = async function (message) {
        await git('add', '--all');
        await git('commit', '--allow-empty', '--message', message);
    };

    // A repository which is ready for a release: version 1.0.0 tagged, one commit after it, all pushed
    test.beforeEach(async () => {
        const originDir = path.join(tempDir, 'origin.git');
        repoDir = path.join(tempDir, 'repo');
        await execFileAsync('git', ['init', '--bare', '--initial-branch', 'main', originDir], { env: gitEnv });
        await mkdir(path.join(repoDir, 'extension'), { recursive: true });
        await git('init', '--initial-branch', 'main');
        await git('remote', 'add', 'origin', originDir);
        await writeVersions('1.0.0');
        await commit('1.0.0');
        await git('tag', 'v1.0.0');
        await commit('A change');
        await git('push', '--follow-tags', '--set-upstream', 'origin', 'main');
    });

    const runReleaseCheck = () => runScript(releaseCheckScript, repoDir);

    test('passes and lists the commits since the last tag', async () => {
        const { exitCode, stdout } = await runReleaseCheck();

        expect(exitCode, stdout).toBe(0);
        expect(stdout).not.toContain('FAIL');
        expect(stdout).toContain('1 commit(s) since v1.0.0');
        expect(stdout).toMatch(/Commits since v1\.0\.0 \(a draft for the release notes\):\n[0-9a-f]+ A change/);
    });

    test('fails on another branch than main', async () => {
        await git('switch', '--create', 'feature');

        const { exitCode, stdout } = await runReleaseCheck();

        expect(exitCode).toBe(1);
        expect(stdout).toContain('FAIL  on branch feature, not on main');
    });

    test('fails with changes which are not committed', async () => {
        await writeFile(path.join(repoDir, 'new-file.js'), '');

        const { exitCode, stdout } = await runReleaseCheck();

        expect(exitCode).toBe(1);
        expect(stdout).toContain('FAIL  the working tree has changes which are not committed');
        expect(stdout).toContain('?? new-file.js');
    });

    test('fails with a commit which is not pushed', async () => {
        await commit('Another change');

        const { exitCode, stdout } = await runReleaseCheck();

        expect(exitCode).toBe(1);
        expect(stdout).toContain('FAIL  HEAD differs from origin/main: 1 commit(s) not pushed');
    });

    test('fails behind origin/main', async () => {
        await commit('Another change');
        await git('push');
        await git('reset', '--hard', 'HEAD~1');

        const { exitCode, stdout } = await runReleaseCheck();

        expect(exitCode).toBe(1);
        expect(stdout).toContain('FAIL  HEAD differs from origin/main: 1 commit(s) behind');
    });

    test('fails when package.json and the manifest have different versions', async () => {
        await writeVersions('1.0.0', '1.0.1');
        await commit('Edit the manifest version by hand');
        await git('push');

        const { exitCode, stdout } = await runReleaseCheck();

        expect(exitCode).toBe(1);
        expect(stdout).toContain('FAIL  package.json has version 1.0.0, but extension/manifest.json has 1.0.1');
    });

    test('fails when the current version has no tag', async () => {
        await writeVersions('1.1.0');
        await commit('1.1.0');
        await git('push');

        const { exitCode, stdout } = await runReleaseCheck();

        expect(exitCode).toBe(1);
        expect(stdout).toContain('FAIL  tag v1.1.0 exists');
    });

    test('fails with no commits since the last tag', async () => {
        await writeVersions('1.1.0');
        await commit('1.1.0');
        await git('tag', 'v1.1.0');
        await git('push', '--follow-tags');

        const { exitCode, stdout } = await runReleaseCheck();

        expect(exitCode).toBe(1);
        expect(stdout).toContain('FAIL  no commits since v1.1.0: nothing to release');
    });
});

// These tests need no browser: they run the script in a temporary repository
test.describe('build-source.js', () => {
    const git = async function (...args) {
        await execFileAsync('git', args, { cwd: tempDir, env: gitEnv });
    };

    test.beforeEach(async () => {
        await git('init', '--initial-branch', 'main');
        await writeFile(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'some-extension', version: '1.0.0' }));
        await git('add', '--all');
        await git('commit', '--message', '1.0.0');
    });

    test('zips the files of the tag of the current version', async () => {
        await git('tag', 'v1.0.0');
        await writeFile(path.join(tempDir, 'not-committed.js'), '');

        const { exitCode, stdout, stderr } = await runScript(buildSourceScript, tempDir);

        expect(exitCode, stderr).toBe(0);
        expect(stdout).toContain('Zipped the source code of v1.0.0 into web-ext-artifacts/some-extension-1.0.0-source.zip');
        const zip = await JSZip.loadAsync(await readFile(path.join(tempDir, 'web-ext-artifacts', 'some-extension-1.0.0-source.zip')));
        expect(Object.keys(zip.files).sort()).toEqual(['some-extension-1.0.0/', 'some-extension-1.0.0/package.json']);
    });

    test('fails when the current version has no tag', async () => {
        const { exitCode, stderr } = await runScript(buildSourceScript, tempDir);

        expect(exitCode).toBe(1);
        expect(stderr).toContain('The tag v1.0.0 does not exist: run "npm version" first');
    });
});
