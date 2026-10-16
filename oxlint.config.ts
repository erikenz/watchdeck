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
// rule had when the entry was measured. Delete an entry once its code is fixed
// (re-enable it temporarily to re-measure, the way it was measured here).
export default defineConfig({
  extends: [core, solid],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "dist/**",
    "pack/**",
    "test-results/**",
    "playwright-report/**",
  ],
  // Requires oxlint-tsgolint (installed); turns on the type-aware rules.
  options: { typeAware: true },
  rules: {
    // typescript — type-aware rules: this codebase is not type-clean yet, P1/P2 rework it
    "typescript/no-unnecessary-type-parameters": "off", // 207
    "typescript/strict-boolean-expressions": "off", // 178
    "typescript/no-floating-promises": "off", // 122
    "typescript/no-unsafe-type-assertion": "off", // 110
    "typescript/strict-void-return": "off", // 82
    "typescript/no-misused-promises": "off", // 63
    "typescript/no-non-null-assertion": "off", // 38
    "typescript/return-await": "off", // 24
    "typescript/prefer-nullish-coalescing": "off", // 22
    "typescript/method-signature-style": "off", // 20
    "typescript/promise-function-async": "off", // 13
    "typescript/no-confusing-void-expression": "off", // 11
    "typescript/no-unnecessary-type-conversion": "off", // 10
    "typescript/no-inferrable-types": "off", // 7
    "typescript/consistent-type-imports": "off", // 5
    "typescript/no-dynamic-delete": "off", // 5
    "typescript/prefer-literal-enum-member": "off", // 4
    "typescript/no-empty-interface": "off", // 3
    "typescript/unified-signatures": "off", // 3
    "typescript/consistent-return": "off", // 2
    "typescript/prefer-promise-reject-errors": "off", // 2
    "typescript/consistent-indexed-object-style": "off", // 1
    "typescript/no-deprecated": "off", // 1
    "typescript/no-extraneous-class": "off", // 1
    "typescript/no-invalid-void-type": "off", // 1
    "typescript/no-unsafe-return": "off", // 1
    "typescript/prefer-function-type": "off", // 1
    "typescript/use-unknown-in-catch-callback-variable": "off", // 1

    // eslint — Ultracite core strictness over inherited music-era code
    "eslint/sort-keys": "off", // 208
    "eslint/no-inline-comments": "off", // 202
    "eslint/no-use-before-define": "off", // 79
    "eslint/func-style": "off", // 70
    "eslint/curly": "off", // 47
    "eslint/no-shadow": "off", // 33
    "eslint/require-unicode-regexp": "off", // 18
    "eslint/no-await-in-loop": "off", // 14
    "eslint/no-bitwise": "off", // 14
    "eslint/prefer-destructuring": "off", // 14
    "eslint/require-await": "off", // 14
    "eslint/prefer-named-capture-group": "off", // 13
    "eslint/no-empty-function": "off", // 11
    "eslint/class-methods-use-this": "off", // 9
    "eslint/no-param-reassign": "off", // 7
    "eslint/no-plusplus": "off", // 6
    "eslint/no-unused-vars": "off", // 6
    "eslint/complexity": "off", // 5
    "eslint/guard-for-in": "off", // 5
    "eslint/no-empty": "off", // 5
    "eslint/no-nested-ternary": "off", // 4
    "eslint/no-useless-call": "off", // 4
    "eslint/prefer-template": "off", // 4
    "eslint/no-negated-condition": "off", // 3
    "eslint/no-warning-comments": "off", // 3
    "eslint/default-case": "off", // 2
    "eslint/eqeqeq": "off", // 2
    "eslint/max-classes-per-file": "off", // 2
    "eslint/no-lonely-if": "off", // 2
    "eslint/no-new-func": "off", // 2
    "eslint/no-unmodified-loop-condition": "off", // 2
    "eslint/no-useless-return": "off", // 2
    "eslint/default-case-last": "off", // 1
    "eslint/func-names": "off", // 1
    "eslint/logical-assignment-operators": "off", // 1
    "eslint/no-multi-assign": "off", // 1
    "eslint/no-promise-executor-return": "off", // 1
    "eslint/no-throw-literal": "off", // 1
    "eslint/no-useless-computed-key": "off", // 1
    "eslint/no-useless-concat": "off", // 1
    "eslint/no-useless-constructor": "off", // 1
    "eslint/object-shorthand": "off", // 1

    // unicorn — Ultracite style rules over inherited code
    "unicorn/consistent-function-scoping": "off", // 27
    "unicorn/no-await-expression-member": "off", // 19
    "unicorn/no-array-for-each": "off", // 16
    "unicorn/prefer-number-properties": "off", // 8
    "unicorn/escape-case": "off", // 7
    "unicorn/filename-case": "off", // 6
    "unicorn/prefer-ternary": "off", // 6
    "unicorn/import-style": "off", // 5
    "unicorn/prefer-number-coercion": "off", // 5
    "unicorn/text-encoding-identifier-case": "off", // 5
    "unicorn/no-anonymous-default-export": "off", // 4
    "unicorn/prefer-math-trunc": "off", // 4
    "unicorn/prefer-string-replace-all": "off", // 4
    "unicorn/no-abusive-eslint-disable": "off", // 3
    "unicorn/no-array-sort": "off", // 3
    "unicorn/no-negated-condition": "off", // 3
    "unicorn/no-useless-promise-resolve-reject": "off", // 3
    "unicorn/no-useless-undefined": "off", // 3
    "unicorn/numeric-separators-style": "off", // 3
    "unicorn/prefer-classlist-toggle": "off", // 3
    "unicorn/prefer-export-from": "off", // 3
    "unicorn/prefer-module": "off", // 3
    "unicorn/catch-error-name": "off", // 2
    "unicorn/no-instanceof-builtins": "off", // 2
    "unicorn/no-lonely-if": "off", // 2
    "unicorn/prefer-add-event-listener": "off", // 2
    "unicorn/prefer-spread": "off", // 2
    "unicorn/no-array-reduce": "off", // 1
    "unicorn/no-immediate-mutation": "off", // 1
    "unicorn/no-new-array": "off", // 1
    "unicorn/no-object-as-default-parameter": "off", // 1
    "unicorn/no-static-only-class": "off", // 1
    "unicorn/no-zero-fractions": "off", // 1
    "unicorn/prefer-dom-node-remove": "off", // 1
    "unicorn/prefer-logical-operator-over-ternary": "off", // 1
    "unicorn/prefer-string-slice": "off", // 1
    "unicorn/prefer-type-error": "off", // 1

    // promise — the inherited code mixes callbacks, promise chains and async
    "promise/prefer-await-to-callbacks": "off", // 25
    "promise/prefer-await-to-then": "off", // 19
    "promise/avoid-new": "off", // 13
    "promise/no-nesting": "off", // 2

    // node — Node-specific strictness in inherited plugin code
    "node/callback-return": "off", // 2
    "node/global-require": "off", // 1

    // import — module cycles come from the music-era plugin graph
    "import/no-cycle": "off", // 8
    "import/no-mutable-exports": "off", // 2

    // jsdoc — JSDoc written in the upstream project’s own convention
    "jsdoc/check-tag-names": "off", // 10

    // oxc — the plugin loader is a barrel file by design
    "oxc/no-barrel-file": "off", // 3
  },
});
