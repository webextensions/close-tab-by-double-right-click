# Close Tab by Double Right Click
Extension **Close Tab by Double Right Click** for Google Chrome and Mozilla Firefox.

| Close active tab by                     | Chrome             | Firefox (128+)     |
| :---                                    |        :----:      |               ---: |
| Double right click anywhere on the page | :heavy_check_mark: | :heavy_check_mark: |

<img width="32" alt="Google Chrome Logo" src="https://cdn.jsdelivr.net/gh/webextensions/live-css-editor@master/extension/ui-images/logo-google-chrome.svg"> &nbsp; https://chromewebstore.google.com/detail/klngijkfgagcnegkffeckmkdpnpmbdpm

<img width="32" alt="Mozilla Firefox Logo" src="https://cdn.jsdelivr.net/gh/webextensions/live-css-editor@master/extension/ui-images/logo-firefox_edited.png"> &nbsp; https://addons.mozilla.org/firefox/addon/close-tab-double-right-click/

**Open source:**
* https://github.com/webextensions/close-tab-by-double-right-click

**This extension is available for:**
* Google Chrome
* Mozilla Firefox

**Created by:**
* Priyank Parashar

**Notes:**

* To enable this extension in "incognito" window mode, you will need to provide permissions for this by going to "chrome://extensions".

* Close Tab by Double Right Click implements an alternative approach for closing "chrome://", "about:blank", "file:///" and other special tabs. This is due to technical limitations of Chrome API. In these tabs, you would find a "Close Tab" context-menu entry which is shown when you right click anywhere on the page. The same entry is shown on a tab which still waits for the first response of a slow site, and on the error pages of the browser (eg: "This site can't be reached").

* In Chrome on Linux, a right click followed by a quick left click on the same spot can also close the tab. On Wayland, the browser does not tell the extension which mouse button closed the context menu.

* In Chrome on Linux, closing the context menu from the keyboard (eg: with Escape) shortly after a right click can also close the tab, if the key is held down for longer than a quick tap. The browser only tells the extension about that key when it is released.

* In Chrome on Linux (Wayland), double right click does not close the tab on a page which is not served over "https" and has not shown anything yet (eg: it waits for a slow stylesheet). The browser tells the extension about the second click too late there.

* In Firefox on Linux, with "dom.event.contextmenu.enabled" turned off in "about:config", double right click does not close the tab on pages which show their own context menu. The browser does not tell the extension that it opened its own context menu there anyway.

**Development:**
* Use the Node.js version from `.nvmrc`: `nvm use`
* Install dependencies: `npm ci`
* Lint (ESLint and Firefox add-on lint): `npm test`
* Build the per-browser folders `dist/chrome/` and `dist/firefox/` from `extension/`: `npm run build:dist` (or just one: `npm run build:chrome` / `npm run build:firefox`; the scripts below build what they need)
* Rebuild both folders on every change under `extension/` (press Ctrl+C to stop): `npm start`
* Load the extension in Chrome: "Load unpacked" on `chrome://extensions`, then choose `dist/chrome/`. Chrome and other Chromium-based browsers can also load `extension/` directly, without any build
* Try the extension in Firefox (profile kept in `web-ext-profile/`): `npm run start:firefox`; for live reload while editing, also run `npm start` in a second terminal
* Try the extension in Chrome (temporary profile): `npm run start:chrome`; for live reload while editing, also run `npm start` in a second terminal
* End-to-end tests in Chromium: `npx playwright install chromium` (once), then `npm run test:e2e` (builds `dist/chrome/` first)
* Check the extension in Firefox with real mouse and keyboard input: `npm run verify:firefox` (Linux with GNOME only; needs `geckodriver`, `python3-gi` and `gir1.2-atspi-2.0`; takes over the mouse and keyboard for about a minute; one check needs internet access and is skipped without it)
* Check the double right click in Chromium with real mouse and keyboard input: `npm run verify:chrome` (Linux with GNOME only; needs `python3-gi`; opens Chromium in Wayland and X11 modes and takes over the mouse and keyboard for about two minutes)
* Build the store upload zips, one per browser (into `web-ext-artifacts/`): `npm run build`

**Inspirations:**
* The idea of this extension is inspired by "Rights To Close" legacy extension for Mozilla Firefox.

**Connect with us:**
* https://www.webextensions.org/
* [GitHub](https://github.com/webextensions/close-tab-by-double-right-click)
* [X](https://x.com/webextensions)
* [LinkedIn - Priyank Parashar](https://linkedin.com/in/ParasharPriyank/)
