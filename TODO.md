# TODO

Working list of things we owe the codebase. Scope and decisions live in [`docs/PRD.md`](docs/PRD.md) — this file only tracks the debt we accepted knowingly.

## Lint debt

Ultracite's presets are on and the deviation list is deliberately temporary. Two review rounds are due once P1/P2 have reworked the inherited plugins:

- [ ] **Review every `oxlint-disable` comment.** Each one is a scoped exception with a written reason. Re-check whether the disable is still needed, or whether the code can be fixed to satisfy the rule. Find them with `grep -rn 'oxlint-disable' src tools vite-plugins *.ts`.
- [ ] **Review the deviation list in `oxlint.config.ts`.** It carries 117 rules that Ultracite enables and this tree currently violates (~2000 findings), because the plugins kept for reference (§R5/Q2) are still music-era code. An entry should disappear when the code it covers is reworked: fix the findings, then delete the entry. Re-measure by flipping the value back to `'error'` and running `pnpm exec ultracite check`.

## Dependencies pinned behind an API change

These four are held at the version the current code is written against. Each one belongs to a plugin that P1/P2 rebuilds, so the migration is deliberately not done yet — the entry goes away with the rewrite:

- [ ] `bgutils-js` 3.2.0 (v4 splits BotGuard into subpath exports: `BotGuardClient` + `WebPoMinter`) — downloader, PO-token flow.
- [ ] `@ffmpeg.wasm/core-mt` / `@ffmpeg.wasm/main` 0.12.0 (0.13 replaces `createFFmpeg()` with `FFmpeg.create()` and a different progress API) — downloader, audio conversion.
- [ ] `solid-floating-ui` 0.3.1 (1.0 replaces `useFloating(anchor, floating, options)` with a single options object) — in-app-menu panels.
- [ ] `electron-vite` 6.0.0-beta.1: 6.0.0 stable fails to load the project tsconfig ("Failed to load tsconfig .../@electron-toolkit/tsconfig/tsconfig.node.json: Tsconfig not found"), which breaks every build. Retry the bump when upstream fixes it; `tsconfig.json` no longer extends anything in node_modules, so the toolkit package is not needed for that any more.
