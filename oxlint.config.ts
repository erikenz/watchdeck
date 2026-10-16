import { defineConfig } from 'oxlint';
import core from 'ultracite/oxlint/core';
import solid from 'ultracite/oxlint/solid';

// Ultracite's presets replace the rules inherited from the upstream project
// (PRD §5.3, Q8b). Everything Ultracite enables stays on; the `rules` block is
// the documented deviation list — one entry per rule with its reason, and no
// blanket `ignorePatterns`.
export default defineConfig({
  extends: [core, solid],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    'dist/**',
    'pack/**',
    'test-results/**',
    'playwright-report/**',
  ],
  // Requires oxlint-tsgolint (installed); turns on the type-aware rules.
  options: { typeAware: true },
  rules: {},
});
