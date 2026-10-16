import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  singleQuote: true,
  semi: true,
  trailingComma: "all",
  printWidth: 80,
  tabWidth: 2,
  arrowParens: "always",
  bracketSpacing: true,
  endOfLine: "lf",
  quoteProps: "preserve",
  ignorePatterns: [
    ...ultracite.ignorePatterns,
    "dist/",
    "node_modules/",
    "coverage/",
    "pnpm-lock.yaml",
    "changelog.md",
    "**/*.d.ts",
    "src/plugins/performance-improvement/scripts/**/*.js",
  ],
});
