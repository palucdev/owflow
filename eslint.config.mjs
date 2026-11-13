import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig } from "eslint/config";
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import security from 'eslint-plugin-security';

export default defineConfig(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '.owflow/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  sonarjs.configs.recommended,
  unicorn.configs['recommended'],
  security.configs.recommended,
  {
    files: ['**/*.ts', '**/*.js', '**/*.mjs'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js', '*.mjs', '*.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      noInlineConfig: true, // Prevents inline comments from silencing rules
    },
    rules: {
      'max-params': ['error', 2],
      'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
      'max-lines': ['error', { max: 250, skipBlankLines: true, skipComments: true }],
      'no-magic-numbers': 'off',
      '@typescript-eslint/no-magic-numbers': [
        'error',
        { ignore: [0, 1, -1], ignoreArrayIndexes: true, enforceConst: true },
      ],
      'complexity': ['error', 10],
      'max-depth': ['error', 4],
      'max-statements': ['error', 20],
      'max-classes-per-file': ['error', 1],
      'id-length': ['error', { min: 2, exceptions: ['_'] }],
      'eqeqeq': ['error', 'always'],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'Direct process.env access forbidden. Use DI to get configuration',
        },
      ],
    },
  }
);

