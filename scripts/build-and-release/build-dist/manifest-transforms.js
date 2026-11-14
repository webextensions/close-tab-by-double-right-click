// How the manifest of each per-browser build differs from extension/manifest.json. Each transform changes the parsed
// manifest in place. Used by build-dist.js to generate dist/, and by release-check-zips.js to check the store zips.

export const manifestTransforms = {
    chrome: function (manifest) {
        delete manifest.browser_specific_settings;
    },
    firefox: function (manifest) {
        const { service_worker: backgroundScript, ...background } = manifest.background;
        if (!backgroundScript) {
            throw new Error('extension/manifest.json must declare "background.service_worker"');
        }
        manifest.background = { ...background, scripts: [backgroundScript] };
    }
};
