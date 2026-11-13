# Close Tab by Double Right Click
Extension **Close Tab by Double Right Click** for Google Chrome and Mozilla Firefox.

| Close active tab by                     | Chrome             | Firefox            |
| :---                                    |        :----:      |               ---: |
| Double right click anywhere on the page | :heavy_check_mark: | Upto Firefox 101   |

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

* To enable this extension in "incognito" window mode or for "file:///" URLs, you will need to provide permissions for this by going to "chrome://extensions".

* Close Tab by Double Right Click implements an alternative approach for closing "chrome://", "about:blank" and other special tabs. This is due to technical limitations of Chrome API. In these tabs, you would find a "Close Tab" context-menu entry which is shown when you right click anywhere on the page.

**Development:**
* Use the Node.js version from `.nvmrc`: `nvm use`
* Install dependencies: `npm ci`
* Lint (ESLint and Firefox add-on lint): `npm test`
* Build the per-browser folders `dist/chrome/` and `dist/firefox/` from `extension/`: `npm run build:dist` (or just one: `npm run build:chrome` / `npm run build:firefox`; the scripts below build what they need)
* Rebuild both folders on every change under `extension/` (press Ctrl+C to stop): `npm start`
* Load the extension in Chrome: "Load unpacked" on `chrome://extensions`, then choose `dist/chrome/`. Chrome and other Chromium-based browsers can also load `extension/` directly, without any build
* Try the extension in Firefox (profile kept in `web-ext-profile/`): `npm run start:firefox`; for live reload while editing, also run `npm start` in a second terminal
* Try the extension in Chrome (temporary profile): `npm run start:chrome`; for live reload while editing, also run `npm start` in a second terminal
* Build the store upload zips, one per browser (into `web-ext-artifacts/`): `npm run build`

**Inspirations:**
* The idea of this extension is inspired by "Rights To Close" legacy extension for Mozilla Firefox.

**Connect with us:**
* https://www.webextensions.org/
* [GitHub](https://github.com/webextensions/close-tab-by-double-right-click)
* [X](https://x.com/webextensions)
* [LinkedIn - Priyank Parashar](https://linkedin.com/in/ParasharPriyank/)
