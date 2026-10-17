# Plugin inventory — what is worth porting to youtube.com

`src/plugins` holds 27 directories. Four of them run today (the app's log is the ground truth):
**watch-later**, **sponsorblock**, **disable-autoplay**, **gestures**. The rest are inherited from
the YouTube Music app this project started as, and the linter's deviation list in
`oxlint.config.ts` (117 rules, ~2000 findings) exists mostly to tolerate them.

This is the survey the owner asked for: for each one, what it does, whether it is worth porting to
`www.youtube.com`, and why. "Music-era" means it is written against the retired music player
(`MusicPlayer`, `song-info`/`song-controls`, `providers/dom-elements`, `music.youtube.com` URLs).

## Worth porting or tweaking

| Plugin | Size | What it does | Verdict |
|---|---|---|---|
| **downloader** | 2281 L | Downloads media, with a format menu | **Port.** Already half-way: it reads video titles and `VideoInfo` instead of the song shape and no longer strips music suffixes. Needs the remaining YouTube rework — the format list, the filename, and where its buttons live now that the site's song menu is gone. |
| **discord** | 879 L | Discord Rich Presence for what you are playing | **Port.** Reads the new `video-info` providers already; the work is the wording ("watching") and its menu. |
| **shortcuts** | 431 L | Local shortcuts **and MPRIS** | **Tweak + enable.** `mpris.ts` is already written against `getVideoControls`, which is why media keys and the desktop's own player controls worked when this plugin was on. Decide the shortcut set (the app menu deliberately keeps only media keys, §R6) and ship it. |
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
| **do-not-track** | 493 L | A real tracker/ad blocker: `@ghostery/adblocker-electron` in the main process, selectable blocklists (`InPlayer` and friends), optional extra uBlock-style filter lists, cached engine, plus page-side injectors. Not music-specific at all. | **Fixed and verified (rev 12).** The default mode was the music-era one; it now defaults to the blocklist engine, and with that it loads 12 lists into the session and blocks YouTube's own telemetry (`/api/stats/qoe`, `/api/stats/playback`, `/ptracking`). It also says what it does now - it used to log nothing at all, which is why "it does not seem to block anything" had no answer. Off by default; the `InPlayer` mode is kept only as history. |
| **custom-output-device** | 141 L | A menu that picks which audio output the player uses, remembered in config. | **Fixed (rev 12).** It used to route an `AudioContext` - the graph P1 removed - so it had nothing to act on. It now calls `HTMLMediaElement.setSinkId` on the page's own `<video>`; verified in the app's page that the method exists and that the device list arrives with labels. No restart needed any more (the menu itself is a native prompt, so its final click is a human check). Off by default. |
| **performance-improvement** | — | **Deleted (rev 12).** The owner asked whether its CPU tamer helps; the honest answer is that it targets YouTube *Music*'s DOM (`rm3` hooks `__shady_native_textContent`, which does not exist here) and the measurement could not be completed fairly - the app's session was serving empty feeds all afternoon, and a first sample leaned worse, not better (task time 9.6 s vs 6.1 s on the same page, confounded by a cold load). Deleted on "no evidence it helps". |

## Delete (music-era, or YouTube already has it)

| Plugin | Size | Why it goes |
|---|---|---|
| playback-speed | 237 L | YouTube's own speed control. |
| precise-volume | 561 L | YouTube's own volume, plus the gestures plugin. |
| crossfade | 710 L | Gapless music playback; a video site has no equivalent. |
| exponential-volume | 67 L | Music-player volume curve. |
| custom-output-device | 141 L | Music-player audio routing. |
| visualizer | 552 L | Music-player visualizer. |
| in-app-menu | 1555 L | A DOM menu bar; the app has a native menu. |
| navigation | 80 L | Music-era navigation tweaks. |
| do-not-track | — | *Kept at the owner's request - see below.* |
| custom-output-device | — | *Kept at the owner's request - see below.* |
| performance-improvement | — | *Kept at the owner's request - see below.* |
| picture-in-picture | 553 L | The site's own PiP, plus a menu item. |
| taskbar-mediacontrol | 107 L | Windows-only; the Linux equivalent is MPRIS (above). |
| touchbar | 103 L | macOS-only, and this app is Linux-first. |
| auth-proxy-adapter | 376 L | Exists to feed the api-server's auth. |

`src/plugins/utils/` is **not** a plugin: it is a shared helper module imported by `downloader`,
`picture-in-picture`, `playback-speed`, `crossfade` and `src/index.ts`. It stays (and shrinks with
whoever keeps using it).

## What deleting buys

- The deviation list in `oxlint.config.ts` can shrink to the rules this code actually needs, which
turns the `oxlint-disable` review in `TODO.md` from a survey into a short list.
- Smaller build, fewer dormant entry points to reason about, and one obvious answer to "does this
app do X?" — today it is "there is a plugin for that, but it does not work here".
- It does not change what runs: those plugins are off today, and the four that run are ours.

## Order I would do it in

1. Delete the music-era list above in one commit (nothing imports it except `plugins/utils`).
2. Re-measure the lint deviation list with those entry points gone.
3. Port `shortcuts` (MPRIS + media keys) and `discord` - both are small and land in the app's own
   surface rather than in the page.
4. `downloader` gets its own phase: it is the one that needs real work, and the one you named.
5. Decide the optional three (`equalizer`, `ambient-mode`, `notifications`), the three kept at your
   request, and the audio-graph question that `skip-silences` depends on.
