import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    // Each test launches its own browser with the extension loaded
    workers: 1
});
