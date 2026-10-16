# Writing a Watchdeck plugin

Plugins are the extension point of the app: the shell is deliberately small, and
everything a user might want on top of it — player behaviour, page tweaks,
integrations — belongs in a plugin. This guide covers the API the framework gives
you and the conventions a plugin in this repository has to follow.

## Where a plugin lives

```
src/plugins/<name>/index.ts     # a folder, when the plugin has more than one file
src/plugins/<name>.ts           # a single file, for small plugins
```

The folder (or file) name is the plugin id. It is what config keys, i18n keys,
menu ids and the enable/disable state are keyed by, so treat it as stable.
`src/plugins/utils/` is reserved for shared helpers and is not a plugin.

Any file matching those paths is picked up at build time — there is no registry to
edit. `vite-plugins/plugin-importer.mts` generates the `virtual:plugins` module
from the folder listing, and `vite-plugins/plugin-loader.mts` strips the contexts
a given bundle does not need (the main process never ships renderer code, and the
page never ships backend code).

## The shape of a plugin

```ts
import { createPlugin } from "@/utils";

export default createPlugin({
  name: () => "My plugin",           // shown in the menu, wrap in t() to translate
  description: () => "What it does",
  addedVersion: "0.2.0",             // optional, shown in the plugin list
  restartNeeded: false,              // true when toggling it needs a restart
  platform: Platform.Linux,          // optional bitmask, see src/types/plugins.ts
  config: {
    enabled: false,                  // every plugin config has this
  },
  stylesheets: [],                   // CSS this plugin injects, see below
  menu: async ({ getConfig, setConfig, window, refresh }) => [
    // Electron MenuItemConstructorOptions[]
  ],
  backend: { /* main process */ },
  preload: { /* page context, before the page loads */ },
  renderer: { /* page main world */ },
});
```

Each lifecycle gets a `start`, an optional `stop`, and an optional
`onConfigChange`; the renderer lifecycle additionally has `onPlayerApiReady(api,
context)`, which runs once the player is ready. The context objects are typed in
`src/types/contexts.ts`:

- **backend** — `{ window, ipc, getConfig, setConfig }`. Runs in the main process:
  use it for Node work (files, network, native APIs) and for `ipc.handle(...)`
  channels the renderer calls.
- **preload** — `{ getConfig, setConfig }`. Runs in the page's preload script with
  Node access, before the page loads; useful for `window` hooks.
- **renderer** — `{ ipc, getConfig, setConfig }` plus the player API. Runs in the
  page's main world: DOM, player control, injected UI.

State that survives a restart belongs in `config`; state that belongs to a session
belongs on the lifecycle object itself (`this` inside the hooks).

## Config

`config` holds the defaults. `getConfig()` returns the stored config merged over
them; `setConfig({ ... })` writes a partial update back. Config is namespaced
under `plugins.<plugin id>` in the store, and `restartNeeded: true` asks the app
to tell the user to restart after a change.

Reads that are not from inside a plugin use the same store:

```ts
import { config } from "@/config";

config.get("plugins.my-plugin.someOption");
await config.plugins.isEnabled("my-plugin");
```

## Talking between the parts

The renderer reaches the backend over Electron IPC. Use the app's prefix for every
channel — `watchdeck:` — and namespace by plugin:

```ts
// backend
ipc.handle("watchdeck:my-plugin-fetch", async (_event, id: string) => ...);

// renderer
const result = await context.ipc.invoke("watchdeck:my-plugin-fetch", id);
```

The same prefix rule applies to anything the plugin puts in the page: DOM ids are
`wd-*` (for example `wd-my-plugin-panel`), and custom elements are registered
through the helper in `src/utils/custom-element.ts`. `<wd-trans key="…">` renders
an i18n string inside injected HTML.

## Stylesheets

Plugin CSS is injected as a constructed stylesheet, scoped to the plugin so it can
be removed when the plugin is disabled:

```ts
import style from "./style.css?inline";

export default createPlugin({
  /* … */
  stylesheets: [style],
});
```

## Translations

Plugin strings live in `src/i18n/resources/<locale>.json` under
`plugins.<plugin id>.*`. Use `t()` from `@/i18n` in the plugin's own code and
`wd-trans` in injected markup. Add the key to `en.json` at least; other locales
follow through translations.

## Player API

The renderer lifecycle receives the page's player object (`#movie_player`) and a
typed wrapper (`src/types/music-player.ts`): `getPlayerResponse()`,
`getVideoData()`, `playVideo()`/`pauseVideo()`, `seekTo()`, `getVolume()`,
`setVolume()`, `getProgressState()`, and the `videodatachange` event. Prefer the
player API over scraping the DOM; where a DOM read is unavoidable, keep the
selectors in one place in the plugin so a page change is a one-line fix.

Volume changes are an example of doing it the way the page expects: set
`video.volume` and dispatch a `volumechange` event, so the site's own UI and mute
state stay in sync.

## Conventions

- **Formatting and linting**: `pnpm format` (Ultracite/Oxfmt) and `pnpm check`
  before opening a PR. Do not add `oxlint-disable` comments unless the reason is
  written down next to them — see `TODO.md` for the review round they are queued
  for.
- **Naming**: no legacy prefixes from the projects Watchdeck inherited from.
  Channels are `watchdeck:*`, DOM ids and elements are `wd-*`.
- **Third-party code**: do not vendor GPL or otherwise incompatible code into the
  repository. SponsorBlock, for example, is downloaded from its own release at
  runtime and loaded as an extension, with a small compatibility shim — see the
  plugin for the pattern.
- **Scope**: a plugin should be disableable without breaking the app. Guard page
  work behind the `enabled` config, and clean up in `stop`.

## Checklist for a new plugin

1. `src/plugins/<id>/index.ts` with a `createPlugin({ … })` default export.
2. `config.enabled: false` unless it should be on by default.
3. `name`/`description` through `t()`, keys added to `src/i18n/resources/en.json`.
4. Menu entries if it needs settings; `restartNeeded` only if it really does.
5. `platform` if it only works on some systems.
6. `pnpm check` and `pnpm build` are green; the plugin loads, can be disabled, and
   leaves nothing behind when it is.
