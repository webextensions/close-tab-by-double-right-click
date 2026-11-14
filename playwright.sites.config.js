import { defineConfig } from '@playwright/test';

// The tests against real sites ("npm run test:sites"). They need internet access and depend on what those sites serve,
// so they have a config of their own and "npm run test:e2e" never runs them.
export default defineConfig({
    testDir: './tests/sites',
    // Each test launches its own browser with the extension loaded. The sites get tested this many at a time.
    workers: 4,
    // A real site does not answer the same way every time
    retries: 1,
    timeout: 120000,
    // The HTML report shows the annotations: which page each site really served, and where the clicks went
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        screenshot: 'only-on-failure'
    }
});
