/**
 * The page's half of the playback controls: turns the app's commands into calls on the
 * site's player.
 *
 * Every handler resolves the player when it runs, so the app keeps working when the
 * site replaces the element (a navigation, or the inline preview taking over).
 */
import { PlayerState } from "@/types/youtube-player";

import { getPlayer } from "./youtube-dom";

const setVolume = (percent: number) => {
  const player = getPlayer();
  if (!player) {
    return;
  }

  const volume = Math.round(Math.min(100, Math.max(0, percent)));
  player.setVolume?.(volume);

  // Raising the volume on a muted player is a no-op the user cannot see
  if (volume > 0 && player.isMuted?.()) {
    player.unMute?.();
  }
};

const seekBy = (delta: number) => {
  const player = getPlayer();
  if (!player) {
    return;
  }

  const duration = player.getDuration?.() ?? 0;
  const target = (player.getCurrentTime?.() ?? 0) + delta;
  const clamped = Math.max(
    0,
    duration > 0 ? Math.min(duration, target) : target
  );
  player.seekTo?.(clamped, true);
};

export const setupVideoControls = () => {
  window.ipcRenderer.on("watchdeck:play", () => getPlayer()?.playVideo?.());
  window.ipcRenderer.on("watchdeck:pause", () => getPlayer()?.pauseVideo?.());
  window.ipcRenderer.on("watchdeck:toggle-play", () => {
    const player = getPlayer();

    if (player?.getPlayerState?.() === PlayerState.Playing) {
      player.pauseVideo?.();
    } else {
      player?.playVideo?.();
    }
  });
  window.ipcRenderer.on("watchdeck:next-video", () =>
    getPlayer()?.nextVideo?.()
  );
  window.ipcRenderer.on("watchdeck:previous-video", () =>
    getPlayer()?.previousVideo?.()
  );
  window.ipcRenderer.on("watchdeck:seek-to", (_, seconds: number) => {
    getPlayer()?.seekTo?.(Math.max(0, seconds), true);
  });
  window.ipcRenderer.on("watchdeck:seek-by", (_, delta: number) => {
    seekBy(delta);
  });
  window.ipcRenderer.on("watchdeck:set-volume", (_, percent: number) => {
    setVolume(percent);
  });
  window.ipcRenderer.on("watchdeck:volume-step", (_, delta: number) => {
    setVolume((getPlayer()?.getVolume?.() ?? 0) + delta);
  });
  window.ipcRenderer.on("watchdeck:toggle-mute", () => {
    const player = getPlayer();

    if (player?.isMuted?.()) {
      player.unMute?.();
    } else {
      player?.mute?.();
    }
  });
};
