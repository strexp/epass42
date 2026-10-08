import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

/**
 * ESLint flat configuration for the pnpm workspace.
 *
 * Formatting is owned by Prettier; `skipFormatting` turns off the rules that
 * would fight it.  The Vue TypeScript config is applied across the workspace:
 * it also lints plain `.ts` files (packages/pki, backend, scripts).
 */
export default defineConfigWithVueTs(
  {
    name: 'pkd42/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}'],
  },
  {
    name: 'pkd42/files-to-ignore',
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      'reference/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  pluginVue.configs['flat/recommended'],
  vueTsConfigs.recommended,
  {
    name: 'pkd42/rules',
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  skipFormatting,
)
