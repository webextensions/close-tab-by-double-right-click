# Double Right Click - close tab & more: source code of version {version}

This zip holds the source code of version {version} of the add-on, for the review on Firefox Add-ons (AMO). It is the
part of the tag v{version} of https://github.com/webextensions/double-right-click which builds the add-on, without the
tests and the development tools.

## Build

- Use the Node.js version from `.nvmrc`. Nothing needs to be installed: the build only uses Node.js itself.
- Run `npm run build:firefox`.
- The add-on is in `dist/firefox/`.

The files of the add-on are copied unchanged from `extension/`. Only `manifest.json` is generated: for Firefox, it
declares the background script through `background.scripts` instead of `background.service_worker`.

## Files

- `extension/`: the source of the add-on
- `scripts/build-and-release/build-dist/build-dist.js`: the build (`npm run build:firefox`; `npm run build:chrome` and
  `npm run build:dist` build for Chrome as well)
- `scripts/build-and-release/build-dist/manifest-transforms.js`: how the manifest of each browser differs from
  `extension/manifest.json`
- `scripts/build-and-release/marks.js`: the marks which start the result line of the build

Some comments in these scripts mention tools of the whole repository (eg: `release-check-zips.js`, `web-ext run`),
which are on GitHub.
