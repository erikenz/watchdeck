import { defineConfig } from 'oxfmt';
import ultracite from 'ultracite/oxfmt';

export default defineConfig({
  ...ultracite,
  arrowParens: 'always',
  bracketSpacing: true,
  endOfLine: 'lf',
  ignorePatterns: [
    ...ultracite.ignorePatterns,
    // Prose we hand-maintain: reformatting it only rewraps paragraphs (the PRD
    // carries intentional line breaks for reviewable diffs, the README mirrors
    // the layout of the project it forked from).
    'README.md',
    'docs/**',
    'dist/',
    'node_modules/',
    'coverage/',
    'pnpm-lock.yaml',
    'changelog.md',
    '**/*.d.ts',
    'src/plugins/performance-improvement/scripts/**/*.js',
  ],
  printWidth: 80,
  quoteProps: 'preserve',
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'all',
});
