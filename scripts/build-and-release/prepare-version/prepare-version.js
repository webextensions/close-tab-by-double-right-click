// Runs as the "version" npm script (during "npm version"), after npm has bumped the version in package.json.
// Copies that version into the extension manifest, so that both always stay in sync.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.join(import.meta.dirname, '..', '..', '..');
const manifestPath = path.join(projectRoot, 'extension', 'manifest.json');

const readJson = async function (filePath) {
    return JSON.parse(await readFile(filePath, 'utf8'));
};

const { version } = await readJson(path.join(projectRoot, 'package.json'));
const manifest = await readJson(manifestPath);

manifest.version = version;

await writeFile(manifestPath, JSON.stringify(manifest, null, 4) + '\n');
