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
- The content script is declared in the manifest (`document_start`, all frames), so the browser runs it in every page
  before the page loads. The background script injects it only once, at its start, into the tabs which were already
  open: Chrome does not do that when the extension gets installed, updated or enabled. So the file must stay safe to
  run twice in one page, and its last statement must stay a value which can be cloned (Firefox rejects the injection
  otherwise).
- The content script must attach its listeners at once, never after waiting for the page to load or for
  `document.body`: a slow page takes minutes to load, and a page which stalls in its `<head>` has no body.
- `document.open()` erases the listeners of the content script. Its `MutationObserver` on the document attaches them
  again; keep it.
- On Linux, the native context menu swallows the `mouseup` of the first right click, so the content script also counts
  `mousedown` there. In Chromium on Wayland it swallows the whole second click as well, so the content script treats the
  context menu closing (a buttonless `mousemove` on the same spot) as that click. Chromium holds a `mousemove` back for
  up to 5 seconds on a page which has not rendered anything yet, so the content script also listens for
  `pointerrawupdate` (https pages only) while a right press waits for its second click. Keep all three workarounds.
  Compare the pointer positions of those events in screen coordinates: inside a same-site frame, Chromium gives
  `pointerrawupdate` the position within the top page, and the mouse events the position within the frame.
- The content script must attach its handlers with `addEventListener`, never through the `document.on*` properties:
  Firefox shares those with the page, so each side would overwrite the other's handler.
- A page which cancels `contextmenu` gets no native menu, so both events of one right click reach it. On Linux the
  `mouseup` of a press already counted on `mousedown` must stay ignored there, or a single right click closes the tab.
- Where no content script can run, the "Close Tab" context menu entry stands in: special URLs (`chrome://`, `file://`,
  web stores), a tab without a committed URL (it waits for the first response of its page), http(s) tabs which fail
  the scripting probe in [extension/include.js](extension/include.js) (the browser's error pages), and PDF files. The
  browser's PDF viewer gets the clicks there; in Chrome the probe passes on it, so the probe reports the document type.
  Chrome shows the empty document of a page as soon as its headers came, and neither the content script nor the probe
  runs before the `<html>` tag arrives, so a probe without an answer adds the entry as well. (Firefox keeps the
  previous page until then.)
- A frame which still waits for its own page shows an empty placeholder document, in which the browser runs no
  declared content script. The content script of the page around the frame attaches its listeners to that placeholder
  on `mouseover`; keep that. Injecting into the placeholder from the background script breaks same-site frames: the
  browser reuses the placeholder's window for the page, so the script finds itself already there and attaches its
  listeners to the old document.
- The version lives in both package.json and the manifest. Never edit it by hand; `npm version` syncs both.
- `web-ext lint` should report 0 errors and exactly 3 known warnings:
  `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`, `KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION`, `UNSAFE_VAR_ASSIGNMENT`.

## Commands With Side Effects

- `npm version` tags and pushes: leave releases to a human.
- `npm start` rebuilds `dist/chrome` and `dist/firefox` on every change and never exits on its own.
- `npm run start:chrome` / `npm run start:firefox` open a browser and block until it is closed.
- `npm run verify:firefox` (about a minute) and `npm run verify:chrome` (about two minutes) take over the real mouse
  and keyboard (Linux with GNOME only): warn the user right before each run.
- `npm run verify:firefox:sites` (about 5 minutes) and `npm run verify:chrome:sites` (about 10 minutes) take them over
  as well, and need internet access.
- `npm run test:sites` opens Chromium windows, four at a time, for about 4 minutes and needs internet access.
  `npm run test:sites:headless` shows no windows.
- `npm run test:custom` asks which checks to run, then runs them, including the `verify:*` checks which take over
  the mouse and keyboard. It keeps its own copy of their commands (without the build step) in
  [scripts/test-custom/test-custom.js](scripts/test-custom/test-custom.js): update it when adding or changing a test
  or verify script, or an e2e spec file (it shows a rough time for each).

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
- The real-site checks (`test:sites`, `test:sites:headless`, `verify:chrome:sites`, `verify:firefox:sites`) share one
  site list, [tests/shared/real-sites.json](tests/shared/real-sites.json); its fields are described in
  [tests/shared/real-sites.js](tests/shared/real-sites.js). They depend on what third-party sites serve, so run them
  as an extra after changing how the content script gets injected or counts clicks, and investigate a failure before
  calling it a regression.
- On a real site, send right clicks with `rightClickAsDelivered` and `doubleRightClickAsDelivered` in
  [tests/sites/fixtures.js](tests/sites/fixtures.js): they leave out what the native context menu would swallow,
  unless the page cancels that menu.
- A double right click cannot span two documents. A real page which reloads itself, or which puts a frame under the
  pointer between the two clicks, fails a test without any bug in the extension: `openRealSite` lets a page settle
  first, and `stallSubresources` holds a loading page in place.
- `stallSubresources` fails the requests which scripts make (`xhr`, `fetch`) instead of leaving them unanswered: a
  synchronous one without an answer freezes the page for good, and then no script answers and no click arrives. The
  bot check which Akamai puts in front of amazon.com makes one. Amazon's DNS only picks Akamai for a minute at a time,
  so [tests/sites/sites.spec.js](tests/sites/sites.spec.js) has an entry which pins the browser to it.
- `route.fulfill()` sends a whole answer at once. For a page whose headers come before the page itself, use
  `startLatePageServer` in [tests/e2e/fixtures.js](tests/e2e/fixtures.js).
- A page which is still loading: use the `STALLED_*` pages in [tests/shared/test-pages.js](tests/shared/test-pages.js)
  and open them with `waitUntil: 'commit'`. Whatever waits for the page to load never returns there (`page.goto` by
  default, `executeScript` without `injectImmediately`, WebDriver's navigation command). On a page which has not
  rendered anything yet, Chromium also holds each `mousemove` back for 5 seconds, so pass `{ movePointer: false }` to
  `holdRightClick`.
- The content script ignores events which scripts create (`isTrusted` is false), so tests must send browser-level
  input (Playwright's `mouse` API or a CDP session, as in
  [tests/e2e/context-menu-dismissal.spec.js](tests/e2e/context-menu-dismissal.spec.js)), never `dispatchEvent`.
- Playwright cannot operate native context menus either. Tests dispatch `chrome.contextMenus.onClicked` from the
  service worker, and use `stopServiceWorker` in [tests/e2e/fixtures.js](tests/e2e/fixtures.js) to simulate a
  background-script restart.
