# TODO

Working list of things we owe the codebase. Scope and decisions live in [`docs/PRD.md`](docs/PRD.md) — this file only tracks the debt we accepted knowingly.

## Lint debt

Ultracite's presets are on and the deviation list is deliberately temporary. Two review rounds are due once P1/P2 have reworked the inherited plugins:

- [ ] **Review every `oxlint-disable` comment.** Each one is a scoped exception with a written reason. Re-check whether the disable is still needed, or whether the code can be fixed to satisfy the rule. Find them with `grep -rn 'oxlint-disable' src tools vite-plugins *.ts`.
- [ ] **Review the deviation list in `oxlint.config.ts`.** It carries 117 rules that Ultracite enables and this tree currently violates (~2000 findings), because the plugins kept for reference (§R5/Q2) are still music-era code. An entry should disappear when the code it covers is reworked: fix the findings, then delete the entry. Re-measure by flipping the value back to `'error'` and running `pnpm exec ultracite check`.
