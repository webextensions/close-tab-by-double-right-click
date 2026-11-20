# Chrome Web Store: Privacy

The texts to paste on the **Privacy** tab of the item in the
[Developer Dashboard](https://chrome.google.com/webstore/devconsole). The dashboard asks for a justification of each
entry in `permissions`, `optional_permissions` and `host_permissions` (and the `matches` of the content script) in
[extension/manifest.json](../../extension/manifest.json): update this file in the same change which adds, removes or
widens one, and paste it at the next upload.

## Single Purpose Description

```text
Act on the current tab with a double right click anywhere on the page: close it (the default) or, as chosen in the options, go back, reload, open a new tab, duplicate it or reopen the last closed tab.
```

## Permission Justification

### contextMenus

```text
Chrome does not let extensions run scripts on some pages ("chrome://" pages, "about:blank", "file:///" pages, the Chrome Web Store, the browser's error pages, PDF files, and tabs still waiting for a slow site), so a double right click cannot be detected there. On those pages the extension adds a context-menu entry which does what a double right click is set to do ("Close tab" by default).
```

### scripting

```text
Chrome does not run the declared content script in tabs which were already open when the extension gets installed, updated or enabled. The extension injects it into those tabs once with chrome.scripting.executeScript. It also runs a small check in a tab to find out whether a script can run there (it fails on the browser's error pages, and reports the PDF viewer), so that the context-menu entry can stand in instead.
```

### storage

```text
Saves the user's settings from the options page: what a double right click does, also with Shift, Ctrl, Alt or Cmd held, and the maximum time between the two clicks. They are kept in chrome.storage.sync (chrome.storage.local where sync is not available). Nothing else is stored.
```

### tabs

```text
Reads the URL of the current tab to tell whether a double right click can be detected there, or whether the context-menu entry has to stand in (eg: on "chrome://" pages and web store pages). The URL is used only for that check and never leaves the browser.
```

### sessions

```text
Optional permission, requested only when the user sets a gesture to "Reopen last closed tab" on the options page. It is used to find the most recently closed tab (chrome.sessions.getRecentlyClosed) and restore it (chrome.sessions.restore). The extension removes the permission again once no gesture uses it.
```

### Host Permission

```text
The content script runs on every http/https page, in all frames and from the start of loading, so that a double right click is detected anywhere on any page, which is the core feature. It listens for mouse, pointer and key events in the page, to count the clicks and see which keys are held, and tells the background script about the gesture; it does not read or send page content anywhere. The same access lets the extension inject the script into tabs which were already open, and check whether a tab can run it.
```

## Data Usage

- **What user data do you plan to collect**: tick none. The extension sends nothing anywhere: the clicks are only
  counted in the page, `sessions` only restores the last closed tab on the user's own gesture, and the settings go to
  Chrome's own `storage.sync`.
- **I certify that the following disclosures are true**: tick all three.

## Privacy Policy

- **Privacy policy URL**: leave empty. Chrome asks for one only when an extension collects user data, and this one
  collects none.
