# Releasing

How to publish a new version of the extension on the Chrome Web Store and on Firefox Add-ons (AMO). Both stores get
the same version, built from the same commit. The uploads are made by hand in each store's dashboard.

## Before You Start

- Use the Node.js version from `.nvmrc` (`nvm use`) and install the dependencies (`npm ci`).
- You need access to the item in the
  [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) and to the add-on in the
  [AMO Developer Hub](https://addons.mozilla.org/developers/addons).
- The real-input checks (step 2) run on Linux with GNOME only, and the screen must stay unlocked while they run.

## Steps

1. Get the latest `main` and check that the repository is ready:

    ```sh
    git switch main
    git pull
    npm run release:check
    ```

    It runs `git fetch origin`, then checks that you are on `main` with nothing uncommitted, that `main` has the same
    commits as GitHub, that `package.json` and `extension/manifest.json` have the same version, that this version has
    its tag, and that there are commits since that tag. It ends with the list of those commits: keep it, it is the
    draft of the release notes (step 7).

2. Run the checks with real mouse and keyboard input. They are the only checks which prove that a double right click
   closes the tab, and each takes over the mouse and keyboard for a minute or two:

    ```sh
    npm run verify:chrome
    npm run verify:firefox
    ```

    When the release changes how the content script gets injected or counts clicks, also run the checks against real
    sites: `npm run test:sites`, `npm run verify:chrome:sites` and `npm run verify:firefox:sites` (about 20 minutes
    together, need internet access). They depend on what third-party sites serve, so look into a failure before calling
    it a regression. `npm run test:custom` runs any mix of these checks in one go.

3. Choose the new version number ([semantic versioning](https://semver.org/)):
    - `patch` (2.3.0 to 2.3.1): fixes only
    - `minor` (2.3.0 to 2.4.0): new behavior, such as a new option or support for another kind of page
    - `major` (2.3.0 to 3.0.0): a change which users have to adapt to, or dropping support for a browser version

4. Bump the version:

    ```sh
    npm version minor
    ```

    It runs `npm test` and `npm run test:e2e` first and stops if they fail. Then it writes the new version into
    `package.json`, `package-lock.json` and `extension/manifest.json`, commits them with the version as the message
    (eg: `2.4.0`), tags that commit (eg: `v2.4.0`) and pushes the commit and the tag. Never edit the version by hand. If
    only the push failed (eg: no network), run `git push --follow-tags` once it works again.

5. Build the store zips and the source zip, then check the store zips:

    ```sh
    npm run build
    npm run build:source
    npm run release:check:zips
    ```

    `npm run build` writes `double-right-click-<version>-chrome.zip` and
    `double-right-click-<version>-firefox.zip` into `web-ext-artifacts/`. `npm run build:source` zips the
    files of the new tag into `double-right-click-<version>-source.zip` there, for AMO (step 7).
    `npm run release:check:zips` checks that each store zip holds exactly the files of `extension/`, with the same
    content and the manifest of its browser at the new version. If it fails, run `npm run build` again and do not upload
    before it passes.

6. Upload to the Chrome Web Store:
    - Open the item in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole), go to its **Package**
      tab, click **Upload new package** and choose the `-chrome.zip`.
    - If `permissions`, `optional_permissions` or `host_permissions` in the manifest changed since the last release,
      give the reason for each new one on the **Privacy practices** tab. Users get asked to accept new required
      permissions. Update the **Store listing** tab if the description or the screenshots should change.
    - Click **Submit for review**. In the dialog, keep the checkbox ticked to publish as soon as the review passes, or
      untick it to publish by hand later (within 30 days of the review).

7. Upload to Firefox Add-ons:
    - Open the add-on in the [Developer Hub](https://addons.mozilla.org/developers/addons) and click
      **Upload New Version**. Choose the `-firefox.zip` and wait for the validation: errors block the upload, and
      warnings do not. The 3 warnings which `npm test` reports as known (see AGENTS.md) are expected here too.
    - Select Firefox (desktop) as the platform: the extension works with a mouse.
    - To "Do you need to submit source code?", answer **Yes** and upload the `-source.zip`. The `manifest.json` in the
      zip is generated (by `scripts/build-and-release/build-dist/build-dist.js`), and AMO asks for the source in that
      case.
    - In **Release notes**, write what changed for the users, using the commit list from step 1. In
      **Notes to Reviewer**, give the build steps of the source zip:

        ```text
        The files are copied unchanged from extension/; only manifest.json is generated.
        Build: Node.js from .nvmrc, then "npm ci" and "npm run build:firefox". The add-on is in dist/firefox/.
        Source: https://github.com/webextensions/double-right-click (tag v<version>)
        ```

    - Submit the version.

8. After both reviews pass, check that both store pages show the new version. If what the extension supports changed,
   also update the browser table and the notes in README.md.

## Good to Know

- Neither store accepts a version number which is the same as or lower than one it already has. A broken release gets
  fixed with a new `patch` version, never by uploading the same version again.
- AMO knows the add-on by `browser_specific_settings.gecko.id` in `extension/manifest.json`. That ID must stay the one
  of the existing listing, or the upload becomes a new add-on.
- The reviews take from a few hours to a few days. The broad host permission (`*://*/*`) can make the Chrome review
  take longer.
- The zips in `web-ext-artifacts/` are not committed (`.gitignore`). `npm run build` replaces the zips of the same
  version, and the zips of older versions stay there until you delete them.
