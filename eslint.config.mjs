import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import cds from '@sap/eslint-plugin-cds'

export default tseslint.config(
  { ignores: ['node_modules/', 'gen/', '@cds-models/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  cds.configs.recommended,
  {
    files: ['*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { module: 'writable', require: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
)
