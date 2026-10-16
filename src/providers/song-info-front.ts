import { LikeType } from "@/types/datahost-get-state";
import type { GetState } from "@/types/datahost-get-state";
import type { MusicPlayer } from "@/types/music-player";
import type {
  AlbumDetails,
  PlayerOverlays,
  VideoDataChangeValue,
} from "@/types/player-api-events";
import type { VideoDataChanged } from "@/types/video-data-changed";

import { singleton } from "./decorators";
import type { SongInfo } from "./song-info";

const DATAUPDATED_FALLBACK_TIMEOUT_MS = 1500;

let songInfo: SongInfo = {} as SongInfo;
export const getSongInfo = () => songInfo;

window.ipcRenderer.on(
  "watchdeck:update-song-info",
  (_, extractedSongInfo: SongInfo) => {
    songInfo = extractedSongInfo;
  }
);

// Used because 'loadeddata' or 'loadedmetadata' weren't firing on song start for some users (https://github.com/erikenz/watchdeck/issues/473)
const srcChangedEvent = new CustomEvent("watchdeck:src-changed");

export const setupSeekedListener = singleton(() => {
  document.querySelector("video")?.addEventListener("seeked", (v) => {
    if (v.target instanceof HTMLVideoElement) {
      window.ipcRenderer.send("watchdeck:seeked", v.target.currentTime);
    }
  });
});

export const setupTimeChangedListener = singleton(() => {
  const progressObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const target = mutation.target as Node & { value: string };
      const numberValue = Number(target.value);
      window.ipcRenderer.send("watchdeck:time-changed", numberValue);
      songInfo.elapsedSeconds = numberValue;
    }
  });
  const progressBar = document.querySelector("#progress-bar");
  if (progressBar) {
    progressObserver.observe(progressBar, { attributeFilter: ["value"] });
  }
});

export const setupRepeatChangedListener = singleton(() => {
  const repeatObserver = new MutationObserver((mutations) => {
    // provided by App
    window.ipcRenderer.send(
      "watchdeck:repeat-changed",
      (
        mutations[0].target as Node & {
          __dataHost: {
            getState: () => GetState;
          };
        }
      ).__dataHost.getState().queue.repeatMode
    );
  });
  repeatObserver.observe(document.querySelector("#right-controls .repeat")!, {
    attributeFilter: ["title"],
  });

  // Emit the initial value as well; as it's persistent between launches.
  // provided by App
  window.ipcRenderer.send(
    "watchdeck:repeat-changed",
    document
      .querySelector<
        HTMLElement & {
          getState: () => GetState;
        }
      >("ytmusic-player-bar")
      ?.getState().queue.repeatMode
  );
});

const mapLikeStatus = (status: string | null): LikeType =>
  Object.values(LikeType).includes(status as LikeType)
    ? (status as LikeType)
    : LikeType.Indifferent;

const LIKE_STATUS_ATTRIBUTE = "like-status";

export const setupLikeChangedListener = singleton(() => {
  const likeDislikeObserver = new MutationObserver((mutations) => {
    window.ipcRenderer.send(
      "watchdeck:like-changed",
      mapLikeStatus(
        (mutations[0].target as HTMLElement)?.getAttribute?.(
          LIKE_STATUS_ATTRIBUTE
        )
      )
    );
  });
  const likeButtonRenderer = document.querySelector("#like-button-renderer");
  if (likeButtonRenderer) {
    likeDislikeObserver.observe(likeButtonRenderer, {
      attributeFilter: [LIKE_STATUS_ATTRIBUTE],
      attributes: true,
    });

    // Emit the initial value as well; as it's persistent between launches.
    window.ipcRenderer.send(
      "watchdeck:like-changed",
      mapLikeStatus(likeButtonRenderer.getAttribute?.(LIKE_STATUS_ATTRIBUTE))
    );
  }
});

export const setupVolumeChangedListener = singleton((api: MusicPlayer) => {
  document.querySelector("video")?.addEventListener("volumechange", () => {
    window.ipcRenderer.send("watchdeck:volume-changed", {
      isMuted: api.isMuted(),
      state: api.getVolume(),
    });
  });

  // Emit the initial value as well; as it's persistent between launches.
  window.ipcRenderer.send("watchdeck:volume-changed", {
    isMuted: api.isMuted(),
    state: api.getVolume(),
  });
});

export const setupShuffleChangedListener = singleton(() => {
  const playerBar = document.querySelector("ytmusic-player-bar");

  if (!playerBar) {
    window.ipcRenderer.send("watchdeck:shuffle-changed-supported", false);
    return;
  }

  const observer = new MutationObserver(() => {
    window.ipcRenderer.send(
      "watchdeck:shuffle-changed",
      (playerBar?.attributes.getNamedItem("shuffle-on") ?? null) !== null
    );
  });

  observer.observe(playerBar, {
    attributeFilter: ["shuffle-on"],
    attributes: true,
    childList: false,
    subtree: false,
  });
});

export const setupFullScreenChangedListener = singleton(() => {
  const playerBar = document.querySelector("ytmusic-player-bar");

  if (!playerBar) {
    window.ipcRenderer.send("watchdeck:fullscreen-changed-supported", false);
    return;
  }

  const observer = new MutationObserver(() => {
    window.ipcRenderer.send(
      "watchdeck:fullscreen-changed",
      (playerBar?.attributes.getNamedItem("player-fullscreened") ?? null) !==
        null
    );
  });

  observer.observe(playerBar, {
    attributeFilter: ["player-fullscreened"],
    attributes: true,
    childList: false,
    subtree: false,
  });
});

export const setupAutoPlayChangedListener = singleton(() => {
  const autoplaySlider = document.querySelector<HTMLInputElement>(
    ".autoplay > tp-yt-paper-toggle-button"
  );

  const observer = new MutationObserver(() => {
    window.ipcRenderer.send("watchdeck:autoplay-changed");
  });

  observer.observe(autoplaySlider!, {
    attributes: true,
    childList: false,
    subtree: false,
  });
});

export const setupSongInfo = (api: MusicPlayer) => {
  window.ipcRenderer.on("watchdeck:setup-time-changed-listener", () => {
    setupTimeChangedListener();
  });

  window.ipcRenderer.on("watchdeck:setup-like-changed-listener", () => {
    setupLikeChangedListener();
  });

  window.ipcRenderer.on("watchdeck:setup-repeat-changed-listener", () => {
    setupRepeatChangedListener();
  });

  window.ipcRenderer.on("watchdeck:setup-volume-changed-listener", () => {
    setupVolumeChangedListener(api);
  });

  window.ipcRenderer.on("watchdeck:setup-shuffle-changed-listener", () => {
    setupShuffleChangedListener();
  });

  window.ipcRenderer.on("watchdeck:setup-fullscreen-changed-listener", () => {
    setupFullScreenChangedListener();
  });

  window.ipcRenderer.on("watchdeck:setup-autoplay-changed-listener", () => {
    setupAutoPlayChangedListener();
  });

  window.ipcRenderer.on("watchdeck:setup-seeked-listener", () => {
    setupSeekedListener();
  });

  const playPausedHandler = (e: Event, status: string) => {
    if (
      e.target instanceof HTMLVideoElement &&
      Math.round(e.target.currentTime) > 0
    ) {
      window.ipcRenderer.send("watchdeck:play-or-paused", {
        elapsedSeconds: Math.floor(e.target.currentTime),
        isPaused: status === "pause",
      });
    }
  };

  const playPausedHandlers = {
    pause: (e: Event) => {
      playPausedHandler(e, "pause");
    },
    playing: (e: Event) => {
      playPausedHandler(e, "playing");
    },
  };

  const videoEventDispatcher = async (
    name: string,
    videoData: VideoDataChangeValue
    // oxlint-disable-next-line typescript/require-await
  ) =>
    document.dispatchEvent(
      new CustomEvent<VideoDataChanged>("videodatachange", {
        detail: { name, videoData },
      })
    );

  const waitingEvent = new Set<string>();
  const waitingTimeouts = new Map<string, NodeJS.Timeout>();

  const clearVideoTimeout = (videoId: string) => {
    const timeoutId = waitingTimeouts.get(videoId);

    if (timeoutId) {
      clearTimeout(timeoutId);
      waitingTimeouts.delete(videoId);
    }
  };

  // Name = "dataloaded" and abit later "dataupdated"
  // Sometimes "dataupdated" is not fired, so we need to fallback to "dataloaded"
  api.addEventListener("videodatachange", (name, videoData) => {
    videoEventDispatcher(name, videoData);

    if (name === "dataupdated" && waitingEvent.has(videoData.videoId)) {
      waitingEvent.delete(videoData.videoId);
      clearVideoTimeout(videoData.videoId);
      sendSongInfo(videoData);
    } else if (name === "dataloaded") {
      const video = document.querySelector<HTMLVideoElement>("video");
      video?.dispatchEvent(srcChangedEvent);

      for (const status of ["playing", "pause"] as const) {
        // for fix issue that pause event not fired
        video?.addEventListener(status, playPausedHandlers[status]);
      }

      clearVideoTimeout(videoData.videoId);
      waitingEvent.add(videoData.videoId);

      const timeoutId = setTimeout(() => {
        if (waitingEvent.has(videoData.videoId)) {
          waitingEvent.delete(videoData.videoId);
          waitingTimeouts.delete(videoData.videoId);
          sendSongInfo(videoData);
        }
      }, DATAUPDATED_FALLBACK_TIMEOUT_MS);

      waitingTimeouts.set(videoData.videoId, timeoutId);
    }
  });

  const video = document.querySelector("video");

  if (video) {
    for (const status of ["playing", "pause"] as const) {
      video.addEventListener(status, playPausedHandlers[status]);
    }

    if (!isNaN(video.duration)) {
      const {
        title,
        author,
        video_id: videoId,
        list: playlistId,
      } = api.getVideoData();

      const watchNextResponse = api.getWatchNextResponse();

      sendSongInfo({
        author,
        isUpcoming: false,
        lengthSeconds: video.duration,
        loading: true,
        playlistId,
        title,
        videoId,
        ["wdWatchNextResponse"]: watchNextResponse,
      } satisfies VideoDataChangeValue);
    }
  }

  function sendSongInfo(videoData: VideoDataChangeValue) {
    const data = api.getPlayerResponse();

    let playerOverlay: PlayerOverlays | undefined;

    if (videoData.wdWatchNextResponse) {
      playerOverlay = videoData.wdWatchNextResponse?.playerOverlays;
    } else {
      playerOverlay = (
        Object.entries(videoData).find(
          ([, value]) => value && Object.hasOwn(value, "playerOverlays")
        ) as [string, AlbumDetails | undefined]
      )?.[1]?.playerOverlays;
    }
    data.videoDetails.album =
      playerOverlay?.playerOverlayRenderer?.browserMediaSession?.browserMediaSessionRenderer?.album?.runs?.at(
        0
      )?.text;
    data.videoDetails.elapsedSeconds = 0;
    data.videoDetails.isPaused = false;

    window.ipcRenderer.send("watchdeck:video-src-changed", data);
  }
};
