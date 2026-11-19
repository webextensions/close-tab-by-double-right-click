# AGENTS.md

Manifest V3 extension for Chrome and Firefox. [extension/](extension/) is the source; the shipped `dist/chrome` and
`dist/firefox` are generated from it (`npm run build:dist`). Chromium-based browsers can also load `extension/` as it
is.

## Working Agreements

- Permissions: stop and challenge the user before any change which adds, removes or widens `permissions`,
  `optional_permissions`, `host_permissions`, `optional_host_permissions` or the `matches` of the content script, or
  which needs an API behind a permission. Do this even when the user asked for the change. Name the permission, the
  warning which Chrome and Firefox show for it, and the effect on existing users: Chrome disables the extension on
  update until each user accepts a new warning. Offer the alternatives (an optional permission, a way without a new
  permission, dropping the change), and go ahead only after the user confirms explicitly.
- Advisor: before any change (code, tests, scripts, docs, manifest), ask the advisor for its opinion (Claude Code's
  `advisor` tool, a stronger reviewer model), and again before calling the work done. An agent without an advisor asks
  for an independent review instead.

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
- The options page sets what a double right click does, and with Shift, Ctrl, Alt or (on macOS only) Cmd held. The
  content script only reports the gesture and its keys; the background script reads the settings on each gesture and
  decides. Two keys held together do nothing, and a key with nothing set does what the plain gesture does. The content
  script keeps only the maximum time between clicks, which it reads on start, on each change of it (`storage.onChanged`,
  checked for its two keys, both read in one `get`) and on a page restored from the back/forward cache, so that open
  pages follow it at once.
- The look of the options page lives in [extension/options.css](extension/options.css), in light and dark. Its rule
  which keeps `[hidden]` elements hidden must stay, or a styled element which `options.js` hides shows up and joins the
  Tab order. The note which confirms a change (`utils.alertNote`) styles itself inline, so `options.css` overrides its
  colors with `!important`. A change which could not be saved shows the same note with the class `alert-note-failed`
  (its own colors, in rules more specific than those), which the note of a saved change removes.
- The toolbar icon's popup is the options page itself, opened as `options.html?popup`: `options.js` gives it the
  `popup` class, which `options.css` sizes to its content, and shows "Open in a tab" there only.
- Reopening the last closed tab needs the optional `sessions` permission. Keep it optional: as a required permission
  next to `tabs`, it changes Chrome's warning to "Read your browsing history on all your signed-in devices". The
  options page asks for it when a dropdown gets set to reopen, and removes it once none is. Nothing may be awaited
  before `permissions.request` there: Firefox only asks straight from the user's action. Keep "Reopen last closed tab"
  last in the dropdowns, so that arrow keys do not pass it (each step fires `change` and would ask). The popup
  never asks: the browser's prompt can take the focus and close the popup before the choice gets saved. There,
  choosing reopen without the permission (or "Grant access") shows a `<dialog>` which offers to open the options page
  (the popup then closes). Keep the closed dialog without a `display` of its own, so that it stays out of the layout
  and the Tab order.
- The keys held on the first right press decide. In Chromium on Wayland, the `mousemove` which stands in for the second
  click reports no keys while they are held, and the page gets no key events while the native menu is open. For the
  same reason, the Wayland workaround ignores the `keydown` and `keyup` of Shift, Ctrl, Alt and Meta: the page gets
  the `keyup` of a key released right after the second click before the gesture is confirmed.
- Where no content script can run, a context menu entry stands in: special URLs (`chrome://`, `file://`,
  web stores), a tab without a committed URL (it waits for the first response of its page), http(s) tabs which fail
  the scripting probe in [extension/include.js](extension/include.js) (the browser's error pages), and PDF files. The
  browser's PDF viewer gets the clicks there; in Chrome the probe passes on it, so the probe reports the document type.
  Chrome shows the empty document of a page as soon as its headers came, and neither the content script nor the probe
  runs before the `<html>` tag arrives, so a probe without an answer adds the entry as well. (Firefox keeps the
  previous page until then.)
- That entry does what a plain double right click is set to do (the keys held do not count: Chrome does not report
  them for a menu click). Its id is the action, which a click performs, and its title the label of the action in the
  dropdowns: keep `ACTION_TITLES` in [extension/include.js](extension/include.js) alike with `ACTION_LABELS` in
  [extension/options.js](extension/options.js). There is no entry for "Do nothing", nor for reopening without the
  `sessions` permission. The background script refreshes the entry when that setting or a permission changes, and
  counts its decisions, so that an entry which waits for the settings cannot show up after a newer removal.
- A frame which still waits for its own page shows an empty placeholder document, in which the browser runs no
  declared content script. The content script of the page around the frame attaches its listeners to that placeholder
  on `mouseover`; keep that. Injecting into the placeholder from the background script breaks same-site frames: the
  browser reuses the placeholder's window for the page, so the script finds itself already there and attaches its
  listeners to the old document.
- The version lives in both package.json and the manifest. Never edit it by hand; `npm version` syncs both.
- `web-ext lint` should report 0 errors and exactly 3 known warnings:
  `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`, `KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION`, `UNSAFE_VAR_ASSIGNMENT`.

## Commands With Side Effects

- `npm version` tags and pushes: leave releases to a human. The steps of a release are in
  [RELEASING.md](RELEASING.md).
- `npm run release:check` runs `git fetch origin` (needs internet access; it updates only the remote-tracking refs).
- `npm start` rebuilds `dist/chrome` and `dist/firefox` on every change and never exits on its own.
- `npm run start:chrome` / `npm run start:firefox` open a browser and block until it is closed.
- `npm run verify:firefox` and `npm run verify:chrome` (about three minutes each) take over the
  real mouse and keyboard (Linux with GNOME only): warn the user right before each run.
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
  `dist/firefox` and sends real clicks and key presses. It finds the options page by its `<title>`, reaches its
  controls by counting Tab presses, and reads the radio buttons and the dropdowns (by their names) through the
  accessibility tree, as well as the note which "Done" shows (Firefox keeps the page open), so update the script when
  changing those. It sets `extensions.webextOptionalPermissionPrompts` to false, so choosing to reopen from an opened
  dropdown grants `sessions` without a prompt (still only on the user's action). It chooses a context menu entry by
  typing the first letter of its title ("Close tab", "New tab"), so update it when changing those titles.
- In the Chromium which Playwright launches (also the one of `verify:chrome`), the options dialog of
  `chrome://extensions` cuts off the right part of the options page, as it did before the page was restyled. Chrome
  started with `npm run start:chrome` shows the page whole, so judge the dialog there.
- No test sees the real popup of the toolbar icon, that dialog, or about:addons. To check them, drive a browser started
  with `npm run start:chrome` or `npm run start:firefox` with
  [scripts/real-input/real_input.py](scripts/real-input/real_input.py) (after the same warning as a `verify:*` run),
  and look at what the screen shows with [scripts/real-input/screen_grab.py](scripts/real-input/screen_grab.py).
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
  `startLatePageServer` in [tests/e2e/fixtures.js](tests/e2e/fixtures.js). A tab which the extension opens itself
  (`chrome.tabs.create`) can escape Playwright's routes, and its request for `drc.test` then waits on the real DNS:
  serve such a tab from `startLatePageServer` as well (`holdHeaders` holds back the whole answer).
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
- In the tests, Chromium grants `sessions` without a prompt (seen with the extension loaded from a folder), so they
  choose to reopen in a real dropdown on the options page, with `chooseOption` in
  [tests/shared/test-pages.js](tests/shared/test-pages.js): a value set from a script is not the user's action. Where a
  test must control what is listed as closed, it sets the action with `setGestureAction` and uses
  `stubReopenClosedTab` in [tests/e2e/fixtures.js](tests/e2e/fixtures.js).
