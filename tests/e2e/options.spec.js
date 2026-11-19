import {
    CANCEL_CONTEXT_MENU_PATH,
    chooseOption,
    expect,
    holdRightClick,
    openTestPage,
    setGestureAction,
    test
} from './fixtures.js';

const setCustomMaxTimeBetweenClicks = async function ({ context, serviceWorker, extensionId }, value) {
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);

    await expect(optionsPage.getByRole('radio', { name: /Default/ })).toBeChecked();

    await optionsPage.getByRole('combobox', { name: 'Maximum time between clicks' }).selectOption(value);
    await expect(optionsPage.getByText('Your change would apply next time onwards')).toBeVisible();
    await expect.poll(() => serviceWorker.evaluate(() => chrome.storage.sync.get(null))).toEqual({
        MAXIMUM_TIME_BETWEEN_CLICKS_TYPE: 'custom',
        MAXIMUM_TIME_BETWEEN_CLICKS_VALUE: value
    });

    return optionsPage;
};

test('choosing a custom maximum time persists across reloads', async ({ context, serviceWorker, extensionId }) => {
    const optionsPage = await setCustomMaxTimeBetweenClicks({ context, serviceWorker, extensionId }, '1000');

    await optionsPage.reload();

    await expect(optionsPage.getByRole('radio', { name: /Custom/ })).toBeChecked();
    await expect(optionsPage.getByRole('combobox', { name: 'Maximum time between clicks' })).toHaveValue('1000');
});

test('custom maximum time of 1000 ms closes the tab on right clicks 800 ms apart', async ({ context, serviceWorker, extensionId }) => {
    await setCustomMaxTimeBetweenClicks({ context, serviceWorker, extensionId }, '1000');

    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}custom-max-time`);
    const closed = page.waitForEvent('close');

    await holdRightClick(page, 120);
    await page.waitForTimeout(680);
    await holdRightClick(page, 120);

    await closed;
    expect(page.isClosed()).toBe(true);
});

test('choosing "Default" again brings back the default 500 ms', async ({ context, serviceWorker, extensionId }) => {
    const optionsPage = await setCustomMaxTimeBetweenClicks({ context, serviceWorker, extensionId }, '1000');

    await optionsPage.getByRole('radio', { name: /Default/ }).check();
    await expect.poll(() => serviceWorker.evaluate(() => chrome.storage.sync.get('MAXIMUM_TIME_BETWEEN_CLICKS_TYPE'))).toEqual({
        MAXIMUM_TIME_BETWEEN_CLICKS_TYPE: 'default'
    });

    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}default-again`);

    await holdRightClick(page, 120);
    await page.waitForTimeout(680);
    await holdRightClick(page, 120);
    await page.waitForTimeout(1000);

    expect(page.isClosed()).toBe(false);
});

test('"Done" shows the note when the options page stays open', async ({ context, extensionId }) => {
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);

    // Chromium closes the page here; Firefox keeps it open inside about:addons
    await optionsPage.evaluate(() => {
        window.close = function () {};
    });

    await optionsPage.getByRole('button', { name: 'Done' }).click();
    await expect(optionsPage.getByText('Your change would apply next time onwards')).toBeVisible();
});

test('the maximum time between clicks gets saved in one write before its note shows', async ({ context, serviceWorker, extensionId }) => {
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    const note = optionsPage.locator('.alert-note-text');

    // Records the keys of each write, and holds each one until it gets released
    await optionsPage.evaluate(() => {
        globalThis.heldWrites = [];
        const set = chrome.storage.sync.set;
        chrome.storage.sync.set = async function (...args) {
            const { promise, resolve } = Promise.withResolvers();
            globalThis.heldWrites.push({ keys: Object.keys(args[0]).sort(), release: resolve });
            await promise;
            return set.apply(this, args);
        };
    });
    const writtenKeys = () => optionsPage.evaluate(() => globalThis.heldWrites.map((write) => write.keys));

    await optionsPage.getByRole('combobox', { name: 'Maximum time between clicks' }).selectOption('1000');
    await expect.poll(writtenKeys).toEqual([
        ['MAXIMUM_TIME_BETWEEN_CLICKS_TYPE', 'MAXIMUM_TIME_BETWEEN_CLICKS_VALUE']
    ]);
    await optionsPage.waitForTimeout(300);
    expect(await note.isVisible()).toBe(false);
    await optionsPage.evaluate(() => globalThis.heldWrites[0].release());
    await expect(note).toBeVisible();

    await optionsPage.evaluate(() => window.utils.alertNote.hide());
    await optionsPage.getByRole('radio', { name: /Default/ }).check();
    await expect.poll(writtenKeys).toEqual([
        ['MAXIMUM_TIME_BETWEEN_CLICKS_TYPE', 'MAXIMUM_TIME_BETWEEN_CLICKS_VALUE'],
        ['MAXIMUM_TIME_BETWEEN_CLICKS_TYPE']
    ]);
    await optionsPage.waitForTimeout(300);
    expect(await note.isVisible()).toBe(false);
    await optionsPage.evaluate(() => globalThis.heldWrites[1].release());
    await expect(note).toBeVisible();

    await expect.poll(() => serviceWorker.evaluate(() => chrome.storage.sync.get(null))).toEqual({
        MAXIMUM_TIME_BETWEEN_CLICKS_TYPE: 'default',
        MAXIMUM_TIME_BETWEEN_CLICKS_VALUE: '1000'
    });
});

const GESTURE_ROWS = [
    ['Double right click', 'closeTab'],
    ['Shift + Double right click', 'sameAsDoubleRightClick'],
    ['Ctrl + Double right click', 'sameAsDoubleRightClick'],
    ['Alt + Double right click', 'sameAsDoubleRightClick']
];

test('the gestures start with the double right click closing the tab and nothing set for the keys', async ({ context, extensionId }) => {
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);

    for (const [name, value] of GESTURE_ROWS) {
        await expect(optionsPage.getByRole('combobox', { name, exact: true })).toHaveValue(value);
    }
    // Only on macOS
    await expect(optionsPage.getByRole('combobox', { name: 'Cmd + Double right click' })).toBeHidden();
    await expect(optionsPage.getByRole('combobox', { name: 'Double right click', exact: true }).locator('option')).toHaveText([
        'Do nothing',
        'Close tab',
        'Go back',
        'Reload',
        'Hard reload',
        'New tab',
        'Duplicate tab',
        'Reopen last closed tab'
    ]);
    await expect(optionsPage.getByRole('combobox', { name: 'Alt + Double right click' }).locator('option').first()).toHaveText(
        'Same as Double right click'
    );
});

test('on macOS, the options page shows the Cmd key and calls the Alt key Option', async ({ context, extensionId }) => {
    const optionsPage = await context.newPage();
    await optionsPage.addInitScript(() => {
        chrome.runtime.getPlatformInfo = async function () {
            return { os: 'mac', arch: 'arm', nacl_arch: 'arm' };
        };
    });
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);

    await expect(optionsPage.getByRole('combobox', { name: 'Cmd + Double right click' })).toHaveValue('sameAsDoubleRightClick');
    await expect(optionsPage.getByRole('combobox', { name: 'Option + Double right click' })).toBeVisible();
});

test('the gesture dropdowns are equally wide, level with their labels, and keep their width when the note about the missing access shows, on the options page and in the popup', async ({ context, serviceWorker, extensionId }) => {
    const readGestures = async function (page) {
        return await page.evaluate(() => [...document.querySelectorAll('.gesture')].filter((el) => !el.hidden).map((el) => {
            const label = el.querySelector('label').getBoundingClientRect();
            const dropdown = el.querySelector('select').getBoundingClientRect();
            const note = el.querySelector('.gesture-permission-missing');
            return {
                width: Math.round(dropdown.width),
                levelOffset: Math.abs((label.top + label.height / 2) - (dropdown.top + dropdown.height / 2)),
                noteBelow: note.hidden ? null : note.getBoundingClientRect().top >= dropdown.bottom
            };
        }));
    };

    for (const path of ['options.html', 'options.html?popup']) {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/${path}`);
        await expect(page.getByRole('combobox', { name: 'Shift + Double right click' })).toHaveValue('sameAsDoubleRightClick');
        const gestures = await readGestures(page);
        const width = gestures[0].width;
        for (const gesture of gestures) {
            expect(gesture.width, path).toBe(width);
            expect(gesture.levelOffset, path).toBeLessThan(4);
        }

        await setGestureAction(serviceWorker, 'SHIFT_DOUBLE_RIGHT_CLICK_ACTION', 'reopenClosedTab');
        await page.reload();
        await expect(page.getByText('Needs access', { exact: true }).filter({ visible: true })).toHaveCount(1);
        const gesturesWithNote = await readGestures(page);
        for (const gesture of gesturesWithNote) {
            expect(gesture.width, path).toBe(width);
            expect(gesture.levelOffset, path).toBeLessThan(4);
        }
        // The note shows below its dropdown
        expect(gesturesWithNote.map((gesture) => gesture.noteBelow), path).toEqual([null, true, null, null]);

        await serviceWorker.evaluate(() => chrome.storage.sync.clear());
        await page.close();
    }
});

test('choosing what a gesture does saves it and shows the note', async ({ context, serviceWorker, extensionId }) => {
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    const altAction = optionsPage.getByRole('combobox', { name: 'Alt + Double right click' });

    await chooseOption(altAction, 'Duplicate tab');
    await expect(optionsPage.getByText('Saved')).toBeVisible();
    await expect.poll(() => serviceWorker.evaluate(() => chrome.storage.sync.get(null))).toEqual({
        ALT_DOUBLE_RIGHT_CLICK_ACTION: 'duplicateTab'
    });

    await optionsPage.reload();
    await expect(altAction).toHaveValue('duplicateTab');
});

test('the choice applies to the next gesture, without loading the page again', async ({ context, serviceWorker, extensionId }) => {
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}applies-at-once`);

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await chooseOption(optionsPage.getByRole('combobox', { name: 'Double right click', exact: true }), 'Do nothing');
    await expect.poll(() => serviceWorker.evaluate(() => chrome.storage.sync.get(null))).toEqual({
        DOUBLE_RIGHT_CLICK_ACTION: 'nothing'
    });
    await optionsPage.close();

    await page.bringToFront();
    await holdRightClick(page, 120);
    await page.waitForTimeout(150);
    await holdRightClick(page, 120);
    await page.waitForTimeout(1000);

    expect(page.isClosed()).toBe(false);
});

test('arrow keys move through the actions without asking for a permission on the way', async ({ context, serviceWorker, extensionId }) => {
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.evaluate(() => {
        window.permissionRequests = 0;
        chrome.permissions.request = async function () {
            window.permissionRequests += 1;
            return false;
        };
    });
    const doubleRightClickAction = optionsPage.getByRole('combobox', { name: 'Double right click', exact: true });

    await doubleRightClickAction.focus();
    for (let i = 0; i < 5; i++) {
        await optionsPage.keyboard.press('ArrowDown');
    }

    await expect(doubleRightClickAction).toHaveValue('duplicateTab');
    await expect.poll(() => serviceWorker.evaluate(() => chrome.storage.sync.get(null))).toEqual({
        DOUBLE_RIGHT_CLICK_ACTION: 'duplicateTab'
    });
    expect(await optionsPage.evaluate(() => window.permissionRequests)).toBe(0);
});

test('"Reset" shows once a gesture differs from its default, and puts the gestures back to their defaults', async ({ context, serviceWorker, extensionId }) => {
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    const reset = optionsPage.getByRole('button', { name: 'Reset', exact: true });
    const altAction = optionsPage.getByRole('combobox', { name: 'Alt + Double right click' });
    const doubleRightClickAction = optionsPage.getByRole('combobox', { name: 'Double right click', exact: true });
    await expect(altAction).toHaveValue('sameAsDoubleRightClick');
    await expect(reset).toBeHidden();

    await chooseOption(altAction, 'Duplicate tab');
    await chooseOption(doubleRightClickAction, 'Do nothing');
    await expect(reset).toBeVisible();
    await expect.poll(() => serviceWorker.evaluate(() => chrome.storage.sync.get(null))).toEqual({
        ALT_DOUBLE_RIGHT_CLICK_ACTION: 'duplicateTab',
        DOUBLE_RIGHT_CLICK_ACTION: 'nothing'
    });

    await reset.click();
    await expect(optionsPage.getByText('Reset to the defaults')).toBeVisible();
    await expect(reset).toBeHidden();
    await expect(altAction).toHaveValue('sameAsDoubleRightClick');
    await expect(doubleRightClickAction).toHaveValue('closeTab');
    await expect.poll(() => serviceWorker.evaluate(() => chrome.storage.sync.get(null))).toEqual({});

    await optionsPage.reload();
    await expect(altAction).toHaveValue('sameAsDoubleRightClick');
    await expect(reset).toBeHidden();
});

// The options dialog of chrome://extensions and the popup size themselves to the page, which must not jump (the dialog
// flashes a scrollbar while the page grows)
for (const pathname of ['/options.html', '/options.html?popup']) {
    test(`"Reset" showing and going away keeps the height of ${pathname}`, async ({ context, extensionId }) => {
        const optionsPage = await context.newPage();
        await optionsPage.goto(`chrome-extension://${extensionId}${pathname}`);
        const reset = optionsPage.getByRole('button', { name: 'Reset', exact: true });
        const shiftAction = optionsPage.getByRole('combobox', { name: 'Shift + Double right click' });
        const pageHeight = async function () {
            return await optionsPage.evaluate(() => document.body.getBoundingClientRect().height);
        };
        await expect(reset).toBeHidden();
        const heightWithoutReset = await pageHeight();

        await chooseOption(shiftAction, 'Do nothing');
        await expect(optionsPage.getByText('Saved')).toBeVisible();
        await expect(reset).toBeVisible();
        expect(await pageHeight()).toBe(heightWithoutReset);

        await chooseOption(shiftAction, 'Same as Double right click');
        await expect(reset).toBeHidden();
        expect(await pageHeight()).toBe(heightWithoutReset);
    });
}

test('outside macOS, a Cmd setting synced from a Mac neither shows "Reset" nor gets reset', async ({ context, serviceWorker, extensionId }) => {
    await setGestureAction(serviceWorker, 'META_DOUBLE_RIGHT_CLICK_ACTION', 'nothing');
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    const reset = optionsPage.getByRole('button', { name: 'Reset', exact: true });
    const ctrlAction = optionsPage.getByRole('combobox', { name: 'Ctrl + Double right click' });
    await expect(ctrlAction).toHaveValue('sameAsDoubleRightClick');
    await expect(reset).toBeHidden();

    await chooseOption(ctrlAction, 'Reload');
    await expect(reset).toBeVisible();
    await reset.click();

    await expect(reset).toBeHidden();
    await expect.poll(() => serviceWorker.evaluate(() => chrome.storage.sync.get(null))).toEqual({
        META_DOUBLE_RIGHT_CLICK_ACTION: 'nothing'
    });
});

test('on macOS, "Reset" shows for a changed Cmd row and resets it', async ({ context, serviceWorker, extensionId }) => {
    await setGestureAction(serviceWorker, 'META_DOUBLE_RIGHT_CLICK_ACTION', 'nothing');
    const optionsPage = await context.newPage();
    await optionsPage.addInitScript(() => {
        chrome.runtime.getPlatformInfo = async function () {
            return { os: 'mac', arch: 'arm', nacl_arch: 'arm' };
        };
    });
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    const reset = optionsPage.getByRole('button', { name: 'Reset', exact: true });
    await expect(optionsPage.getByRole('combobox', { name: 'Cmd + Double right click' })).toHaveValue('nothing');
    await expect(reset).toBeVisible();

    await reset.click();

    await expect(optionsPage.getByRole('combobox', { name: 'Cmd + Double right click' })).toHaveValue('sameAsDoubleRightClick');
    await expect(reset).toBeHidden();
    await expect.poll(() => serviceWorker.evaluate(() => chrome.storage.sync.get(null))).toEqual({});
});

const storeCustomMaxTimeBetweenClicks = async function (serviceWorker, value) {
    await serviceWorker.evaluate(async (value) => {
        await chrome.storage.sync.set({
            MAXIMUM_TIME_BETWEEN_CLICKS_TYPE: 'custom',
            MAXIMUM_TIME_BETWEEN_CLICKS_VALUE: value
        });
    }, value);
};

// Two held right clicks which start the given time apart
const rightClicksApart = async function (page, ms) {
    await holdRightClick(page, 120);
    await page.waitForTimeout(ms - 120);
    await holdRightClick(page, 120);
};

test('"Too slow" goes up in steps of 100 ms', async ({ context, extensionId }) => {
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);

    await expect(optionsPage.locator('optgroup[label="Too slow"] option')).toHaveText([
        '800', '900', '1000', '1100', '1200', '1300', '1400', '1500', '1600', '1700', '1800', '1900', '2000'
    ]);
});

test('a saved maximum time which the dropdown no longer offers shows as 500 ms', async ({ context, serviceWorker, extensionId }) => {
    await storeCustomMaxTimeBetweenClicks(serviceWorker, '850');
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);

    await expect(optionsPage.getByRole('radio', { name: /Custom/ })).toBeChecked();
    await expect(optionsPage.getByRole('combobox', { name: 'Maximum time between clicks' })).toHaveValue('500');
});

test('a saved maximum time which the dropdown no longer offers means 500 ms on pages', async ({ context, serviceWorker }) => {
    await storeCustomMaxTimeBetweenClicks(serviceWorker, '1950');
    const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}no-longer-offered`);

    // Within 1950 ms, but not within 500 ms
    await rightClicksApart(page, 1000);
    await page.waitForTimeout(1000);

    expect(page.isClosed()).toBe(false);
});

for (const [value, apart] of [['750', 650], ['2000', 1500]]) {
    test(`a saved custom maximum time of ${value} ms applies on pages`, async ({ context, serviceWorker }) => {
        await storeCustomMaxTimeBetweenClicks(serviceWorker, value);
        const page = await openTestPage({ context, serviceWorker }, `${CANCEL_CONTEXT_MENU_PATH}custom-${value}`);
        const closed = page.waitForEvent('close');

        // Not within the default 500 ms
        await rightClicksApart(page, apart);

        await closed;
    });
}

test('the note which confirms a change leaves room above the first heading', async ({ context, extensionId }) => {
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);

    await optionsPage.getByRole('combobox', { name: 'Maximum time between clicks' }).selectOption('1000');
    const note = optionsPage.locator('.alert-note-text');
    await expect(note).toBeVisible();

    // The note's box is the bordered element around its text
    const noteBottom = await note.evaluate((el) => el.parentElement.getBoundingClientRect().bottom);
    const headingTop = await optionsPage.locator('.option-heading').first().evaluate((el) => el.getBoundingClientRect().top);
    expect(headingTop - noteBottom).toBeGreaterThanOrEqual(8);
});
