import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import solid from "ultracite/oxlint/solid";

// Ultracite's presets replace the rules inherited from the upstream project
// (PRD §5.3, Q8b). Everything Ultracite enables stays on; the `rules` block below
// is the documented deviation list — one entry per rule with its reason, and no
// blanket `ignorePatterns`.
//
// Why the list is this long: Ultracite is strict and most of this tree is
// inherited music-era code that rev 5 decided to keep in the tree (§R5/Q2) as
// reference until P1/P2 rework it. The trailing number is how many findings the
// rule had when the entry was measured — re-measured in rev 13, after seven
// music-era plugins were deleted (PRD §R5), which removed 12 entries outright and
// corrected 69 counts. Delete an entry once its code is fixed (re-enable it
// temporarily to re-measure, the way it was measured here).
export default defineConfig({
  extends: [core, solid],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "dist/**",
    "pack/**",
    "test-results/**",
    "playwright-report/**",
    // Installed by the skills CLI (see skills-lock.json); third-party documents.
    ".agents/**",
  ],
  // Requires oxlint-tsgolint (installed); turns on the type-aware rules.
  options: { typeAware: true },
  rules: {
    // typescript — type-aware rules: this codebase is not type-clean yet, P1/P2 rework it
    "typescript/no-unnecessary-type-parameters": "off", // 208
    "typescript/strict-boolean-expressions": "off", // 188
    "typescript/no-floating-promises": "off", // 86
    "typescript/no-unsafe-type-assertion": "off", // 105
    "typescript/strict-void-return": "off", // 59
    "typescript/no-misused-promises": "off", // 49
    "typescript/no-non-null-assertion": "off", // 31
    "typescript/return-await": "off", // 13
    "typescript/prefer-nullish-coalescing": "off", // 14
    "typescript/method-signature-style": "off", // 63
    "typescript/promise-function-async": "off", // 91
    "typescript/no-confusing-void-expression": "off", // 44
    "typescript/no-unnecessary-type-conversion": "off", // 14
    "typescript/no-inferrable-types": "off", // 3
    "typescript/consistent-type-imports": "off", // 3
    "typescript/no-dynamic-delete": "off", // 5
    "typescript/prefer-literal-enum-member": "off", // 4
    "typescript/no-empty-interface": "off", // 4
    "typescript/unified-signatures": "off", // 3
    "typescript/consistent-return": "off", // 2
    "typescript/prefer-promise-reject-errors": "off", // 2
    "typescript/consistent-indexed-object-style": "off", // 1
    "typescript/no-deprecated": "off", // 1
    "typescript/no-invalid-void-type": "off", // 1
    "typescript/no-unsafe-return": "off", // 4

    // eslint — Ultracite core strictness over inherited music-era code
    "eslint/sort-keys": "off", // 149
    "eslint/no-inline-comments": "off", // 68
    "eslint/no-use-before-define": "off", // 65
    "eslint/func-style": "off", // 63
    "eslint/curly": "off", // 33
    "eslint/no-shadow": "off", // 34
    "eslint/require-unicode-regexp": "off", // 12
    "eslint/no-await-in-loop": "off", // 24
    "eslint/no-bitwise": "off", // 15
    "eslint/prefer-destructuring": "off", // 13
    "eslint/require-await": "off", // 16
    "eslint/prefer-named-capture-group": "off", // 4
    "eslint/no-empty-function": "off", // 10
    "eslint/class-methods-use-this": "off", // 1
    "eslint/no-param-reassign": "off", // 3
    "eslint/no-plusplus": "off", // 5
    "eslint/complexity": "off", // 7
    "eslint/guard-for-in": "off", // 3
    "eslint/no-empty": "off", // 2
    "eslint/no-nested-ternary": "off", // 9
    "eslint/no-useless-call": "off", // 4
    "eslint/prefer-template": "off", // 2
    "eslint/no-negated-condition": "off", // 1
    "eslint/no-warning-comments": "off", // 3
    "eslint/default-case": "off", // 3
    "eslint/eqeqeq": "off", // 1
    "eslint/max-classes-per-file": "off", // 1
    "eslint/no-lonely-if": "off", // 2
    "eslint/no-new-func": "off", // 2
    "eslint/no-unmodified-loop-condition": "off", // 1
    "eslint/no-useless-return": "off", // 1
    "eslint/default-case-last": "off", // 1
    "eslint/func-names": "off", // 1
    "eslint/no-promise-executor-return": "off", // 2
    "eslint/no-throw-literal": "off", // 1
    "eslint/no-useless-concat": "off", // 1
    "eslint/no-useless-constructor": "off", // 1
    "eslint/object-shorthand": "off", // 1

    // unicorn — Ultracite style rules over inherited code
    "unicorn/consistent-function-scoping": "off", // 18
    "unicorn/no-await-expression-member": "off", // 24
    "unicorn/no-array-for-each": "off", // 12
    "unicorn/prefer-number-properties": "off", // 1
    "unicorn/escape-case": "off", // 9
    "unicorn/prefer-ternary": "off", // 3
    "unicorn/import-style": "off", // 8
    "unicorn/prefer-number-coercion": "off", // 4
    "unicorn/text-encoding-identifier-case": "off", // 1
    "unicorn/no-anonymous-default-export": "off", // 4
    "unicorn/prefer-math-trunc": "off", // 4
    "unicorn/prefer-string-replace-all": "off", // 4
    "unicorn/no-array-sort": "off", // 4
    "unicorn/no-negated-condition": "off", // 1
    "unicorn/no-useless-promise-resolve-reject": "off", // 2
    "unicorn/no-useless-undefined": "off", // 15
    "unicorn/numeric-separators-style": "off", // 2
    "unicorn/prefer-classlist-toggle": "off", // 2
    "unicorn/prefer-export-from": "off", // 1
    "unicorn/prefer-module": "off", // 3
    "unicorn/catch-error-name": "off", // 2
    "unicorn/no-instanceof-builtins": "off", // 2
    "unicorn/no-lonely-if": "off", // 3
    "unicorn/prefer-add-event-listener": "off", // 2
    "unicorn/prefer-spread": "off", // 2
    "unicorn/no-array-reduce": "off", // 1
    "unicorn/no-immediate-mutation": "off", // 2
    "unicorn/no-object-as-default-parameter": "off", // 1
    "unicorn/no-zero-fractions": "off", // 1
    "unicorn/prefer-logical-operator-over-ternary": "off", // 1
    "unicorn/prefer-string-slice": "off", // 1
    "unicorn/prefer-type-error": "off", // 1

    // promise — the inherited code mixes callbacks, promise chains and async
    "promise/prefer-await-to-callbacks": "off", // 16
    "promise/prefer-await-to-then": "off", // 24
    "promise/avoid-new": "off", // 11
    "promise/no-nesting": "off", // 1

    // node — Node-specific strictness in inherited plugin code
    "node/callback-return": "off", // 2
    "node/global-require": "off", // 1

    // import — module cycles come from the music-era plugin graph
    "import/no-cycle": "off", // 8
    "import/no-mutable-exports": "off", // 2

    // jsdoc — JSDoc written in the upstream project’s own convention
    "jsdoc/check-tag-names": "off", // 4

    // oxc — the plugin loader is a barrel file by design
    "oxc/no-barrel-file": "off", // 2
  },
});
