# TODO

Working list of things we owe the codebase. Scope and decisions live in [`docs/PRD.md`](docs/PRD.md) — this file only tracks the debt we accepted knowingly.

## Lint debt

Ultracite's presets are on and the deviation list is deliberately temporary. Two review rounds are due once P1/P2 have reworked the inherited plugins:

- [ ] **Review every `oxlint-disable` comment.** Each one is a scoped exception with a written reason. Re-check whether the disable is still needed, or whether the code can be fixed to satisfy the rule. Find them with `grep -rn 'oxlint-disable' src tools vite-plugins *.ts`.
- [ ] **Review the deviation list in `oxlint.config.ts`.** It carries **105 rules** that Ultracite enables and this tree currently violates (**~1775 findings**), because the plugins kept for reference (§R5/Q2) are still music-era code. An entry should disappear when the code it covers is reworked: fix the findings, then delete the entry. Re-measure by flipping the value back to `'error'` and running `pnpm exec ultracite check`. Last re-measured in rev 13, when deleting seven plugins removed 12 entries and corrected 69 counts — the numbers had drifted for two reasons worth remembering: they predate `options.typeAware`, and the type-aware rules had _grown_ (e.g. `promise-function-async` 13 → 91) while the plain ones shrank.

## P1 — the player bridge (what it left behind)

`video-info` / `video-controls` retired the music-era providers. Each of these was watched during the rework and deliberately left for the plugin or phase that owns it:

- [ ] **The page's audio graph is gone.** The inherited entry built an `AudioContext` + `MediaElementSource` for the page's `<video>` on every session and announced it as `watchdeck:audio-can-play`. Routing cross-origin media through Web Audio is a good way to silence playback, and the four plugins that listened (`visualizer`, `equalizer`, `custom-output-device`, `skip-silences`) are dormant, so nothing is created any more. Rebuild it as a per-plugin opt-in when the first of those is reworked.
- [ ] **`MusicPlayer` (`src/types/music-player.ts`) still backs the plugin API** (`onPlayerApiReady`): eight plugins implement that hook against the wide inherited type (`custom-output-device`, `disable-autoplay`, `downloader`, `picture-in-picture`, `precise-volume`, `sponsorblock`, `watch-later`), while the app's own code now uses `YouTubePlayer` (`src/types/youtube-player.ts`). Shrink the plugin-facing type as each plugin is reworked (§R5), and delete the type files that nothing imports any more with it: `datahost-get-state.ts`, `queue.ts`, `search-box-element.ts`, `music-player-app-element.ts`, `yt-web-components.d.ts`.
- [ ] **`providers/dom-elements.ts` is YouTube Music's menu-popup selector** (`getSongMenu`), used by the downloader and picture-in-picture renderers to add buttons to the site's menu. Delete it with the rework that re-hosts those buttons.
- [ ] **Downloader**: titles and channels are no longer run through `cleanupName` (the music suffix stripper), and `CustomSongInfo` is now a `Pick<VideoInfo, ...>` instead of the old song shape. Its YouTube rework (§R5) owns the rest.
- [ ] **api-server**: routes for features YouTube has no equivalent for (queue manipulation, shuffle, repeat, like/dislike, the player's fullscreen button, the site's search box) are gone, and `/fullscreen` now means the _window_. The paths that remain keep their historical `/api/v1/song-info` names; rename them with the plugin's rework if it ships.
- [ ] **The idle-timer hack is gone.** The inherited entry set `window._lact` every 15 minutes to suppress YouTube Music's "are you still there?" prompt. It was never verified against youtube.com's own "Video paused. Continue watching?" dialog; if that dialog turns up in use, the fix belongs next to the autoplay guard.
- [x] ~~**MPRIS absolute seek** (`playerctl position <µs>`) does nothing~~ — **stale, and measured away in rev 13.** With the shortcuts plugin on, `playerctl --player=watchdeck position 60` moved a video to 61 s, `position 15+` moved it 15 s on, `position 5-` moved it back, and play/pause/next/volume all worked. The track-id guard was fine; what was actually wrong is that the player announced itself as `org.mpris.MediaPlayer2.Watchdeck`, so `playerctl --player=watchdeck` found nothing at all — the bus name is the on-disk identity now (`watchdeck`), which is also what a desktop matches against `watchdeck.desktop`.
- [ ] **The test-only sandbox configuration cannot load a page.** `NODE_ENV=test` turns on `webPreferences.sandbox` (`src/index.ts`), and with it a launched window stays `loading: true` with an empty URL for as long as you watch it — measured with Playwright against this app, both with and without `--no-sandbox` on the command line — while the configuration the app ships (`sandbox: false`) loads the site at once. `tests/index.test.js` therefore launches the shipping configuration, and the smoke test asserts the page instead of skipping it. Before flipping that switch for real (PRD §3.3 wants sandboxing, with "moving privileged work to main"), find out what a sandboxed renderer is missing here.

## Watch Later (found while chasing a save that never landed)

The refused-write bug that prompted the search is fixed (the session re-reads the cookie jar and retries once, and `edit_playlist`'s `STATUS_FAILED` is a failure). These two were found on the way and are not fixed:

- [ ] **A full walk can sweep away a save that happened during that walk.** `runSync` hands the walk `new Set(mutatedDuringWalk)` — a copy taken _before_ the walk starts — while the walk decides what is missing at the _end_. A video the user saves while the walk is running is in neither the seen set nor the protected set, so `softRemoveMissing` marks it removed: the server has it, the mirror says it does not, and the button offers to save what is already saved. Seen in the app's own database on 2026-10-17: three app-added entries all carry the same removal timestamp (17:01:12.954 — one sweep), and one of them was added again by hand two days later. Handing the walk the live set instead of a copy looks like the fix; the test that pins it is "an add during a walk survives its sweep".

- [ ] **Nothing in the UI says "signed out".** `WatchLaterState.needsAuth` is set by the backend and reaches the renderer, but no surface reads it: with no usable session the buttons simply stay unsaved and an add answers `not-signed-in`. That is the state the app ran in for sixteen minutes on 2026-10-19 while the page looked signed in — the one line the toolbar was missing. (`docs/PRD.md` §4.2 now records what a stale cookie looks like from the API side.)

## Dependencies pinned behind an API change

These four are held at the version the current code is written against. Each one belongs to a plugin that P1/P2 rebuilds, so the migration is deliberately not done yet — the entry goes away with the rewrite:

- [ ] `bgutils-js` 3.2.0 (v4 splits BotGuard into subpath exports: `BotGuardClient` + `WebPoMinter`) — downloader, PO-token flow.
- [ ] `@ffmpeg.wasm/core-mt` / `@ffmpeg.wasm/main` 0.12.0 (0.13 replaces `createFFmpeg()` with `FFmpeg.create()` and a different progress API) — downloader, audio conversion.
- [ ] `solid-floating-ui` 0.3.1 (1.0 replaces `useFloating(anchor, floating, options)` with a single options object) — in-app-menu panels.
- [ ] `electron-vite` 6.0.0-beta.1: 6.0.0 stable fails to load the project tsconfig ("Failed to load tsconfig .../@electron-toolkit/tsconfig/tsconfig.node.json: Tsconfig not found"), which breaks every build. Retry the bump when upstream fixes it; `tsconfig.json` no longer extends anything in node_modules, so the toolkit package is not needed for that any more.

## Packaging

- [x] ~~**An AppImage**~~ — **done (rev 13).** `pnpm dist:linux:appimage` builds `pack/Watchdeck-0.1.0.AppImage` (131 MB) and it was verified on this machine: the window's class is `watchdeck` (matching the desktop entry's `StartupWMClass`), the site loads, the page half runs (`customElements.get("wd-trans")` answers), plugins load, and `--remote-debugging-port` works from inside the AppImage. The artifact is gitignored; nothing is installed by it.

- [ ] **The AppImage's desktop entry passes `--no-sandbox`, and that is electron-builder's default, not a decision.** It is there because the bundled `chrome-sandbox` helper cannot be setuid inside a squashfs mount. `AppRun` already probes `unshare -Ur true` and adds the flag itself when user namespaces are unavailable, so on a machine like this one the app _can_ run sandboxed when started from a terminal — but a launcher's click always passes the flag. Dropping it means overriding the generated `Exec`, which electron-builder does not expose cleanly; worth revisiting together with the sandbox refactor in §3.3.

- [ ] **Releases are manual and none has been cut.** Publishing means a GitHub release with the AppImage attached (and re-enabling the parked workflows for the other platforms, which need signing identities). Decide whether the AppImage is the only artifact for now.

## Diagnostics

- [ ] **The shortcuts plugin's two settings have no test that clicks the prompt.** The native keybind prompt (`custom-electron-prompt`) cannot be driven from a harness, so what is covered is the decision it feeds: `mappingFromPrompt` is unit-tested (`src/plugins/shortcuts/tests/shortcuts.test.ts`), and the rest was checked live while the port landed — registration from config, the release of the old accelerators on a config change (with another plugin's shortcut left alone), a local chord pausing a playing video, and MPRIS answering `playerctl`. Re-running that check means rebuilding the throwaway scripts; the recipe is in the commit that ported the plugin.

- [ ] **MPRIS has no teardown.** `@jellybrick/mpris-service` keeps its bus connection private, so disabling the shortcuts plugin stops the metadata updates but the `org.mpris.MediaPlayer2.watchdeck` name stays until the app exits. Worth revisiting if the library grows a `release()`.

- [ ] **`tools/page-console-check.mjs` has no counterpart in `pnpm test`, and that is a gap.** It launches the built app, records the page's console and every script injected into it, and answers RED/GREEN for `Maximum call stack size exceeded` — it is how the do-not-track scriptlet recursion was found and how the fix is checked. It is not in the suite because it needs the network (the blocklists), a window that actually renders, and about ninety seconds. **The cheap seam does not exist**: the behaviour that matters is "the app never asks the engine for injection rules", and that lives in an Electron-only path (`@ghostery/adblocker-electron`'s cosmetic-filter handler) whose only observable effect is JavaScript arriving in a real page. A unit test on a wrapper function there would pass whether or not the engine is asked. If a networked CI job ever exists, this belongs in it.

## Environment notes (this workspace, not the code)

- [ ] **The app's page only renders while its window has focus.** YouTube's UI is rAF-driven, and `requestAnimationFrame` never fires while the window sits in the background (measured: 0 frames in 3s, while `setInterval` still runs and `document.hasFocus()` reports true after `Page.bringToFront`). The page then stays blank or on its skeleton with its JS loaded and its title set, which is easy to misread as the site being down, as throttling, or as a plugin bug. `Page.bringToFront`, `Page.startScreencast` and `Page.captureScreenshot` do not bring the frames back, and screenshots time out until they are there. Any visual check has to start with the window in the foreground.

  **`--disable-gpu` is not a safe default for a check.** With it the page loads and answers `executeJavaScript`, but nothing renders: measured with `tools/page-console-check.mjs`, 0 frames per second and no feed cards, while the same app launched with the GPU gives 62 frames per second. A page that never renders never runs YouTube's own rendering path, so a check can come back green for the wrong reason — which is exactly what happened while bisecting the scriptlet recursion (the two "clean" halves of the plugin set were both runs where nothing rendered).

  **The same session never shows the window at all** (measured while checking the SponsorBlock consent step): the page loads (`isLoading: false`, `https://www.youtube.com/`), the title is set, and `win.isVisible()` stays `false` for as long as you watch it - `ready-to-show` needs that paint, so the app's own `win.show()` never runs. Anything that waits for the window to be visible (a dialog that must not sit in front of a hidden window) therefore never happens in a harness run, which is why the consent step is checked through the plugin's own menu item and the ten-second fallback rather than through the window showing.

- [ ] **`pnpm test` cannot attach to the page without a window manager** (this sandbox): `firstWindow()` never resolves — for this app _and_ for the commit before it. The window is created and titled correctly, which the launch test asserts. The page load assertion is `test.fixme` in `tests/index.test.js`; drop the `.fixme` where `pnpm dev` shows the site (a real desktop, or xvfb in CI).

- [ ] **The CDP port has one owner, and the app keeps to 9223.** `pnpm dev:debug` asks for 9223 so it never competes with a Chrome on 9222 (the default browser URL of the Chrome DevTools MCP); a dedicated MCP entry points at the app's port. Two processes cannot share a port, and Chromium does not report a failed `--remote-debugging-port` bind — the app starts without an endpoint while the other process answers, which looks like a working setup until the tools drive the wrong window. The app now says which case it is at startup (`remote debugging ready` versus `port … answers, but not for this app`).

- [ ] **Killing a running app needs the right name, and it differs by build**: only the packaged app renames its process, so `pkill -x watchdeck` works there; a `pnpm dev` instance is still called `electron` (`pkill -x watchdeck` silently does nothing to it — check `/proc/<pid>/comm` if unsure). `pkill -x electron` is too broad, and `pkill -f "electron ."` can match the shell you are typing in, so kill the dev instance by pid or with `pkill -f "[e]lectron/dist/electron [.]"`. A leftover instance holds the CDP port and the single-instance lock, which makes the next launch fail quietly (and makes `pnpm test` fail in `launchApp`).

Resolved, and worth remembering:

- A `pnpm dev` warning about a missing tsconfig base file came from the **primary checkout** above this worktree (esbuild resolved `../../../../tsconfig.json`), not from this tree; updating that checkout removed it.
- The app's userData directory is the lowercase `watchdeck` on Linux now (see `src/app-identity.ts`), matching the app id, the icon and the window class instead of a separate capitalised directory.
