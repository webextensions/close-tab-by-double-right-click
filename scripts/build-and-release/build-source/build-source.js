// Runs as "npm run build:source", after "npm version" (see RELEASING.md). Zips the source code of the released version
// (from the tag v<version> in package.json) into web-ext-artifacts/, for the source code upload which AMO asks for:
// build-dist.js generates the manifest.json of the Firefox zip.
//
// The zip holds only what builds dist/firefox (sourceZipPaths in source-files.js), a package.json with only the build
// scripts and no dependencies, and a README.md for the reviewer (from source-readme.md). The files and package.json
// come from the tag; the lists and the README template come from this folder.
//
// It works on the repository in the current folder (npm runs it in the project root).

import { execFile } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { failureMark, successMark } from '../marks.js';
import { sourceZipPaths, sourceZipScripts } from './source-files.js';

const execFileAsync = promisify(execFile);

const repoRoot = process.cwd();
const artifactsDirName = 'web-ext-artifacts';

const fail = function (message) {
    console.error(`\n${failureMark(process.stderr)} ${message}`);
    process.exit(1);
};

const { name, version } = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const tag = `v${version}`;
const folderName = `${name}-${version}`;
const zipPath = path.join(artifactsDirName, `${folderName}-source.zip`);

try {
    await execFileAsync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], { cwd: repoRoot });
} catch {
    fail(`The tag ${tag} does not exist: run "npm version" first (see RELEASING.md)`);
}

// The package.json of the tag, with only the scripts which work from the zip, and without the dependencies of the
// development tools
const { stdout: tagPackageJson } = await execFileAsync('git', ['show', `${tag}:package.json`], { cwd: repoRoot });
const packageJson = JSON.parse(tagPackageJson);
const missingScripts = sourceZipScripts.filter((script) => !Object.hasOwn(packageJson.scripts ?? {}, script));
if (missingScripts.length) {
    fail(`The package.json of ${tag} has no script ${missingScripts.join(', ')}`);
}
packageJson.scripts = Object.fromEntries(sourceZipScripts.map((script) => [script, packageJson.scripts[script]]));
delete packageJson.devDependencies;

const readmeTemplate = await readFile(path.join(import.meta.dirname, 'source-readme.md'), 'utf8');
const readme = readmeTemplate.replaceAll('{version}', version);

await mkdir(path.join(repoRoot, artifactsDirName), { recursive: true });
try {
    // --prefix does not apply to --add-virtual-file, so its path names the folder as well
    await execFileAsync('git', [
        'archive',
        '--format=zip',
        `--prefix=${folderName}/`,
        `--add-virtual-file=${folderName}/package.json:${JSON.stringify(packageJson, null, 4)}\n`,
        `--add-virtual-file=${folderName}/README.md:${readme}`,
        `--output=${zipPath}`,
        tag,
        '--',
        ...sourceZipPaths
    ], { cwd: repoRoot });
} catch (err) {
    await rm(path.join(repoRoot, zipPath), { force: true });
    fail(`Could not zip the source code of ${tag}: ${err.stderr?.trim() || err.message}`);
}
console.log(`\n${successMark()} Zipped the source code of ${tag} into ${zipPath}`);
