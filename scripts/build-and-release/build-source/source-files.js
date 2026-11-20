// What the source zip for AMO holds: only what builds dist/firefox, so that the reviewer gets no tests or dev tools.
// Used by build-source.js to make the zip, and by release-check-zips.js to check it.

// The paths (files or folders) of the tag which go into the zip. build-dist.js only uses Node built-ins, so the build
// needs no dependencies.
export const sourceZipPaths = [
    // The Node.js version to build with
    '.nvmrc',
    'LICENSE',
    // The files of the add-on, copied unchanged into dist/firefox (except manifest.json)
    'extension',
    // The build: "npm run build:firefox" generates dist/firefox
    'scripts/build-and-release/build-dist/build-dist.js',
    'scripts/build-and-release/build-dist/manifest-transforms.js',
    'scripts/build-and-release/marks.js'
];

// The scripts which the package.json of the zip keeps: the ones which work with only the files above
export const sourceZipScripts = ['build:dist', 'build:chrome', 'build:firefox'];
