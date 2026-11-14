// Generates the per-browser builds in dist/ from extension/. Only the manifest differs from the source:
// - dist/chrome: without the Firefox-only "browser_specific_settings"
// - dist/firefox: declares the background script through "background.scripts" (Firefox) instead of
//   "background.service_worker" (Chrome)
//
// Usage: node build-dist.js [chrome] [firefox] (without arguments, it builds both)

import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { manifestTransforms } from './manifest-transforms.js';

const projectRoot = path.join(import.meta.dirname, '..', '..', '..');
const sourceDir = path.join(projectRoot, 'extension');
const sourceManifestPath = path.join(sourceDir, 'manifest.json');

const build = async function (browser) {
    const outputDir = path.join(projectRoot, 'dist', browser);

    const manifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'));
    manifestTransforms[browser](manifest);

    // The folder is updated in place (not deleted first), so that a running "web-ext run" can keep watching it
    await mkdir(outputDir, { recursive: true });
    await cp(sourceDir, outputDir, {
        recursive: true,
        filter: (source) => source !== sourceManifestPath
    });
    await writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 4) + '\n');

    // Remove what no longer exists in the source
    const sourceEntries = new Set(await readdir(sourceDir, { recursive: true }));
    for (const entry of await readdir(outputDir, { recursive: true })) {
        if (!sourceEntries.has(entry)) {
            await rm(path.join(outputDir, entry), { recursive: true, force: true });
        }
    }
};

const { positionals } = parseArgs({ allowPositionals: true });
const browsers = positionals.length ? positionals : Object.keys(manifestTransforms);
for (const browser of browsers) {
    if (!Object.hasOwn(manifestTransforms, browser)) {
        throw new Error(`Unknown browser "${browser}"; expected: ${Object.keys(manifestTransforms).join(', ')}`);
    }
}
for (const browser of browsers) {
    await build(browser);
}
const builtDirs = browsers.map((browser) => `dist/${browser}`).join(', ');
console.log(`Built ${builtDirs} at ${new Date().toLocaleTimeString('en-GB')}`);
