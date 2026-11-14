// Runs as "npm run build:source", after "npm version" (see RELEASING.md). Zips the source code of the released version
// (the files of the tag v<version> in package.json) into web-ext-artifacts/, for the source code upload which AMO asks
// for: build-dist.js generates the manifest.json of the Firefox zip.
//
// It works on the repository in the current folder (npm runs it in the project root).

import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const repoRoot = process.cwd();
const artifactsDirName = 'web-ext-artifacts';

const { name, version } = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const tag = `v${version}`;
const zipPath = path.join(artifactsDirName, `${name}-${version}-source.zip`);

try {
    await execFileAsync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], { cwd: repoRoot });
} catch {
    console.error(`The tag ${tag} does not exist: run "npm version" first (see RELEASING.md)`);
    process.exit(1);
}

await mkdir(path.join(repoRoot, artifactsDirName), { recursive: true });
await execFileAsync('git', ['archive', '--format=zip', `--prefix=${name}-${version}/`, `--output=${zipPath}`, tag], {
    cwd: repoRoot
});
console.log(`Zipped the source code of ${tag} into ${zipPath}`);
