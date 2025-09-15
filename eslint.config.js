import js from '@eslint/js';
import globals from 'globals';

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: "latest",
            globals: {
                ...globals.browser,
                ...globals.webextensions
            }
        },
        rules: {
            "indent": ["error", 4, { "SwitchCase": 1 }],
            "linebreak-style": ["error", "unix"],
            "semi": ["error", "always"]
        }
    }
];
