import { join } from "node:path";

import { app } from "electron";

/**
 * The app keeps two identities apart on purpose.
 *
 * - **Display name** — "Watchdeck": window title, tray tooltip, dialogs, menus.
 * - **On-disk identity** — `watchdeck`: lowercase, filesystem-safe, stable. On
 *   case-sensitive filesystems "Watchdeck" and "watchdeck" are two different
 *   applications to scripts, backup tools and `$XDG_CONFIG_HOME/*` globs, and a rename
 *   later would orphan the user's data (the previous project's data already sits under
 *   `~/.config/watchdeck`, and window-manager rules there match the class `watchdeck`).
 *
 * This has to run before anything reads a path — the config store does that at import
 * time — so it lives in its own module and is imported first in `src/index.ts`.
 */
export const ON_DISK_IDENTITY = "watchdeck";

if (process.platform === "linux") {
  // $XDG_CONFIG_HOME/watchdeck; without this Electron would use `productName`
  // ("Watchdeck") and the two would drift apart.
  app.setPath("userData", join(app.getPath("appData"), ON_DISK_IDENTITY));

  // WM_CLASS on X11 and the app_id on Wayland: what window-manager rules match on. The
  // desktop entry points here through `StartupWMClass` in electron-builder.yml, and the
  // installed icon shares the name, which is how a launcher finds it.
  app.setName(ON_DISK_IDENTITY);
  app.commandLine.appendSwitch("class", ON_DISK_IDENTITY);
}
