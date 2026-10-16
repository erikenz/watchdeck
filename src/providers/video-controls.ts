import type { BrowserWindow } from "electron";

/** How far one volume step moves, on the site's own 0-100 scale. */
export const VOLUME_STEP = 5;

/**
 * A protocol URL or a query string hands arguments over as text, so a single string is as
 * valid here as a number or an argument list.
 */
type Args<T> = T | string | string[] | undefined;

const toNumber = (args: Args<number>): number | null => {
  const first = Array.isArray(args) ? args.at(0) : args;
  const parsed = Number(first);

  return Number.isFinite(parsed) ? parsed : null;
};

const send = (win: BrowserWindow, channel: string, ...args: unknown[]) => {
  if (win.isDestroyed()) {
    return;
  }

  win.webContents.send(channel, ...args);
};

/**
 * Playback controls, as the app's own UI (menu, tray, protocol URLs, plugins) sees
 * them. Each one is a message to the page, where `video-controls-front` drives the
 * site's player - so the app never needs to know what a player is.
 */
export const getVideoControls = (win: BrowserWindow) => ({
  pause: () => send(win, "watchdeck:pause"),
  play: () => send(win, "watchdeck:play"),
  playPause: () => send(win, "watchdeck:toggle-play"),
  next: () => send(win, "watchdeck:next-video"),
  previous: () => send(win, "watchdeck:previous-video"),
  muteUnmute: () => send(win, "watchdeck:toggle-mute"),
  volumeUp: () => send(win, "watchdeck:volume-step", VOLUME_STEP),
  volumeDown: () => send(win, "watchdeck:volume-step", -VOLUME_STEP),
  seekTo: (seconds: Args<number>) => {
    const value = toNumber(seconds);
    if (value !== null) {
      send(win, "watchdeck:seek-to", value);
    }
  },
  goBack: (seconds: Args<number>) => {
    const value = toNumber(seconds);
    if (value !== null) {
      send(win, "watchdeck:seek-by", -value);
    }
  },
  goForward: (seconds: Args<number>) => {
    const value = toNumber(seconds);
    if (value !== null) {
      send(win, "watchdeck:seek-by", value);
    }
  },
  setVolume: (percent: Args<number>) => {
    const value = toNumber(percent);
    if (value !== null) {
      send(win, "watchdeck:set-volume", value);
    }
  },
});
