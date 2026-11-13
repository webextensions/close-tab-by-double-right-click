import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
    expect,
    pathToChromeBuild,
    pathToSource,
    test
} from './fixtures.js';

const execFileAsync = promisify(execFile);

const projectRoot = path.join(import.meta.dirname, '..', '..');
const buildScript = path.join(projectRoot, 'scripts', 'build-and-release', 'build-dist', 'build-dist.js');
const pathToFirefoxBuild = path.join(projectRoot, 'dist', 'firefox');

const build = async function (...browsers) {
    await execFileAsync(process.execPath, [buildScript, ...browsers]);
};

const readManifest = async function (folder) {
    return JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'));
};

const listFiles = async function (folder) {
    return (await readdir(folder, { recursive: true })).sort();
};

// These tests need no browser: they run the build script and read its output
test.describe('build-dist.js', () => {
    test.beforeAll(async () => {
        await build();
    });

    test('dist/chrome only differs from the source by dropping the Firefox-only manifest key', async () => {
        const { browser_specific_settings: firefoxOnly, ...sourceManifest } = await readManifest(pathToSource);

        expect(firefoxOnly).toBeDefined();
        expect(await readManifest(pathToChromeBuild)).toEqual(sourceManifest);
    });

    test('dist/firefox only differs from the source by declaring the background script the Firefox way', async () => {
        const sourceManifest = await readManifest(pathToSource);
        const { service_worker: backgroundScript, ...background } = sourceManifest.background;

        expect(await readManifest(pathToFirefoxBuild)).toEqual({
            ...sourceManifest,
            background: { ...background, scripts: [backgroundScript] }
        });
    });

    for (const [name, folder] of [['dist/chrome', pathToChromeBuild], ['dist/firefox', pathToFirefoxBuild]]) {
        test(`${name} holds a copy of every other source file`, async () => {
            const files = await listFiles(pathToSource);

            expect(await listFiles(folder)).toEqual(files);
            for (const file of files.filter((file) => path.extname(file) && file !== 'manifest.json')) {
                expect(await readFile(path.join(folder, file)), file).toEqual(await readFile(path.join(pathToSource, file)));
            }
        });
    }

    test('a rebuild removes what no longer exists in the source', async () => {
        const staleFile = path.join(pathToFirefoxBuild, 'stale.js');
        const staleFolder = path.join(pathToFirefoxBuild, 'stale-folder');
        await writeFile(staleFile, '');
        await mkdir(staleFolder, { recursive: true });
        await writeFile(path.join(staleFolder, 'stale.js'), '');

        try {
            await build('firefox');

            expect(await listFiles(pathToFirefoxBuild)).toEqual(await listFiles(pathToSource));
        } finally {
            await rm(staleFile, { force: true });
            await rm(staleFolder, { recursive: true, force: true });
        }
    });

    test('an unknown browser name is rejected', async () => {
        await expect(build('edge')).rejects.toThrow('Unknown browser "edge"');
    });
});
