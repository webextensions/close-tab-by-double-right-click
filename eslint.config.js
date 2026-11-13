import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import { defineConfig } from 'eslint/config';
import globals from 'globals';

export default defineConfig([
    {
        ignores: ['web-ext-artifacts/', 'web-ext-profile/', 'dist/']
    },
    js.configs.recommended,
    {
        plugins: {
            '@stylistic': stylistic
        },
        languageOptions: {
            ecmaVersion: 'latest',
            globals: {
                ...globals.browser,
                ...globals.webextensions
            }
        },
        rules: {
            'curly': 'error',
            'eqeqeq': 'error',

            '@stylistic/comma-dangle': ['error', 'never'],
            '@stylistic/eol-last': 'error',
            '@stylistic/indent': ['error', 4, { 'SwitchCase': 1 }],
            '@stylistic/keyword-spacing': 'error',
            '@stylistic/linebreak-style': ['error', 'unix'],
            '@stylistic/no-multiple-empty-lines': ['error', { 'max': 1, 'maxBOF': 0, 'maxEOF': 0 }],
            '@stylistic/no-trailing-spaces': 'error',
            '@stylistic/quotes': ['error', 'single', { 'avoidEscape': true }],
            '@stylistic/semi': ['error', 'always'],
            '@stylistic/space-before-function-paren': ['error', { 'anonymous': 'always', 'named': 'never', 'asyncArrow': 'always' }],
            '@stylistic/space-infix-ops': 'error'
        }
    },
    {
        files: ['eslint.config.js', 'scripts/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.node
            }
        }
    }
]);
