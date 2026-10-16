import { Mutex } from "async-mutex";
import { ipcMain, nativeImage, net } from "electron";
import type { BrowserWindow } from "electron";

import * as config from "@/config";
import type { VideoInfo } from "@/types/video-info";

/** Which part of the mirrored state changed. */
export enum VideoInfoEvent {
  VideoChanged = "video-changed",
  PlayOrPaused = "play-or-paused",
  TimeChanged = "time-changed",
  VolumeChanged = "volume-changed",
}

export type VideoInfoCallback = (
  info: VideoInfo,
  event: VideoInfoEvent
) => void;

// Filled with the callbacks plugins register
const callbacks = new Set<VideoInfoCallback>();

/** Lets a plugin follow what is playing without touching the page itself. */
export const registerCallback = (callback: VideoInfoCallback) => {
  callbacks.add(callback);
};

const emptyInfo = (): VideoInfo => ({
  channel: "",
  duration: 0,
  elapsedSeconds: 0,
  isMuted: false,
  isPaused: true,
  title: "",
  videoId: "",
  volume: 0,
});

const fetchImage = async (
  url: string
): Promise<Electron.NativeImage | null> => {
  try {
    const response = await net.fetch(url);
    if (!response.ok) {
      return null;
    }

    const image = nativeImage.createFromBuffer(
      Buffer.from(await response.arrayBuffer())
    );
    return image.isEmpty() ? null : image;
  } catch {
    return null;
  }
};

/**
 * YouTube serves a few thumbnails only at their signed URL (a `.jpg` path that is
 * really a webp). Try the plain URL first, because that is the one worth storing,
 * and fall back to the signed one the page saw.
 */
export const getThumbnailImage = async (
  signed?: string
): Promise<Electron.NativeImage | null> => {
  if (!signed) {
    return null;
  }

  return (await fetchImage(signed.split("?")[0])) ?? (await fetchImage(signed));
};

/**
 * Mirrors the page's player state in the main process, and hands it to the plugins
 * that asked for it (tray, MPRIS, notifications, ...).
 *
 * The page sends one message per kind of change; each one patches the same object,
 * so a listener always reads a complete video record even when only the position
 * moved (docs/PRD.md §3.1, "player/track providers").
 */
export const setupVideoInfo = (win: BrowserWindow) => {
  const mutex = new Mutex();
  let info = emptyInfo();

  const broadcast = (event: VideoInfoEvent) => {
    for (const callback of callbacks) {
      callback(info, event);
    }
  };

  ipcMain.on("watchdeck:video-changed", (_, page: VideoInfo) => {
    void mutex.runExclusive(async () => {
      info = {
        ...page,
        image: await getThumbnailImage(page.imageSrc),
        imageSrc: page.imageSrc?.split("?")[0],
      };

      // Used by options.resumeOnStart
      if (info.url) {
        config.set("url", info.url);
      }

      // The page has no use for a native image, and sending one is not the point
      if (!win.isDestroyed()) {
        win.webContents.send("watchdeck:update-video-info", {
          ...info,
          image: undefined,
        });
      }

      broadcast(VideoInfoEvent.VideoChanged);
    });
  });

  ipcMain.on(
    "watchdeck:play-or-paused",
    (
      _,
      {
        isPaused,
        elapsedSeconds,
      }: { isPaused: boolean; elapsedSeconds: number }
    ) => {
      info.isPaused = isPaused;
      info.elapsedSeconds = elapsedSeconds;
      broadcast(VideoInfoEvent.PlayOrPaused);
    }
  );

  ipcMain.on("watchdeck:time-changed", (_, elapsedSeconds: number) => {
    info.elapsedSeconds = elapsedSeconds;
    broadcast(VideoInfoEvent.TimeChanged);
  });

  ipcMain.on(
    "watchdeck:volume-changed",
    (_, { isMuted, volume }: { isMuted: boolean; volume: number }) => {
      info.isMuted = isMuted;
      info.volume = volume;
      broadcast(VideoInfoEvent.VolumeChanged);
    }
  );
};
