// Runs as "npm run release:check:zips", after "npm run build" and "npm run build:source", and before uploading to the
// stores (see RELEASING.md). Checks that web-ext-artifacts/ holds one zip per browser for the version in package.json,
// and that each zip holds exactly the files of extension/, with the same content, and the manifest which build-dist.js
// makes for that browser. So it catches a zip from before a later change, a zip of another version and a mix-up of the
// two browsers.
//
// It also checks the source zip for AMO: that it holds exactly the files which build the add-on (sourceZipPaths in
// source-files.js), with the same content, plus package.json and README.md, and that "npm run build:firefox" in it
// builds the same files as the firefox zip.
//
// It changes nothing in the project: it builds the source zip in a temporary folder. It works on the project in the
// current folder (npm runs it in the project root).

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';

import JSZip from 'jszip';

import { manifestTransforms } from '../build-dist/manifest-transforms.js';
import { sourceZipPaths } from '../build-source/source-files.js';
import { failureMark, successMark } from '../marks.js';
import { createCheckReport } from './check-report.js';

const projectRoot = process.cwd();
const sourceDir = path.join(projectRoot, 'extension');
const artifactsDirName = 'web-ext-artifacts';
const artifactsDir = path.join(projectRoot, artifactsDirName);

const execFileAsync = promisify(execFile);

const report = createCheckReport();
const { check } = report;

const readJson = async function (filePath) {
    return JSON.parse(await readFile(filePath, 'utf8'));
};

// The files of extension/, as paths relative to it with "/" separators (as zip entries name them)
const listSourceFiles = async function () {
    const entries = await readdir(sourceDir, { recursive: true, withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(sourceDir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
        .sort();
};

const listArtifacts = async function () {
    try {
        return await readdir(artifactsDir);
    } catch (err) {
        if (err.code === 'ENOENT') {
            return [];
        }
        throw err;
    }
};

// The files of the paths which the source zip holds, as paths relative to the project with "/" separators
const listSourceZipFiles = async function () {
    const files = [];
    for (const sourcePath of sourceZipPaths) {
        const fullPath = path.join(projectRoot, sourcePath);
        let isDirectory;
        try {
            isDirectory = (await stat(fullPath)).isDirectory();
        } catch (err) {
            if (err.code === 'ENOENT') {
                continue;
            }
            throw err;
        }
        if (!isDirectory) {
            files.push(sourcePath);
            continue;
        }
        const entries = await readdir(fullPath, { recursive: true, withFileTypes: true });
        files.push(...entries
            .filter((entry) => entry.isFile())
            .map((entry) => path.relative(projectRoot, path.join(entry.parentPath, entry.name)).split(path.sep).join('/')));
    }
    return files.sort();
};

// The files of a zip (without the folders) as { name: entry }, with the given folder left out of their names
const readZipFiles = async function (zipName, folder = '') {
    const zip = await JSZip.loadAsync(await readFile(path.join(artifactsDir, zipName)));
    return Object.fromEntries(Object.values(zip.files)
        .filter((entry) => !entry.dir)
        .map((entry) => [entry.name.startsWith(folder) ? entry.name.slice(folder.length) : entry.name, entry]));
};

const formatList = function (items) {
    return items.join(', ');
};

const checkZip = async function ({ browser, zipName, version, sourceFiles, sourceManifest }) {
    const zip = await JSZip.loadAsync(await readFile(path.join(artifactsDir, zipName)));
    const zipFiles = Object.values(zip.files)
        .filter((entry) => !entry.dir)
        .map((entry) => entry.name)
        .sort();

    const missing = sourceFiles.filter((file) => !zipFiles.includes(file));
    const extra = zipFiles.filter((file) => !sourceFiles.includes(file));
    const problems = [];
    if (missing.length) {
        problems.push(`missing ${formatList(missing)}`);
    }
    if (extra.length) {
        problems.push(`not in extension/: ${formatList(extra)}`);
    }
    check(!problems.length, problems.length
        ? `${zipName}: ${problems.join('; ')}`
        : `${zipName}: holds the ${sourceFiles.length} files of extension/`);

    const changed = [];
    for (const file of sourceFiles.filter((file) => file !== 'manifest.json' && zipFiles.includes(file))) {
        const [zipContent, sourceContent] = await Promise.all([
            zip.file(file).async('nodebuffer'),
            readFile(path.join(sourceDir, file))
        ]);
        if (!zipContent.equals(sourceContent)) {
            changed.push(file);
        }
    }
    check(!changed.length, changed.length
        ? `${zipName}: differs from extension/ in ${formatList(changed)} (run "npm run build" again)`
        : `${zipName}: same content as extension/`);

    if (!zipFiles.includes('manifest.json')) {
        return;
    }
    const zipManifest = JSON.parse(await zip.file('manifest.json').async('string'));
    const expectedManifest = structuredClone(sourceManifest);
    manifestTransforms[browser](expectedManifest);
    if (zipManifest.version !== version) {
        check(false, `${zipName}: its manifest has version ${zipManifest.version}, but package.json has ${version}`);
        return;
    }
    const differentKeys = [...new Set([...Object.keys(zipManifest), ...Object.keys(expectedManifest)])]
        .filter((key) => !isDeepStrictEqual(zipManifest[key], expectedManifest[key]));
    check(!differentKeys.length, differentKeys.length
        ? `${zipName}: its manifest is not the ${browser} one built from extension/manifest.json ` +
            `(differs in ${formatList(differentKeys)})`
        : `${zipName}: has the ${browser} manifest of version ${version}`);
};

// Unzips the source zip into a temporary folder, runs "npm run build:firefox" there and compares what it built with the
// firefox zip
const checkSourceZipBuild = async function ({ zipName, zipFiles, firefoxZipName }) {
    const firefoxZipFiles = await readZipFiles(firefoxZipName);
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'source-zip-'));
    try {
        for (const [file, entry] of Object.entries(zipFiles)) {
            const filePath = path.join(tempDir, file);
            if (path.relative(tempDir, filePath).startsWith('..')) {
                check(false, `${zipName}: holds a file outside of its folder: ${file}`);
                return;
            }
            await mkdir(path.dirname(filePath), { recursive: true });
            await writeFile(filePath, await entry.async('nodebuffer'));
        }
        try {
            await execFileAsync('npm', ['run', '--silent', 'build:firefox'], { cwd: tempDir });
        } catch (err) {
            const output = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim().split('\n').at(-1) || err.message;
            check(false, `${zipName}: "npm run build:firefox" failed in it: ${output}`);
            return;
        }
        const builtDir = path.join(tempDir, 'dist', 'firefox');
        let builtEntries;
        try {
            builtEntries = await readdir(builtDir, { recursive: true, withFileTypes: true });
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err;
            }
            check(false, `${zipName}: "npm run build:firefox" built no dist/firefox/ in it`);
            return;
        }
        const builtFiles = builtEntries
            .filter((entry) => entry.isFile())
            .map((entry) => path.relative(builtDir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
            .sort();
        const firefoxFiles = Object.keys(firefoxZipFiles).sort();
        const problems = [];
        const missing = firefoxFiles.filter((file) => !builtFiles.includes(file));
        const extra = builtFiles.filter((file) => !firefoxFiles.includes(file));
        const changed = [];
        for (const file of builtFiles.filter((file) => firefoxFiles.includes(file))) {
            const [builtContent, firefoxContent] = await Promise.all([
                readFile(path.join(builtDir, file)),
                firefoxZipFiles[file].async('nodebuffer')
            ]);
            if (!builtContent.equals(firefoxContent)) {
                changed.push(file);
            }
        }
        if (missing.length) {
            problems.push(`does not build ${formatList(missing)}`);
        }
        if (extra.length) {
            problems.push(`builds ${formatList(extra)}, which the firefox zip does not hold`);
        }
        if (changed.length) {
            problems.push(`builds another ${formatList(changed)}`);
        }
        check(!problems.length, problems.length
            ? `${zipName}: does not build the firefox zip: ${problems.join('; ')}`
            : `${zipName}: builds the same files as the firefox zip`);
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
};

const checkSourceZip = async function ({ zipName, name, version, firefoxZipName }) {
    const folder = `${name}-${version}/`;
    const zipFiles = await readZipFiles(zipName, folder);
    const projectFiles = await listSourceZipFiles();
    const expectedFiles = [...projectFiles, 'README.md', 'package.json'];
    const zipFileNames = Object.keys(zipFiles).sort();
    const missing = expectedFiles.filter((file) => !zipFileNames.includes(file));
    const extra = zipFileNames.filter((file) => !expectedFiles.includes(file));
    const problems = [];
    if (missing.length) {
        problems.push(`missing ${formatList(missing)}`);
    }
    if (extra.length) {
        problems.push(`holds more than what builds the add-on: ${formatList(extra)}`);
    }
    check(!problems.length, problems.length
        ? `${zipName}: ${problems.join('; ')}`
        : `${zipName}: holds the ${projectFiles.length} files which build the add-on, package.json and README.md`);

    const changed = [];
    for (const file of projectFiles.filter((file) => zipFileNames.includes(file))) {
        const [zipContent, projectContent] = await Promise.all([
            zipFiles[file].async('nodebuffer'),
            readFile(path.join(projectRoot, file))
        ]);
        if (!zipContent.equals(projectContent)) {
            changed.push(file);
        }
    }
    check(!changed.length, changed.length
        ? `${zipName}: differs from the project in ${formatList(changed)} (it holds them as in the tag: run ` +
            '"npm run build:source" again, or commit the change in a new version)'
        : `${zipName}: same content as the project`);

    if (firefoxZipName) {
        await checkSourceZipBuild({ zipName, zipFiles, firefoxZipName });
    }
};

const { name, version } = await readJson(path.join(projectRoot, 'package.json'));
const sourceManifest = await readJson(path.join(sourceDir, 'manifest.json'));
const sourceFiles = await listSourceFiles();
const artifacts = await listArtifacts();

// The one zip in web-ext-artifacts/ which ends with the suffix, or undefined (a failed check) without exactly one
const findZip = function (suffix, buildScript) {
    const zipNames = artifacts.filter((file) => file.endsWith(suffix));
    if (zipNames.length !== 1) {
        check(false, zipNames.length
            ? `${artifactsDirName}/ holds more than one *${suffix}: ${formatList(zipNames)}`
            : `${artifactsDirName}/ holds no *${suffix} (run "npm run ${buildScript}")`);
        return undefined;
    }
    return zipNames[0];
};

const browserZipNames = {};
for (const browser of Object.keys(manifestTransforms)) {
    const zipName = findZip(`-${version}-${browser}.zip`, 'build');
    if (!zipName) {
        continue;
    }
    browserZipNames[browser] = zipName;
    await checkZip({ browser, zipName, version, sourceFiles, sourceManifest });
}

const sourceZipName = findZip(`-${version}-source.zip`, 'build:source');
if (sourceZipName) {
    await checkSourceZip({ zipName: sourceZipName, name, version, firefoxZipName: browserZipNames.firefox });
}

const { failedCount } = report;
if (failedCount) {
    console.log(`\n${failureMark()} ${failedCount} check(s) failed: do not upload these zips`);
} else {
    console.log(`\n${successMark()} Ready: upload the zips in ${artifactsDirName}/ to the stores (see RELEASING.md)`);
}
process.exitCode = failedCount ? 1 : 0;
