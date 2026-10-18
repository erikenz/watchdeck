/**
 * Registering the plugin's shortcuts, and taking them back again (docs/PRD.md §R5).
 *
 * Two things this file is careful about, both learned from the inherited version:
 *
 * 1. **It only unregisters its own.** `globalShortcut.unregisterAll()` would also drop the volume
 *    keys another plugin registered, so every accelerator this plugin registers is remembered and
 *    taken back by name.
 * 2. **A shortcut the desktop already owns is reported.** `globalShortcut.register` answers
 *    `false` (or throws on a malformed accelerator) and the inherited code ignored both, which is
 *    how a keybind ends up silently doing nothing.
 */
import { globalShortcut } from "electron";
import type { BrowserWindow } from "electron";
import is from "electron-is";
import {
  register as registerInWindow,
  unregister as unregisterInWindow,
} from "electron-localshortcut";

import { getVideoControls } from "@/providers/video-controls";
import type { BackendContext } from "@/types/contexts";
import { LoggerPrefix } from "@/utils";

import type { ShortcutsPluginConfig } from "./index";
import { registerMPRIS } from "./mpris";
import { shortcutsToRegister } from "./shortcuts";

/** The media keys, for the `overrideMediaKeys` switch. */
const MEDIA_KEYS = {
  next: "MediaNextTrack",
  playPause: "MediaPlayPause",
  previous: "MediaPreviousTrack",
} as const;

/** What this plugin registered, so a config change takes back its own and nobody else's. */
const ownGlobal = new Set<string>();
const ownLocal = new Set<string>();

let pluginWindow: BrowserWindow | null = null;

const warn = (...message: unknown[]) => console.warn(LoggerPrefix, ...message);

const registerGlobal = (accelerator: string, run: () => void) => {
  try {
    if (globalShortcut.register(accelerator, run)) {
      ownGlobal.add(accelerator);
      return;
    }

    warn(`shortcuts: ${accelerator} is taken by another application`);
  } catch (error) {
    warn(`shortcuts: ${accelerator} is not a usable accelerator`, error);
  }
};

const registerLocally = (
  win: BrowserWindow,
  accelerator: string,
  run: () => void
) => {
  try {
    registerInWindow(win, accelerator, run);
    ownLocal.add(accelerator);
  } catch (error) {
    warn(`shortcuts: ${accelerator} is not a usable accelerator`, error);
  }
};

const releaseAll = (win: BrowserWindow) => {
  for (const accelerator of ownGlobal) {
    globalShortcut.unregister(accelerator);
  }

  ownGlobal.clear();

  for (const accelerator of ownLocal) {
    unregisterInWindow(win, accelerator);
  }

  ownLocal.clear();
};

/** Registers what a config asks for, after taking back whatever the last one asked for. */
const apply = (config: ShortcutsPluginConfig, win: BrowserWindow) => {
  releaseAll(win);

  const controls = getVideoControls(win);

  if (config.overrideMediaKeys) {
    registerGlobal(MEDIA_KEYS.playPause, controls.playPause);
    registerGlobal(MEDIA_KEYS.next, controls.next);
    registerGlobal(MEDIA_KEYS.previous, controls.previous);
  }

  for (const { accelerator, action } of shortcutsToRegister(config.global)) {
    registerGlobal(accelerator, controls[action]);
  }

  for (const { accelerator, action } of shortcutsToRegister(config.local)) {
    registerLocally(win, accelerator, controls[action]);
  }
};

export const onMainLoad = async ({
  getConfig,
  window,
}: BackendContext<ShortcutsPluginConfig>) => {
  pluginWindow = window;
  apply(await getConfig(), window);

  // Once per window: MPRIS is the app's media keys on Linux, and the desktop keeps the bus name for
  // as long as the app runs (the library has no teardown, see `./mpris.ts`).
  if (is.linux()) {
    registerMPRIS(window);
  }
};

/** A keybind change takes effect at once - nothing here needs a restart. */
export const onConfigChange = (config: ShortcutsPluginConfig) => {
  if (!pluginWindow || pluginWindow.isDestroyed()) {
    return;
  }

  apply(config, pluginWindow);
};

export const onMainStop = ({
  window,
}: BackendContext<ShortcutsPluginConfig>) => {
  releaseAll(window);
  pluginWindow = null;
};
