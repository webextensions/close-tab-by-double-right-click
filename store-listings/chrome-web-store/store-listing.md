# Chrome Web Store: Store Listing

The texts to paste on the **Store listing** tab of the item in the
[Developer Dashboard](https://chrome.google.com/webstore/devconsole). Update them when the features change, and paste
them again at the next upload.

## Product Details

- **Title** and **Summary**: shown as "from package", taken from `name` and `description` in
  [extension/manifest.json](../../extension/manifest.json). Change them there, not in the dashboard.
- **Category**: Tools (under "Productivity").

### Description

```text
Double right click anywhere on the page to close the active tab - or to do what you choose.

Open source:
* https://github.com/webextensions/double-right-click

Notes:

* In the options of the extension (also in the popup of its toolbar icon), choose what a double right click does, and what it does with Shift, Ctrl, Alt (Option on macOS) or Cmd (macOS only) held on its first click: do nothing, close the tab, go back, reload the tab, hard reload the tab (without the cache), open a new tab, duplicate the tab, or reopen the last closed tab (which asks for access to the recently closed tabs). By default, a double right click closes the tab, and with a key held it does the same. Holding two of these keys does nothing.

* To enable this extension in "incognito" window mode, you will need to provide permissions for this by going to "chrome://extensions".

* Double Right Click implements an alternative approach for "chrome://", "about:blank", "file:///" and other special tabs. This is due to technical limitations of Chrome API. In these tabs, you would find a context-menu entry which does what a double right click is set to do ("Close tab" by default; none when set to do nothing), shown when you right click anywhere on the page. The same entry is shown on a tab which still waits for the first response of a slow site, on the error pages of the browser (eg: "This site can't be reached"), and on PDF files.

Connect to us:
* https://github.com/webextensions/double-right-click
* https://x.com/webextensions
```
