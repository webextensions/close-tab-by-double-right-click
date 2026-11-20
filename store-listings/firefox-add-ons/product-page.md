# Firefox Add-ons: Product Page

The texts of the **Describe Add-on** section on the **Edit Product Page** of the add-on in the
[Developer Hub](https://addons.mozilla.org/developers/addon/close-tab-double-right-click/edit). AMO keeps them apart
from the uploads: update them there by hand when the features change.

## Describe Add-on

- **Name**: as `name` in [extension/manifest.json](../../extension/manifest.json), which AMO does not take over from an
  upload:

    ```text
    Double Right Click - close tab & more
    ```

- **Add-on URL**: stays `close-tab-double-right-click`, so that existing links keep working.
- **Summary**: as `description` in [extension/manifest.json](../../extension/manifest.json):

    ```text
    Double right click anywhere on the page to close the tab, reopen the last closed tab and more.
    ```

- **Categories**: Tabs.
- **Email**: admin@webextensions.org.
- **Website** (for support): https://github.com/webextensions/double-right-click/issues.

### Description

Some Markdown works there: a list needs a blank line before it.

```text
Double right click anywhere on the page to close the active tab - or to do what you choose.

Open source:

* https://github.com/webextensions/double-right-click

Notes:

* In the options of the extension (also in the popup of its toolbar icon), choose what a double right click does, and what it does with Shift, Ctrl, Alt (Option on macOS) or Cmd (macOS only) held on its first click: do nothing, close the tab, go back, reload the tab, hard reload the tab (without the cache), open a new tab, duplicate the tab, or reopen the last closed tab (which asks for access to the recently closed tabs). By default, a double right click closes the tab, and with a key held it does the same. Holding two of these keys does nothing.

* To use this extension in private windows, allow it there in "about:addons" ("Run in Private Windows").

* Firefox does not let extensions work on its own pages (eg: "about:blank"), on some Mozilla sites (eg: addons.mozilla.org) and on its error pages (eg: "Hmm. We're having trouble finding that site."). There, you would find a context-menu entry which does what a double right click is set to do ("Close tab" by default; none when set to do nothing), shown when you right click anywhere on the page.

* On Linux, with "dom.event.contextmenu.enabled" turned off in "about:config", double right click does not close the tab on pages which show their own context menu. The browser does not tell the extension that it opened its own context menu there anyway.

Connect to us:

* https://github.com/webextensions/double-right-click
* https://x.com/webextensions
```

## Additional Details

- **Homepage**: https://webextensions.org/.
