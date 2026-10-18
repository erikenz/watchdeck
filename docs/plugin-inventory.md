# Plugin inventory — what is worth porting to youtube.com

`src/plugins` holds **18 plugins** (plus `utils`, which is not one). Four of them run today (the app's log
is the ground truth): **watch-later**, **sponsorblock**, **disable-autoplay**, **gestures**. The rest are
inherited from the YouTube Music app this project started as, and the linter's deviation list in
`oxlint.config.ts` (**105 rules, ~1775 findings**, re-measured in rev 13) exists mostly to tolerate them.

This is the survey the owner asked for: for each one, what it does, whether it is worth porting to
`www.youtube.com`, and why. "Music-era" means it is written against the retired music player
(`MusicPlayer`, `song-info`/`song-controls`, `providers/dom-elements`, `music.youtube.com` URLs).

## Worth porting or tweaking

| Plugin | Size | What it does | Verdict |
|---|---|---|---|
| **downloader** | 2281 L | Downloads media, with a format menu | **Port.** Already half-way: it reads video titles and `VideoInfo` instead of the song shape and no longer strips music suffixes. Needs the remaining YouTube rework — the format list, the filename, and where its buttons live now that the site's song menu is gone. |
| **discord** | 879 L | Discord Rich Presence for what you are playing | **Port.** Reads the new `video-info` providers already; the work is the wording ("watching") and its menu. |
| **shortcuts** | 431 L | Local shortcuts **and MPRIS** | **Ported (rev 13).** Both keybind sets are configurable from the plugin's own menu (global ones work from any application, local ones while the window has focus), changes apply without a restart, and an accelerator the desktop already owns is reported instead of silently doing nothing. Two inherited defects went with it: the prompt saved the *old* mapping, so no keybind ever stuck, and the `local` set had no menu entry at all. MPRIS announces itself as `watchdeck` now, which is what `playerctl` and desktop panels look for. No keybinds ship as defaults - the menu is where they are chosen. |
| **api-server** | 1187 L | Local HTTP control | **Tweak, or delete.** Its YouTube-Music-only routes are already gone and `/fullscreen` means the window; what is left keeps historical `/api/v1/song-info` names. It is a listening socket, so it needs a security pass (bind address, token) before it ships. |
| **skip-silences** | 163 L | Skips silent stretches | **Port, after the audio graph.** Genuinely useful for talks and podcasts; it needs the per-plugin audio-graph opt-in that P1 removed (see `TODO.md`), so it is the natural first consumer of that work. |
| **notifications** | 644 L | Desktop notifications | **Tweak.** On music it announced the song; on YouTube the useful version is "a channel you follow posted", which is a different feature (and needs a feed to watch). Decide or drop. |
| **equalizer** | 106 L | Equalizer | **Optional.** Needs the same audio-graph opt-in; on a video site it is a niche want. |
| **ambient-mode** | 456 L | Blurred backdrop from the video | **Optional.** Pure look, no player coupling; cheap to port if you like the effect. |

## Kept at the owner's request (port candidates, not deletes)

These three were on the delete list and the owner asked for them to stay. What each one is, and what
porting it means:

| Plugin | Size | What it actually does | What porting it means |
|---|---|---|---|
| **do-not-track** | 493 L | A real tracker/ad blocker: `@ghostery/adblocker-electron` in the main process, selectable blocklists (`InPlayer` and friends), optional extra uBlock-style filter lists, cached engine, plus page-side injectors. Not music-specific at all. | **Fixed and verified (rev 12).** The default mode was the music-era one; it now defaults to the blocklist engine, and with that it loads 12 lists into the session and blocks YouTube's own telemetry (`/api/stats/qoe`, `/api/stats/playback`, `/ptracking`). It also says what it does now - it used to log nothing at all, which is why "it does not seem to block anything" had no answer. Off by default; the `InPlayer` mode is kept only as history. **Scriptlets are no longer injected (rev 13):** the lists ship `##+js(...)` rules - third-party JavaScript the library runs inside the page - and one of them recursed on youtube.com, three `RangeError: Maximum call stack size exceeded` per page load inside uBO's `proxyApplyFn` helper. Requests are still blocked and CSS hiding still applies; nothing from a third-party list executes in the page any more. `tools/page-console-check.mjs` is how that was measured, and how it would be caught again. |
| **custom-output-device** | 141 L | A menu that picks which audio output the player uses, remembered in config. | **Fixed (rev 12).** It used to route an `AudioContext` - the graph P1 removed - so it had nothing to act on. It now calls `HTMLMediaElement.setSinkId` on the page's own `<video>`; verified in the app's page that the method exists and that the device list arrives with labels. No restart needed any more (the menu itself is a native prompt, so its final click is a human check). Off by default. |
| **performance-improvement** | — | **Deleted (rev 12).** The owner asked whether its CPU tamer helps; the honest answer is that it targets YouTube *Music*'s DOM (`rm3` hooks `__shady_native_textContent`, which does not exist here) and the measurement could not be completed fairly - the app's session was serving empty feeds all afternoon, and a first sample leaned worse, not better (task time 9.6 s vs 6.1 s on the same page, confounded by a cold load). Deleted on "no evidence it helps". |

## Deleted (music-era, or YouTube already has it)

| Plugin | Size | Why it went |
|---|---|---|
| playback-speed | 237 L | YouTube's own speed control, and its slider lived in the retired music menu. **Deleted (rev 13).** |
| crossfade | 710 L | Gapless music playback; a video site has no equivalent. Took `howler` with it. **Deleted (rev 13).** |
| exponential-volume | 67 L | Music-player volume curve. **Deleted (rev 13).** |
| visualizer | 552 L | Music-player visuals, and it needs the audio graph P1 removed. Took `butterchurn`, `butterchurn-presets`, `vudio` and `@foobar404/wave` with it. **Deleted (rev 13).** |
| in-app-menu | 1555 L | A DOM menu bar for a menu the app already has natively; it was also the reason for `solid-floating-ui`, `solid-styled-components`, `solid-transition-group`, `@floating-ui/dom`, `@mdui/icons` and three `isEnabled("in-app-menu")` special cases. **Deleted (rev 13).** |
| navigation | 80 L | Back/forward buttons rendered into the music app's `#right-content`; the app's own Navigation menu and the site's own back button both exist. **Deleted (rev 13).** |
| auth-proxy-adapter | 376 L | Existed to feed the api-server's auth through a SOCKS proxy; `options.proxy` is the app's own setting. **Deleted (rev 13).** |
| performance-improvement | — | *Deleted (rev 12): no evidence it helps on this site.* |
| do-not-track | — | *Kept at the owner's request — see below.* |
| custom-output-device | — | *Kept at the owner's request — see below.* |

## Still on the list, waiting for the owner

These four are **not** dead code, which is why they survived the deletion. Each is a working feature; the
question is whether this app wants it:

| Plugin | Size | What it actually does | The question |
|---|---|---|---|
| precise-volume | 561 L | Configurable volume step (1 % instead of the site's 5 %), wheel-over-player volume, a volume HUD, system-wide volume keys, and a saved volume across sessions. Also patches `Element.prototype.addEventListener` while the page loads to stop the music app fighting it. | Gestures (right-drag, right-wheel) already covers the wheel and the HUD, and MPRIS would cover the desktop keys. The unique part is the **step size**. Delete, or keep the step size and drop the rest? |
| picture-in-picture | 553 L | **Window-level** PiP: shrinks the app window, keeps it on top, remembers position/size, hotkey. Its menu *button* targets the retired music menu, so that part needs rework. | A wrapper app has no browser PiP button, so this is the desktop miniplayer. Port the button, or delete? |
| taskbar-mediacontrol | 107 L | Windows taskbar media buttons. Reworked onto the new providers in P1, but `platform: Platform.Windows`. | Dead on this machine (Linux, MPRIS covers it); useful if Windows is ever packaged. Delete, or keep for that? |
| touchbar | 103 L | macOS Touch Bar. Also reworked onto the new providers; `platform: Platform.macOS`. | Same question, for macOS. |

`src/plugins/utils/` is **not** a plugin: it is a shared helper module imported by `downloader`,
`picture-in-picture` and `src/index.ts`. It stays (and shrinks with whoever keeps using it).

## What deleting bought (measured, rev 13)

- The injected page bundle **halved**: 2.70 MB → 1.35 MB (`dist/renderer/watchdeck.iife.js`).
- The main process went from 140 to **112** chunks, the preload from 408 kB to 401 kB.
- **11 dependencies** left `package.json` (plus one pnpm patch), all of them used only by the deleted
  plugins.
- The lint deviation list in `oxlint.config.ts` went from 117 rules / ~2008 findings to **105 / ~1775**, and
  **12 entries disappeared** because nothing in the tree violates them any more.
- It does not change what runs: those plugins were off, and the four that run are ours.

## Order I would do it in

1. ~~Delete the music-era list above in one commit~~ — **done (rev 13)**, for the seven that cannot work
   on this site; the four in the table above wait for the owner.
2. ~~Re-measure the lint deviation list with those entry points gone~~ — **done (rev 13)**.
3. Port `shortcuts` (MPRIS + media keys) and `discord` - both are small and land in the app's own
   surface rather than in the page. The owner wants the shortcuts configurable.
4. `downloader` gets its own phase: it is the one that needs real work, and the one you named.
5. Decide the optional three (`equalizer`, `ambient-mode`, `notifications`), the two kept at your
   request, the four above, and the audio-graph question that `skip-silences` depends on.
