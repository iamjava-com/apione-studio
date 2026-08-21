import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier/flat';

// Syntactic lint only — no type-aware rules. tsc (strict, run in the build) owns type
// safety; ESLint here is for what tsc can't see: the react-hooks correctness rules.
export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactRefresh.configs.vite,
  {
    // react-hooks v7 ships recommended-latest with a legacy string-array `plugins` key
    // that flat config rejects — register the plugin ourselves, take its rules.
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs['recommended-latest'].rules,
  },
  {
    languageOptions: { globals: globals.browser },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // v7 perf-opinion rule; fires on legitimate derived-state syncing. Off for now.
      'react-hooks/set-state-in-effect': 'off',
      // Provider/theme files deliberately co-locate their hook with the component. This
      // rule only flags Fast-Refresh granularity (a dev-HMR nicety), never correctness —
      // off so lint can gate on real issues (see --max-warnings 0).
      'react-refresh/only-export-components': 'off',
    },
  },
  prettier,
);
