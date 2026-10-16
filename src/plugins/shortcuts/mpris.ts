import MprisPlayer from "@jellybrick/mpris-service";
import type {
  PlayBackStatus,
  PlayerOptions,
  Position,
  Track,
} from "@jellybrick/mpris-service";
import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";

import * as config from "@/config";
import { APPLICATION_NAME } from "@/i18n";
import { getVideoControls } from "@/providers/video-controls";
import { registerCallback, VideoInfoEvent } from "@/providers/video-info";
import type { VideoInfo } from "@/types/video-info";
import { LoggerPrefix } from "@/utils";

class YTPlayer extends MprisPlayer {
  /**
   * @type {number} The current position in microseconds
   * @private
   */
  private currentPosition: number = 0;

  constructor(opts: PlayerOptions) {
    super(opts);
  }

  setPosition(t: number) {
    this.currentPosition = t;
  }

  override getPosition(): number {
    return this.currentPosition;
  }

  isPlaying(): boolean {
    return this.playbackStatus === MprisPlayer.PLAYBACK_STATUS_PLAYING;
  }

  isPaused(): boolean {
    return this.playbackStatus === MprisPlayer.PLAYBACK_STATUS_PAUSED;
  }

  isStopped(): boolean {
    return this.playbackStatus === MprisPlayer.PLAYBACK_STATUS_STOPPED;
  }

  setPlaybackStatus(status: PlayBackStatus) {
    this.playbackStatus = status;
  }
}

function setupMPRIS() {
  const instance = new YTPlayer({
    identity: APPLICATION_NAME,
    name: "Watchdeck",
    supportedInterfaces: ["player"],
    supportedMimeTypes: ["audio/mpeg"],
  });

  instance.canRaise = true;
  instance.canQuit = false;
  // There is no queue to ask about: the site decides what "next" means (its own
  // playlist, or the recommendation it is already showing)
  instance.canGoNext = true;
  instance.canGoPrevious = true;
  instance.supportedUriSchemes = ["http", "https"];
  instance.desktopEntry = "watchdeck";
  return instance;
}
export function registerMPRIS(win: BrowserWindow) {
  const videoControls = getVideoControls(win);
  const { playPause, next, previous, setVolume } = videoControls;
  try {
    let currentSongInfo: VideoInfo | null = null;
    const secToMicro = (n: number) => Math.round(Number(n) * 1e6);
    const microToSec = (n: number) => Math.round(Number(n) / 1e6);

    const correctId = (videoId: string) => videoId.replace(/-/g, "_MINUS_");

    const player = setupMPRIS();

    const seekTo = (event: Position) => {
      if (
        currentSongInfo?.videoId &&
        event.trackId.endsWith(correctId(currentSongInfo.videoId))
      ) {
        win.webContents.send(
          "watchdeck:seek-to",
          microToSec(event.position ?? 0)
        );
        player.setPosition(event.position ?? 0);
      }
    };
    const seekBy = (offset: number) => {
      win.webContents.send("watchdeck:seek-by", microToSec(offset));
      player.setPosition(player.getPosition() + offset);
    };

    player.on("raise", () => {
      if (!player.canRaise) {
        return;
      }

      win.setSkipTaskbar(false);
      win.show();
    });

    ipcMain.on(
      "watchdeck:volume-changed",
      (_, state: Pick<VideoInfo, "isMuted" | "volume">) => {
        player.volume = state.isMuted
          ? 0
          : Number.parseFloat((state.volume / 100).toFixed(2));
      }
    );

    player.on("play", () => {
      if (!player.isPlaying()) {
        player.setPlaybackStatus(MprisPlayer.PLAYBACK_STATUS_PLAYING);
        playPause();
      }
    });
    player.on("pause", () => {
      if (!player.isPaused()) {
        player.setPlaybackStatus(MprisPlayer.PLAYBACK_STATUS_PAUSED);
        playPause();
      }
    });
    player.on("playpause", () => {
      player.setPlaybackStatus(
        player.isPlaying()
          ? MprisPlayer.PLAYBACK_STATUS_PAUSED
          : MprisPlayer.PLAYBACK_STATUS_PLAYING
      );
      playPause();
    });

    player.on("next", () => {
      next();
    });

    player.on("previous", () => {
      previous();
    });

    player.on("seek", seekBy);
    player.on("position", seekTo);

    player.on("open", (args: { uri: string }) => {
      void win.loadURL(args.uri);
    });

    player.on("error", (error: Error) => {
      console.error(LoggerPrefix, "Error in MPRIS");
      console.trace(error);
    });

    player.on("volume", async (newVolume: number) => {
      if (await config.plugins.isEnabled("precise-volume")) {
        // With precise volume we can set the volume to the exact value.
        win.webContents.send("setVolume", ~~(newVolume * 100));
      } else {
        setVolume(newVolume * 100);
      }
    });

    registerCallback((songInfo: VideoInfo, event) => {
      if (event === VideoInfoEvent.TimeChanged) {
        player.setPosition(secToMicro(songInfo.elapsedSeconds ?? 0));
        return;
      }
      if (player) {
        const data: Track = {
          "mpris:length": secToMicro(songInfo.duration),
          ...(songInfo.imageSrc
            ? { "mpris:artUrl": songInfo.imageSrc }
            : undefined),
          "xesam:title": songInfo.title,
          "xesam:url": songInfo.url,
          "xesam:artist": [songInfo.channel],
          "mpris:trackid": player.objectPath(
            `Track/${correctId(songInfo.videoId)}`
          ),
        };
        currentSongInfo = songInfo;

        player.metadata = data;

        const currentElapsedMicroSeconds = secToMicro(
          songInfo.elapsedSeconds ?? 0
        );
        player.setPosition(currentElapsedMicroSeconds);
        player.seeked(currentElapsedMicroSeconds);

        player.setPlaybackStatus(
          songInfo.isPaused
            ? MprisPlayer.PLAYBACK_STATUS_PAUSED
            : MprisPlayer.PLAYBACK_STATUS_PLAYING
        );
      }
    });
  } catch (error) {
    console.error(LoggerPrefix, "Error in MPRIS");
    console.trace(error);
  }
}
