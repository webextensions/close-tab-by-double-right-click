/* global chrome, utils */

const ready = function (cb) {
    if (document.readyState !== 'loading') {
        cb();
    } else {
        document.addEventListener('DOMContentLoaded', cb);
    }
};

const RadioButtonSelectedValueSet = function (name, SelectedValue) {
    const els = document.querySelectorAll('input[name="' + name+ '"]');
    els.forEach((el) => {
        if (el.value === SelectedValue) {
            el.checked = true;
        }
    });
};

const notifyUser = function () {
    utils.alertNote('✓ Your change would apply next time onwards', 2500);
};

const main = function () {
    const TIME_BETWEEN_CLICKS_RANGE_MIN = 100;
    const TIME_BETWEEN_CLICKS_RANGE_MAX = 2000;
    const TIME_BETWEEN_CLICKS_DEFAULT = 500;

    const MAXIMUM_TIME_BETWEEN_CLICKS_TYPE = 'MAXIMUM_TIME_BETWEEN_CLICKS_TYPE';
    const MAXIMUM_TIME_BETWEEN_CLICKS_VALUE = 'MAXIMUM_TIME_BETWEEN_CLICKS_VALUE';

    // Note:
    //     In Firefox, using sync storage requires an add-on ID (https://extensionworkshop.com/documentation/develop/extensions-and-the-add-on-id/#when-do-you-need-an-add-on-id)
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
        let valueToSet = value;
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

    const btnDone = document.getElementById('done');
    btnDone.addEventListener('click', function () {
        window.close();
    });
};

ready(main);
