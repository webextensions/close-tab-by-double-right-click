import path from 'node:path';

import { test as base, chromium, expect } from '@playwright/test';

const pathToChromeBuild = path.join(import.meta.dirname, '..', '..', 'dist', 'chrome');
const pathToSource = path.join(import.meta.dirname, '..', '..', 'extension');

const test = base.extend({
    // The extension folder to load; "npm run test:e2e" builds dist/chrome first
    extensionPath: [pathToChromeBuild, { option: true }],
    context: async ({ headless, extensionPath }, use) => {
        const context = await chromium.launchPersistentContext('', {
            channel: 'chromium',
            headless,
            args: [
                `--disable-extensions-except=${extensionPath}`,
                `--load-extension=${extensionPath}`
            ]
        });

        await use(context);
        await context.close();
    },
    serviceWorker: async ({ context }, use) => {
        let [serviceWorker] = context.serviceWorkers();
        if (!serviceWorker) {
            serviceWorker = await context.waitForEvent('serviceworker');
        }
        await use(serviceWorker);
    },
    extensionId: async ({ serviceWorker }, use) => {
        await use(new URL(serviceWorker.url()).host);
    }
});

export {
    expect,
    pathToChromeBuild,
    pathToSource,
    test
};
