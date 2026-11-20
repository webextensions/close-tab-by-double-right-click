import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify, stripVTControlCharacters } from 'node:util';

import JSZip from 'jszip';

import { sourceZipPaths, sourceZipScripts } from '../../scripts/build-and-release/build-source/source-files.js';
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
    const zipName = (browser, zipVersion = version) => `double-right-click-${zipVersion}-${browser}.zip`;

    test.beforeAll(async () => {
        await execFileAsync(process.execPath, [buildScript]);
    });

    test.beforeEach(async () => {
        await writeFile(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'double-right-click', version }));
        for (const sourcePath of sourceZipPaths) {
            await cp(path.join(projectRoot, sourcePath), path.join(tempDir, sourcePath), { recursive: true });
        }
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

    // Zips the files which build the add-on, a package.json with the build scripts and a README.md into
    // web-ext-artifacts/, as "npm run build:source" does. "files" works as in writeZip, with paths in the folder of the
    // zip.
    const writeSourceZip = async function (files = {}) {
        const projectPackageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
        const zip = new JSZip();
        const folder = zip.folder(`double-right-click-${version}`);
        for (const sourcePath of sourceZipPaths) {
            const fullPath = path.join(tempDir, sourcePath);
            const filePaths = (await stat(fullPath)).isDirectory()
                ? (await readdir(fullPath, { recursive: true, withFileTypes: true }))
                    .filter((entry) => entry.isFile())
                    .map((entry) => path.join(entry.parentPath, entry.name))
                : [fullPath];
            for (const filePath of filePaths) {
                folder.file(path.relative(tempDir, filePath).split(path.sep).join('/'), await readFile(filePath));
            }
        }
        folder.file('package.json', JSON.stringify({
            name: 'double-right-click',
            version,
            type: 'module',
            scripts: Object.fromEntries(sourceZipScripts.map((script) => [script, projectPackageJson.scripts[script]]))
        }));
        folder.file('README.md', '# Source code');
        for (const [file, content] of Object.entries(files)) {
            if (content === null) {
                folder.remove(file);
            } else {
                folder.file(file, content);
            }
        }
        await writeFile(path.join(tempDir, 'web-ext-artifacts', zipName('source')), await zip.generateAsync({ type: 'nodebuffer' }));
    };

    test('passes for the zips of the current build', async () => {
        await writeChromeZip();
        await writeFirefoxZip();
        await writeSourceZip();

        const { exitCode, stdout } = await runScript(releaseCheckZipsScript, tempDir);

        expect(exitCode, stdout).toBe(0);
        expect(stdout).not.toContain('\u2716');
        expect(stdout).toContain(`\u2714 ${zipName('source')}: builds the same files as the firefox zip`);
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
        expect(stdout).toContain(`\u2716 ${zipName('chrome')}: missing images/double-click-16x16.png; not in extension/: stale.js`);
    });

    test('fails for a zip whose file differs from extension/', async () => {
        await writeChromeZip();
        await writeFirefoxZip({ 'options.js': '// changed' });

        const { exitCode, stdout } = await runScript(releaseCheckZipsScript, tempDir);

        expect(exitCode).toBe(1);
        expect(stdout).toContain(`\u2716 ${zipName('firefox')}: differs from extension/ in options.js`);
    });

    test('fails for a zip with the manifest of the other browser', async () => {
        await writeChromeZip({ 'manifest.json': await readFile(path.join(pathToFirefoxBuild, 'manifest.json')) });
        await writeFirefoxZip();

        const { exitCode, stdout } = await runScript(releaseCheckZipsScript, tempDir);

        expect(exitCode).toBe(1);
        expect(stdout).toContain(`\u2716 ${zipName('chrome')}: its manifest is not the chrome one`);
        expect(stdout).toContain('differs in background, browser_specific_settings');
    });

    test('fails for a zip whose manifest has another version', async () => {
        const manifest = JSON.parse(await readFile(path.join(pathToChromeBuild, 'manifest.json'), 'utf8'));
        await writeChromeZip({ 'manifest.json': JSON.stringify({ ...manifest, version: '0.0.1' }) });
        await writeFirefoxZip();

        const { exitCode, stdout } = await runScript(releaseCheckZipsScript, tempDir);

        expect(exitCode).toBe(1);
        expect(stdout).toContain(`\u2716 ${zipName('chrome')}: its manifest has version 0.0.1, but package.json has ${version}`);
    });

    test('fails without the source zip', async () => {
        await writeChromeZip();
        await writeFirefoxZip();

        const { exitCode, stdout } = await runScript(releaseCheckZipsScript, tempDir);

        expect(exitCode).toBe(1);
        expect(stdout).toContain(`holds no *-${version}-source.zip (run "npm run build:source")`);
    });

    test('fails for a source zip which misses a file which builds the add-on or holds more', async () => {
        await writeChromeZip();
        await writeFirefoxZip();
        await writeSourceZip({ 'LICENSE': null, 'tests/some.spec.js': '' });

        const { exitCode, stdout } = await runScript(releaseCheckZipsScript, tempDir);

        expect(exitCode).toBe(1);
        expect(stdout).toContain(`\u2716 ${zipName('source')}: missing LICENSE; holds more than what builds the add-on: tests/some.spec.js`);
    });

    test('fails for a source zip which does not build the firefox zip', async () => {
        await writeChromeZip();
        await writeFirefoxZip();
        await writeSourceZip({ 'extension/options.js': '// changed' });

        const { exitCode, stdout } = await runScript(releaseCheckZipsScript, tempDir);

        expect(exitCode).toBe(1);
        expect(stdout).toContain(`\u2716 ${zipName('source')}: differs from the project in extension/options.js`);
        expect(stdout).toContain(`\u2716 ${zipName('source')}: does not build the firefox zip: builds another options.js`);
    });

    test('fails for a source zip whose build fails', async () => {
        await writeChromeZip();
        await writeFirefoxZip();
        await writeSourceZip({ 'package.json': JSON.stringify({ scripts: { 'build:firefox': 'node missing.js' } }) });

        const { exitCode, stdout } = await runScript(releaseCheckZipsScript, tempDir);

        expect(exitCode).toBe(1);
        expect(stdout).toContain(`\u2716 ${zipName('source')}: "npm run build:firefox" failed in it`);
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
        expect(stdout).not.toContain('\u2716');
        expect(stdout).toContain('1 commit(s) since v1.0.0');
        expect(stdout).toMatch(/Commits since v1\.0\.0 \(a draft for the release notes\):\n[0-9a-f]+ A change/);
    });

    test('fails on another branch than main', async () => {
        await git('switch', '--create', 'feature');

        const { exitCode, stdout } = await runReleaseCheck();

        expect(exitCode).toBe(1);
        expect(stdout).toContain('\u2716 on branch feature, not on main');
    });

    test('fails with changes which are not committed', async () => {
        await writeFile(path.join(repoDir, 'new-file.js'), '');

        const { exitCode, stdout } = await runReleaseCheck();

        expect(exitCode).toBe(1);
        expect(stdout).toContain('\u2716 the working tree has changes which are not committed');
        expect(stdout).toContain('?? new-file.js');
    });

    test('fails with a commit which is not pushed', async () => {
        await commit('Another change');

        const { exitCode, stdout } = await runReleaseCheck();

        expect(exitCode).toBe(1);
        expect(stdout).toContain('\u2716 HEAD differs from origin/main: 1 commit(s) not pushed');
    });

    test('fails behind origin/main', async () => {
        await commit('Another change');
        await git('push');
        await git('reset', '--hard', 'HEAD~1');

        const { exitCode, stdout } = await runReleaseCheck();

        expect(exitCode).toBe(1);
        expect(stdout).toContain('\u2716 HEAD differs from origin/main: 1 commit(s) behind');
    });

    test('fails when package.json and the manifest have different versions', async () => {
        await writeVersions('1.0.0', '1.0.1');
        await commit('Edit the manifest version by hand');
        await git('push');

        const { exitCode, stdout } = await runReleaseCheck();

        expect(exitCode).toBe(1);
        expect(stdout).toContain('\u2716 package.json has version 1.0.0, but extension/manifest.json has 1.0.1');
    });

    test('fails when the current version has no tag', async () => {
        await writeVersions('1.1.0');
        await commit('1.1.0');
        await git('push');

        const { exitCode, stdout } = await runReleaseCheck();

        expect(exitCode).toBe(1);
        expect(stdout).toContain('\u2716 tag v1.1.0 exists');
    });

    test('fails with no commits since the last tag', async () => {
        await writeVersions('1.1.0');
        await commit('1.1.0');
        await git('tag', 'v1.1.0');
        await git('push', '--follow-tags');

        const { exitCode, stdout } = await runReleaseCheck();

        expect(exitCode).toBe(1);
        expect(stdout).toContain('\u2716 no commits since v1.1.0: nothing to release');
    });
});

// These tests need no browser: they run the script in a temporary repository with the files of the project which build
// the add-on, a test file and the package.json of the project
test.describe('build-source.js', () => {
    const folderName = 'some-extension-1.0.0';
    const zipPath = () => path.join(tempDir, 'web-ext-artifacts', `${folderName}-source.zip`);
    let projectPackageJson;

    const git = async function (...args) {
        const { stdout } = await execFileAsync('git', args, { cwd: tempDir, env: gitEnv });
        return stdout;
    };

    const writePackageJson = async function (packageJson) {
        await writeFile(path.join(tempDir, 'package.json'), JSON.stringify(packageJson, null, 4) + '\n');
    };

    const commitAndTag = async function () {
        await git('add', '--all');
        await git('commit', '--message', '1.0.0');
        await git('tag', 'v1.0.0');
    };

    // The files of the zip (without the folders), with the folder of the zip left out of their paths
    const readZipFiles = async function () {
        const zip = await JSZip.loadAsync(await readFile(zipPath()));
        const files = {};
        for (const entry of Object.values(zip.files).filter((entry) => !entry.dir)) {
            expect(entry.name.startsWith(`${folderName}/`), entry.name).toBe(true);
            files[entry.name.slice(folderName.length + 1)] = await entry.async('nodebuffer');
        }
        return files;
    };

    test.beforeAll(async () => {
        projectPackageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
    });

    test.beforeEach(async () => {
        await git('init', '--initial-branch', 'main');
        await writePackageJson({ ...projectPackageJson, name: 'some-extension', version: '1.0.0' });
        for (const sourcePath of sourceZipPaths) {
            await cp(path.join(projectRoot, sourcePath), path.join(tempDir, sourcePath), { recursive: true });
        }
        await mkdir(path.join(tempDir, 'tests'));
        await writeFile(path.join(tempDir, 'tests', 'some.spec.js'), '');
    });

    test('zips only the files of the tag which build the add-on, with package.json and README.md', async () => {
        await commitAndTag();
        await writeFile(path.join(tempDir, 'extension', 'not-committed.js'), '');

        const { exitCode, stdout, stderr } = await runScript(buildSourceScript, tempDir);

        expect(exitCode, stderr).toBe(0);
        expect(stdout).toContain(`Zipped the source code of v1.0.0 into web-ext-artifacts/${folderName}-source.zip`);
        const committedFiles = (await git('ls-files', '--', ...sourceZipPaths)).split('\n').filter(Boolean);
        expect(Object.keys(await readZipFiles()).sort()).toEqual([...committedFiles, 'README.md', 'package.json'].sort());
    });

    test('keeps only the build scripts in package.json, without the dependencies', async () => {
        await commitAndTag();

        const { exitCode, stderr } = await runScript(buildSourceScript, tempDir);

        expect(exitCode, stderr).toBe(0);
        const files = await readZipFiles();
        const packageJson = JSON.parse(files['package.json'].toString());
        expect(packageJson.scripts).toEqual(Object.fromEntries(sourceZipScripts.map((script) => [
            script,
            projectPackageJson.scripts[script]
        ])));
        expect(packageJson).not.toHaveProperty('devDependencies');
        expect(packageJson.name).toBe('some-extension');
        expect(files['README.md'].toString()).toContain('source code of version 1.0.0');
    });

    test('builds the add-on from the zip with each of its scripts', async () => {
        await commitAndTag();
        await runScript(buildSourceScript, tempDir);
        const unzipDir = path.join(tempDir, 'unzipped');
        for (const [file, content] of Object.entries(await readZipFiles())) {
            await mkdir(path.dirname(path.join(unzipDir, file)), { recursive: true });
            await writeFile(path.join(unzipDir, file), content);
        }

        for (const script of sourceZipScripts) {
            await rm(path.join(unzipDir, 'dist'), { recursive: true, force: true });
            await execFileAsync('npm', ['run', script], { cwd: unzipDir });
            const builtDirs = (await readdir(path.join(unzipDir, 'dist'))).sort();
            expect(builtDirs, script).toEqual(script === 'build:dist' ? ['chrome', 'firefox'] : [script.slice('build:'.length)]);
        }
        const firefoxManifest = JSON.parse(await readFile(path.join(unzipDir, 'dist', 'firefox', 'manifest.json'), 'utf8'));
        expect(firefoxManifest.background.scripts).toBeDefined();
    });

    test('fails when the package.json of the tag misses a build script', async () => {
        const scripts = { ...projectPackageJson.scripts };
        delete scripts['build:firefox'];
        await writePackageJson({ ...projectPackageJson, name: 'some-extension', version: '1.0.0', scripts });
        await commitAndTag();

        const { exitCode, stderr } = await runScript(buildSourceScript, tempDir);

        expect(exitCode).toBe(1);
        expect(stderr).toContain('The package.json of v1.0.0 has no script build:firefox');
    });

    test('fails when a file which builds the add-on is not in the tag', async () => {
        await rm(path.join(tempDir, 'LICENSE'));
        await commitAndTag();

        const { exitCode, stderr } = await runScript(buildSourceScript, tempDir);

        expect(exitCode).toBe(1);
        expect(stderr).toContain('Could not zip the source code of v1.0.0');
        await expect(readFile(zipPath())).rejects.toThrow('ENOENT');
    });

    test('fails when the current version has no tag', async () => {
        const { exitCode, stderr } = await runScript(buildSourceScript, tempDir);

        expect(exitCode).toBe(1);
        expect(stderr).toContain('The tag v1.0.0 does not exist: run "npm version" first');
    });
});
