/* global utils */

const ready = function (cb) {
    if (document.readyState !== 'loading') {
        cb();
    } else {
        document.addEventListener('DOMContentLoaded', cb);
    }
};

const RadioButtonSelectedValueSet = function (name, SelectedValue) {
    const els = document.querySelectorAll('input[name="' + name + '"]');
    els.forEach((el) => {
        if (el.value === SelectedValue) {
            el.checked = true;
        }
    });
};

const notifyUser = function (message = 'Your change would apply next time onwards') {
    utils.alertNote(`✓ ${message}`, 2500);
};

const main = function () {
    const TIME_BETWEEN_CLICKS_RANGE_MIN = 100;
    const TIME_BETWEEN_CLICKS_RANGE_MAX = 2000;
    const TIME_BETWEEN_CLICKS_DEFAULT = 500;

    const MAXIMUM_TIME_BETWEEN_CLICKS_TYPE = 'MAXIMUM_TIME_BETWEEN_CLICKS_TYPE';
    const MAXIMUM_TIME_BETWEEN_CLICKS_VALUE = 'MAXIMUM_TIME_BETWEEN_CLICKS_VALUE';

    const chromeStorageForExtensionData = chrome.storage.sync || chrome.storage.local;

    const maximumTimeTypeRadioName = 'maximum-time-between-clicks-type';

    const radios = document.querySelectorAll(`input[name="${maximumTimeTypeRadioName}"]`);
    radios.forEach((radio) => {
        radio.addEventListener('change', function () {
            const value = radio.value;
            let valueToSet = 'default';
            if (value === 'custom') {
                valueToSet = 'custom';
            }
            chromeStorageForExtensionData.set({[MAXIMUM_TIME_BETWEEN_CLICKS_TYPE]: valueToSet});
            notifyUser();
        });
    });

    chromeStorageForExtensionData.get(MAXIMUM_TIME_BETWEEN_CLICKS_TYPE, function (values) {
        if (values && values[MAXIMUM_TIME_BETWEEN_CLICKS_TYPE] === 'custom') {
            RadioButtonSelectedValueSet(maximumTimeTypeRadioName, 'custom');
        } else {
            RadioButtonSelectedValueSet(maximumTimeTypeRadioName, 'default');
        }
    });

    const elMaxTimeBetweenClicksDropdown = document.querySelector('.maximum-time-between-clicks-value');
    chromeStorageForExtensionData.get(MAXIMUM_TIME_BETWEEN_CLICKS_VALUE, function (values) {
        let value = parseInt(values && values[MAXIMUM_TIME_BETWEEN_CLICKS_VALUE], 10);
        if (
            Number.isInteger(value) &&
            value >= TIME_BETWEEN_CLICKS_RANGE_MIN &&
            value <= TIME_BETWEEN_CLICKS_RANGE_MAX
        ) {
            // do nothing
        } else {
            value = TIME_BETWEEN_CLICKS_DEFAULT;
        }
        elMaxTimeBetweenClicksDropdown.value = value;
    });
    elMaxTimeBetweenClicksDropdown.addEventListener('change', function () {
        const
            value = elMaxTimeBetweenClicksDropdown.value,
            intValue = parseInt(value, 10);
        let valueToSet;
        if (
            Number.isInteger(intValue) &&
            intValue >= TIME_BETWEEN_CLICKS_RANGE_MIN &&
            intValue <= TIME_BETWEEN_CLICKS_RANGE_MAX
        ) {
            valueToSet = intValue;
        } else {
            valueToSet = TIME_BETWEEN_CLICKS_DEFAULT;
        }

        chromeStorageForExtensionData.set({[MAXIMUM_TIME_BETWEEN_CLICKS_VALUE]: `${valueToSet}`});

        // Also mark that "Custom" maximum-time-between-clicks would be used
        RadioButtonSelectedValueSet(maximumTimeTypeRadioName, 'custom');
        chromeStorageForExtensionData.set({[MAXIMUM_TIME_BETWEEN_CLICKS_TYPE]: 'custom'});

        notifyUser();
    });

    // What a double right click does, without a modifier key and with each one held on its first click. The background
    // script reads these settings on each gesture, so a change applies at once.
    const ACTION_SAME_AS_DOUBLE_RIGHT_CLICK = 'sameAsDoubleRightClick';
    const ACTION_REOPEN_CLOSED_TAB = 'reopenClosedTab';
    // Reopening comes last, since it asks for a permission: arrow keys change the value of a closed dropdown one option
    // at a time, which should not stop by it on the way to another one
    const ACTION_LABELS = [
        ['nothing', 'Do nothing'],
        ['closeTab', 'Close the tab'],
        ['goBack', 'Go back'],
        ['reload', 'Reload the tab'],
        ['newTab', 'Open a new tab'],
        ['duplicateTab', 'Duplicate the tab'],
        [ACTION_REOPEN_CLOSED_TAB, 'Reopen the last closed tab']
    ];
    // The setting of the double right click itself; the ones with a modifier key can follow it
    const DOUBLE_RIGHT_CLICK_ACTION = 'DOUBLE_RIGHT_CLICK_ACTION';
    const elGestureActions = [...document.querySelectorAll('.gesture-action')];
    const defaultAction = function (elGestureAction) {
        return elGestureAction.dataset.setting === DOUBLE_RIGHT_CLICK_ACTION ? 'closeTab' : ACTION_SAME_AS_DOUBLE_RIGHT_CLICK;
    };
    // The value each dropdown shows as saved, to go back to when the user denies a permission
    const savedActions = new Map();

    // Reopening the last closed tab needs the optional "sessions" permission. It gets asked for when the user chooses
    // that action, and removed once no gesture uses it. The user can also revoke it in the browser's add-on settings,
    // so the page tells when it is missing.
    const SESSIONS_PERMISSION = { permissions: ['sessions'] };
    const elSessionsPermissionMissing = document.querySelector('.sessions-permission-missing');
    // A hidden row (Cmd outside macOS) does nothing, whatever it keeps
    const isReopenChosenFor = function (elGestureAction) {
        return !elGestureAction.closest('.gesture').hidden && savedActions.get(elGestureAction) === ACTION_REOPEN_CLOSED_TAB;
    };
    const isReopenChosen = function () {
        return elGestureActions.some(isReopenChosenFor);
    };
    const showSessionsPermission = async function () {
        const isGranted = await chrome.permissions.contains(SESSIONS_PERMISSION);
        elGestureActions.forEach((elGestureAction) => {
            const elMissing = elGestureAction.closest('.gesture').querySelector('.gesture-permission-missing');
            elMissing.hidden = isGranted || !isReopenChosenFor(elGestureAction);
        });
        elSessionsPermissionMissing.hidden = isGranted || !isReopenChosen();
    };
    chrome.permissions.onAdded.addListener(showSessionsPermission);
    chrome.permissions.onRemoved.addListener(showSessionsPermission);
    document.querySelector('.grant-sessions-permission').addEventListener('click', function () {
        // Firefox only asks for a permission straight from the user's action: nothing may be awaited before this
        chrome.permissions.request(SESSIONS_PERMISSION).then(showSessionsPermission, function (e) {
            console.log('Could not ask for the permission to reopen closed tabs', e);
        });
    });

    const saveAction = async function (elGestureAction) {
        const action = elGestureAction.value;
        await chromeStorageForExtensionData.set({ [elGestureAction.dataset.setting]: action });
        savedActions.set(elGestureAction, action);
        notifyUser('Saved');
        if (!isReopenChosen() && await chrome.permissions.contains(SESSIONS_PERMISSION)) {
            await chrome.permissions.remove(SESSIONS_PERMISSION);
        }
        showSessionsPermission();
    };

    elGestureActions.forEach((elGestureAction) => {
        const options = elGestureAction.dataset.setting === DOUBLE_RIGHT_CLICK_ACTION ?
            ACTION_LABELS :
            [[ACTION_SAME_AS_DOUBLE_RIGHT_CLICK, 'Same as Double right click'], ...ACTION_LABELS];
        options.forEach(([value, label]) => {
            elGestureAction.add(new Option(label, value));
        });
        elGestureAction.value = defaultAction(elGestureAction);
        savedActions.set(elGestureAction, elGestureAction.value);

        elGestureAction.addEventListener('change', function () {
            if (elGestureAction.value !== ACTION_REOPEN_CLOSED_TAB) {
                saveAction(elGestureAction);
                return;
            }
            // Firefox only asks for a permission straight from the user's action: nothing may be awaited before this
            chrome.permissions.request(SESSIONS_PERMISSION).then(function (granted) {
                if (granted) {
                    saveAction(elGestureAction);
                } else {
                    // The user denied the prompt
                    elGestureAction.value = savedActions.get(elGestureAction);
                }
            }, function (e) {
                // The browser did not ask (unlike a denied prompt), so keep the choice: the page then offers to grant
                // the permission with a button
                console.log('Could not ask for the permission to reopen closed tabs', e);
                saveAction(elGestureAction);
            });
        });
    });

    chromeStorageForExtensionData.get(elGestureActions.map((elGestureAction) => elGestureAction.dataset.setting), function (values) {
        elGestureActions.forEach((elGestureAction) => {
            const action = values && values[elGestureAction.dataset.setting];
            const isOffered = [...elGestureAction.options].some((option) => option.value === action);
            elGestureAction.value = isOffered ? action : defaultAction(elGestureAction);
            savedActions.set(elGestureAction, elGestureAction.value);
        });
        showSessionsPermission();
    });

    // The Cmd key only counts on macOS, where the Alt key is called Option
    chrome.runtime.getPlatformInfo().then(function (platformInfo) {
        if (platformInfo.os === 'mac') {
            document.querySelectorAll('.gesture-mac-only').forEach((el) => {
                el.hidden = false;
            });
            document.querySelector('.alt-key-name').textContent = 'Option';
            showSessionsPermission();
        }
    });

    const btnDone = document.getElementById('done');
    btnDone.addEventListener('click', function () {
        // Where the page stays open (Firefox shows it inside about:addons, where window.close() does nothing), the note
        // confirms the changes. The delay keeps it from flashing on a page which closes.
        setTimeout(notifyUser, 100);
        window.close();
    });
};

ready(main);
