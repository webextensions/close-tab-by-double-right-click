# AGENTS.md

Manifest V3 extension for Chrome and Firefox. [extension/](extension/) is the source; the shipped `dist/chrome` and
`dist/firefox` are generated from it (`npm run build:dist`). Chromium-based browsers can also load `extension/` as it
is.

## Constraints

- [extension/manifest.json](extension/manifest.json) is shared. The build changes only the manifest: `dist/chrome`
  drops `browser_specific_settings`, and `dist/firefox` swaps `background.service_worker` for `background.scripts`.
  Keep `extension/` loadable in Chrome without manifest warnings: never add `background.scripts` to the source
  manifest.
- Only use APIs available in both Chrome and Firefox 128+.
- The browser stops and restarts the background script at any time. Register every `chrome.*` event listener
  synchronously at the top level of [extension/include.js](extension/include.js), and keep no state in memory that
  must survive a restart.
- On Linux, the native context menu swallows the `mouseup` of the first right click, so the content script also counts
  `mousedown` there. In Chromium on Wayland it swallows the whole second click as well, so the content script treats the
  context menu closing (a buttonless `mousemove` on the same spot) as that click. Keep both workarounds.
- The content script must attach its handlers with `addEventListener`, never through the `document.on*` properties:
  Firefox shares those with the page, so each side would overwrite the other's handler.
- A page which cancels `contextmenu` gets no native menu, so both events of one right click reach it. On Linux the
  `mouseup` of a press already counted on `mousedown` must stay ignored there, or a single right click closes the tab.
- The version lives in both package.json and the manifest. Never edit it by hand; `npm version` syncs both.
- `web-ext lint` should report 0 errors and exactly 3 known warnings:
  `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`, `KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION`, `UNSAFE_VAR_ASSIGNMENT`.

## Commands With Side Effects

- `npm version` tags and pushes: leave releases to a human.
- `npm start` rebuilds `dist/chrome` and `dist/firefox` on every change and never exits on its own.
- `npm run start:chrome` / `npm run start:firefox` open a browser and block until it is closed.
- `npm run verify:firefox` (about a minute) and `npm run verify:chrome` (about two minutes) take over the real mouse
  and keyboard (Linux with GNOME only): warn the user right before each run.

## Testing

- Changes under [extension/](extension/) should pass `npm test`, `npm run test:e2e`, `npm run verify:firefox`, and
  `npm run verify:chrome`.
- Playwright's synthetic clicks never open the native context menu, which is what breaks the gesture on Linux. Only the
  two `verify:*` scripts, which send real input through
  [scripts/real-input/real_input.py](scripts/real-input/real_input.py), prove that a double right click closes the tab.
- Playwright's `click()` releases the button at once, which hides bugs that need a realistic press. Use
  `holdRightClick` in [tests/e2e/fixtures.js](tests/e2e/fixtures.js), and only on the page which cancels the context
  menu: on any other page Playwright fires `contextmenu` without opening a native menu, so a held click counts twice.
- Playwright cannot load extensions into Firefox, so `test:e2e` covers Chromium only, loading `dist/chrome` (the
  manifest test also loads `extension/`). Firefox is covered by
  [scripts/verify-firefox/verify-firefox.py](scripts/verify-firefox/verify-firefox.py), which runs against
  `dist/firefox` and sends real clicks and key presses. It finds the options page by its `<title>` and reads the radio
  buttons and dropdown through the accessibility tree, so update the script when changing those.
- The content script ignores events which scripts create (`isTrusted` is false), so tests must send browser-level
  input (Playwright's `mouse` API or a CDP session, as in
  [tests/e2e/context-menu-dismissal.spec.js](tests/e2e/context-menu-dismissal.spec.js)), never `dispatchEvent`.
- Playwright cannot operate native context menus either. Tests dispatch `chrome.contextMenus.onClicked` from the
  service worker, and use `stopServiceWorker` in [tests/e2e/fixtures.js](tests/e2e/fixtures.js) to simulate a
  background-script restart.
