# TODO

Working list of things we owe the codebase. Scope and decisions live in [`docs/PRD.md`](docs/PRD.md) — this file only tracks the debt we accepted knowingly.

## Lint debt

Ultracite's presets are on and the deviation list is deliberately temporary. Two review rounds are due once P1/P2 have reworked the inherited plugins:

- [ ] **Review every `oxlint-disable` comment.** Each one is a scoped exception with a written reason. Re-check whether the disable is still needed, or whether the code can be fixed to satisfy the rule. Find them with `grep -rn 'oxlint-disable' src tools vite-plugins *.ts`.
- [ ] **Review the deviation list in `oxlint.config.ts`.** It carries 117 rules that Ultracite enables and this tree currently violates (~2000 findings), because the plugins kept for reference (§R5/Q2) are still music-era code. An entry should disappear when the code it covers is reworked: fix the findings, then delete the entry. Re-measure by flipping the value back to `'error'` and running `pnpm exec ultracite check`.

## P1 — the player bridge (what it left behind)

`video-info` / `video-controls` retired the music-era providers. Each of these was watched during
the rework and deliberately left for the plugin or phase that owns it:

- [ ] **The page's audio graph is gone.** The inherited entry built an `AudioContext` +
  `MediaElementSource` for the page's `<video>` on every session and announced it as
  `watchdeck:audio-can-play`. Routing cross-origin media through Web Audio is a good way to
  silence playback, and the four plugins that listened (`visualizer`, `equalizer`,
  `custom-output-device`, `skip-silences`) are dormant, so nothing is created any more. Rebuild it
  as a per-plugin opt-in when the first of those is reworked.
- [ ] **`MusicPlayer` (`src/types/music-player.ts`) still backs the plugin API**
  (`onPlayerApiReady`): twelve plugins implement that hook against the wide inherited type, while
  the app's own code now uses `YouTubePlayer` (`src/types/youtube-player.ts`). Shrink the
  plugin-facing type as each plugin is reworked (§R5), and delete the type files that nothing
  imports any more with it: `datahost-get-state.ts`, `queue.ts`, `search-box-element.ts`,
  `music-player-app-element.ts`, `yt-web-components.d.ts`.
- [ ] **`providers/dom-elements.ts` is YouTube Music's menu-popup selector** (`getSongMenu`), used
  by the downloader / picture-in-picture / playback-speed renderers to add buttons to the site's
  menu. Delete it with the rework that re-hosts those buttons.
- [ ] **Downloader**: titles and channels are no longer run through `cleanupName` (the music
  suffix stripper), and `CustomSongInfo` is now a `Pick<VideoInfo, ...>` instead of the old song
  shape. Its YouTube rework (§R5) owns the rest.
- [ ] **api-server**: routes for features YouTube has no equivalent for (queue manipulation,
  shuffle, repeat, like/dislike, the player's fullscreen button, the site's search box) are gone,
  and `/fullscreen` now means the *window*. The paths that remain keep their historical
  `/api/v1/song-info` names; rename them with the plugin's rework if it ships.
- [ ] **The idle-timer hack is gone.** The inherited entry set `window._lact` every 15 minutes to
  suppress YouTube Music's "are you still there?" prompt. It was never verified against
  youtube.com's own "Video paused. Continue watching?" dialog; if that dialog turns up in use, the
  fix belongs next to the autoplay guard.
- [ ] **MPRIS absolute seek** (`playerctl position <µs>`) does nothing: `shortcuts/mpris.ts` guards
  it on a track-id match that playerctl's `SetPosition` does not satisfy, while relative seek and
  play/pause/volume work. The plugin's rework owns it.

## Dependencies pinned behind an API change

These four are held at the version the current code is written against. Each one belongs to a plugin that P1/P2 rebuilds, so the migration is deliberately not done yet — the entry goes away with the rewrite:

- [ ] `bgutils-js` 3.2.0 (v4 splits BotGuard into subpath exports: `BotGuardClient` + `WebPoMinter`) — downloader, PO-token flow.
- [ ] `@ffmpeg.wasm/core-mt` / `@ffmpeg.wasm/main` 0.12.0 (0.13 replaces `createFFmpeg()` with `FFmpeg.create()` and a different progress API) — downloader, audio conversion.
- [ ] `solid-floating-ui` 0.3.1 (1.0 replaces `useFloating(anchor, floating, options)` with a single options object) — in-app-menu panels.
- [ ] `electron-vite` 6.0.0-beta.1: 6.0.0 stable fails to load the project tsconfig ("Failed to load tsconfig .../@electron-toolkit/tsconfig/tsconfig.node.json: Tsconfig not found"), which breaks every build. Retry the bump when upstream fixes it; `tsconfig.json` no longer extends anything in node_modules, so the toolkit package is not needed for that any more.

## Environment notes (this workspace, not the code)

- [ ] **The app's page only renders while its window has focus.** YouTube's UI is rAF-driven, and `requestAnimationFrame` never fires while the window sits in the background (measured: 0 frames in 3s, while `setInterval` still runs and `document.hasFocus()` reports true after `Page.bringToFront`). The page then stays blank or on its skeleton with its JS loaded and its title set, which is easy to misread as the site being down, as throttling, or as a plugin bug. `Page.bringToFront`, `Page.startScreencast` and `Page.captureScreenshot` do not bring the frames back, and screenshots time out until they are there. Any visual check has to start with the window in the foreground.

- [ ] **`pnpm test` cannot attach to the page without a window manager** (this sandbox): `firstWindow()` never resolves — for this app _and_ for the commit before it. The window is created and titled correctly, which the launch test asserts. The page load assertion is `test.fixme` in `tests/index.test.js`; drop the `.fixme` where `pnpm dev` shows the site (a real desktop, or xvfb in CI).

- [ ] **The CDP port has one owner, and the app keeps to 9223.** `pnpm dev:debug` asks for 9223 so it never competes with a Chrome on 9222 (the default browser URL of the Chrome DevTools MCP); a dedicated MCP entry points at the app's port. Two processes cannot share a port, and Chromium does not report a failed `--remote-debugging-port` bind — the app starts without an endpoint while the other process answers, which looks like a working setup until the tools drive the wrong window. The app now says which case it is at startup (`remote debugging ready` versus `port … answers, but not for this app`).

- [ ] **Killing a running app needs the right name, and it differs by build**: only the packaged app renames its process, so `pkill -x watchdeck` works there; a `pnpm dev` instance is still called `electron` (`pkill -x watchdeck` silently does nothing to it — check `/proc/<pid>/comm` if unsure). `pkill -x electron` is too broad, and `pkill -f "electron ."` can match the shell you are typing in, so kill the dev instance by pid or with `pkill -f "[e]lectron/dist/electron [.]"`. A leftover instance holds the CDP port and the single-instance lock, which makes the next launch fail quietly (and makes `pnpm test` fail in `launchApp`).

Resolved, and worth remembering:

- A `pnpm dev` warning about a missing tsconfig base file came from the **primary checkout** above this worktree (esbuild resolved `../../../../tsconfig.json`), not from this tree; updating that checkout removed it.
- The app's userData directory is the lowercase `watchdeck` on Linux now (see `src/app-identity.ts`), matching the app id, the icon and the window class instead of a separate capitalised directory.
