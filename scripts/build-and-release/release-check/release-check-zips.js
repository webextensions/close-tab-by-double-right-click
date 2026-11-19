// Runs as "npm run release:check:zips", after "npm run build" and before uploading to the stores (see RELEASING.md).
// Checks that web-ext-artifacts/ holds one zip per browser for the version in package.json, and that each zip holds
// exactly the files of extension/, with the same content, and the manifest which build-dist.js makes for that browser.
// So it catches a zip from before a later change, a zip of another version and a mix-up of the two browsers.
//
// It changes nothing. It works on the project in the current folder (npm runs it in the project root).

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import JSZip from 'jszip';

import { manifestTransforms } from '../build-dist/manifest-transforms.js';
import { failureMark, successMark } from '../marks.js';
import { createCheckReport } from './check-report.js';

const projectRoot = process.cwd();
const sourceDir = path.join(projectRoot, 'extension');
const artifactsDirName = 'web-ext-artifacts';
const artifactsDir = path.join(projectRoot, artifactsDirName);

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

const { version } = await readJson(path.join(projectRoot, 'package.json'));
const sourceManifest = await readJson(path.join(sourceDir, 'manifest.json'));
const sourceFiles = await listSourceFiles();
const artifacts = await listArtifacts();

for (const browser of Object.keys(manifestTransforms)) {
    const suffix = `-${version}-${browser}.zip`;
    const zipNames = artifacts.filter((file) => file.endsWith(suffix));
    if (zipNames.length !== 1) {
        check(false, zipNames.length
            ? `${artifactsDirName}/ holds more than one *${suffix}: ${formatList(zipNames)}`
            : `${artifactsDirName}/ holds no *${suffix} (run "npm run build")`);
        continue;
    }
    await checkZip({ browser, zipName: zipNames[0], version, sourceFiles, sourceManifest });
}

const { failedCount } = report;
if (failedCount) {
    console.log(`\n${failureMark()} ${failedCount} check(s) failed: do not upload these zips`);
} else {
    console.log(`\n${successMark()} Ready: upload the zips in ${artifactsDirName}/ to the stores (see RELEASING.md)`);
}
process.exitCode = failedCount ? 1 : 0;
