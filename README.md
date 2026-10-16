<div align="center">

# Watchdeck

**An unofficial desktop client for YouTube.**

The site runs in a native Electron window; a plugin system injects the behaviour we want on top of
it — Watch Later tooling, SponsorBlock, autoplay control, mouse gestures.

</div>

> [!IMPORTANT]
> **No affiliation.** Watchdeck is not affiliated with, authorized by, endorsed by, or in any way
> officially connected with Google LLC or YouTube. "Google" and "YouTube" are trademarks of their
> respective owners, used here only to identify the service the application talks to.
>
> **Liability.** This application is provided "AS IS"; you use it at your own risk and you are
> responsible for how you use it.

## Status

Watchdeck is at the start of its life: the repository reset is landing and **there is no release
build yet**. [`docs/PRD.md`](docs/PRD.md) is the source of truth for scope, verified research,
architecture decisions and the open questions — read it first.

What v1 is meant to be:

- **Watch Later, indexed locally** — a SQLite mirror of `playlist?list=WL` with full-text search,
  filters and grouping, plus watch-progress classification that merges YouTube's own resume
  percentage with what the app itself has seen.
- **Quick add** — add or remove a video from Watch Later right on its thumbnail.
- **SponsorBlock** — segment skipping, by loading SponsorBlock's own release at runtime.
- **Autoplay off** — enforced, not just remembered.
- **Mouse gestures** — right-drag for volume, seeking and playback speed.
- **Plugins** — the extension point for everything else; see [`docs/plugins.md`](docs/plugins.md).

## Dev

```bash
git clone https://github.com/erikenz/watchdeck
cd watchdeck
pnpm install --frozen-lockfile
pnpm dev
```

[Devcontainers](https://containers.dev/) are supported (see `.devcontainer/`); note that GUI
applications may not work inside some Linux containers.

## Checks

```bash
pnpm check   # lint + format check + typecheck
pnpm build   # electron-vite build
pnpm test    # Playwright smoke test (launches the app and checks the loaded URL)
```

## Build

Installers are produced with [electron-builder](https://github.com/electron-userland/electron-builder):

- `pnpm dist:linux` — Linux (amd64), plus `dist:linux:deb-arm64` / `dist:linux:rpm-arm64`
- `pnpm dist:mac` / `pnpm dist:mac:arm64` — macOS
- `pnpm dist:win` — Windows

## Production preview

```bash
pnpm start
```

## License

MIT © 2026 erikenz. Watchdeck started from an MIT-licensed project; the attribution for the code it
inherited is kept in [NOTICE](NOTICE) and `license`.
