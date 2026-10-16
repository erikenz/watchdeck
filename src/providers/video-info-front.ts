import type { VideoInfo } from "@/types/video-info";
/**
 * The page's half of the `video-info` provider: reads what is playing off the site's
 * player and keeps the main process in step.
 *
 * Nothing here depends on catching one particular event. A cold watch-page load fires
 * `dataupdated` and no `dataloaded`, an SPA navigation fires both, and the element can be
 * replaced without either - so every one of those is only a *trigger* to read the player,
 * and a read that returns the same video as last time is dropped. Binding is driven by
 * the site's own SPA events (docs/PRD.md §3.4) and by the media element's `loadstart`.
 */
import type { YouTubePlayer } from "@/types/youtube-player";

import { getPlayer, getVideo } from "./youtube-dom";

/** A media load announces itself before its metadata exists. */
const REPORT_AFTER_LOAD_DELAY_MS = 800;

const SITE_ORIGIN =
  "https://www.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com";

type Player = Element & YouTubePlayer;
type VideoDataChangeListener = (
  name: "dataloaded" | "dataupdated",
  data: { videoId?: string }
) => void;

let videoInfo: VideoInfo | null = null;
let lastReported = "";
let loadTimeout: ReturnType<typeof setTimeout> | undefined;
let attachedPlayer: Player | null = null;
let attachedPlayerListener: VideoDataChangeListener | null = null;

/** What the main process last said it knows - empty until a video loads. */
export const getVideoInfo = () => videoInfo;

const readVideoInfo = (player: Player): VideoInfo | null => {
  const response = player.getPlayerResponse?.();
  const details = response?.videoDetails;
  if (!details?.videoId) {
    return null;
  }

  const video = getVideo();
  const microformat = response.microformat?.microformatDataRenderer;
  const listFromUrl = URL.parse(
    microformat?.urlCanonical ?? ""
  )?.searchParams.get("list");
  const { channelId } = details;

  return {
    channel: details.author,
    channelId,
    channelUrl: channelId ? `${SITE_ORIGIN}/channel/${channelId}` : undefined,
    duration: Number(details.lengthSeconds) || 0,
    elapsedSeconds: Math.floor(video?.currentTime ?? 0),
    imageSrc: details.thumbnail?.thumbnails?.at(-1)?.url,
    isLive: details.isLiveContent,
    isMuted: player.isMuted?.() ?? false,
    // Asked of the media element, not of the player state: the state numbers
    // buffering (3) and cued (5) alongside paused, and a video that is buffering is
    // not a video the user paused - reading it as one put a stale "paused" into the
    // mirror on every transition, and it outranked the play/pause reports.
    isPaused: video?.paused ?? true,
    playlistId: player.getVideoData?.().list || listFromUrl || undefined,
    title: details.title,
    uploadDate: microformat?.uploadDate,
    url: `${SITE_ORIGIN}/watch?v=${details.videoId}`,
    videoId: details.videoId,
    views: Number(details.viewCount) || undefined,
    volume: Math.round(player.getVolume?.() ?? 0),
  };
};

/** A video is "the same video" while its id, title, channel and length all match. */
const signatureOf = (info: VideoInfo) =>
  [info.videoId, info.title, info.channel, info.duration].join("|");

/**
 * Reads the player and reports it, unless it is the video the main process already has.
 * Called from every signal rather than from one event, so a missed event costs nothing.
 */
export const reportCurrentVideo = (player = getPlayer()) => {
  if (!player) {
    return;
  }

  const info = readVideoInfo(player);
  if (!info) {
    return;
  }

  const signature = signatureOf(info);
  if (signature === lastReported) {
    return;
  }

  lastReported = signature;
  videoInfo = info;
  window.ipcRenderer.send("watchdeck:video-changed", info);
};

/** Binds to the player the page is showing now, and lets go of what it replaced. */
export const bindPlayer = () => {
  const player = getPlayer();

  if (!player || player === attachedPlayer) {
    return;
  }

  if (attachedPlayer && attachedPlayerListener) {
    attachedPlayer.removeEventListener(
      "videodatachange",
      attachedPlayerListener
    );
  }

  attachedPlayer = player;
  attachedPlayerListener = (_name, data) => {
    if (data?.videoId) {
      reportCurrentVideo(player);
    }
  };
  player.addEventListener("videodatachange", attachedPlayerListener);

  reportCurrentVideo(player);
};

const reportPlayOrPaused = (video: HTMLVideoElement, isPaused: boolean) => {
  // The site fires a `pause` while it is still loading, at position zero
  if (isPaused && video.currentTime <= 0) {
    return;
  }

  window.ipcRenderer.send("watchdeck:play-or-paused", {
    elapsedSeconds: Math.floor(video.currentTime),
    isPaused,
  });
};

/**
 * The media element's own events. They are caught on `document` in the capture phase, so
 * they keep arriving when the site swaps the element out under a long-lived page.
 */
const onMediaEvent = (event: Event) => {
  const { target } = event;
  if (!(target instanceof HTMLVideoElement)) {
    return;
  }

  switch (event.type) {
    case "loadstart": {
      bindPlayer();
      clearTimeout(loadTimeout);
      loadTimeout = setTimeout(reportCurrentVideo, REPORT_AFTER_LOAD_DELAY_MS);
      break;
    }
    case "playing": {
      reportPlayOrPaused(target, false);
      break;
    }
    case "pause": {
      reportPlayOrPaused(target, true);
      break;
    }
    case "volumechange": {
      window.ipcRenderer.send("watchdeck:volume-changed", {
        isMuted: target.muted,
        volume: Math.round(target.volume * 100),
      });
      break;
    }
    default: {
      // timeupdate and seeked
      window.ipcRenderer.send(
        "watchdeck:time-changed",
        Math.floor(target.currentTime)
      );
    }
  }
};

const onBind = () => bindPlayer();

const MEDIA_EVENTS = [
  "loadstart",
  "playing",
  "pause",
  "volumechange",
  "timeupdate",
  "seeked",
] as const;

/** Starts following the player, including across the site's own navigations. */
export const setupVideoInfo = () => {
  window.ipcRenderer.on("watchdeck:update-video-info", (_, info: VideoInfo) => {
    videoInfo = info;
  });

  for (const type of MEDIA_EVENTS) {
    document.addEventListener(type, onMediaEvent, true);
  }

  bindPlayer();
  document.addEventListener("yt-navigate-finish", onBind);
  window.addEventListener("popstate", onBind);
};
