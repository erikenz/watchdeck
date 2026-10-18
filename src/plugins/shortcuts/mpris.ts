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

import { isTrackFor, trackIdFor } from "./shortcuts";

/**
 * MPRIS: what the desktop's media keys, lock screen and player widgets talk to (docs/PRD.md §R5).
 *
 * Two details that are not obvious from the API:
 *
 * 1. **The bus name is the on-disk identity, not the display name.** MPRIS clients - `playerctl`
 *    above all - address a player as `org.mpris.MediaPlayer2.<name>`, and a desktop matches it
 *    against `watchdeck.desktop`; the inherited code announced `Watchdeck`, which is why
 *    `playerctl --player=watchdeck` found nothing.
 * 2. **There is no teardown in the library.** Once registered, the bus name lives until the app
 *    exits: `@jellybrick/mpris-service` keeps its connection private, so disabling the plugin
 *    stops the metadata updates but not the name.
 */
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
    name: "watchdeck",
    supportedInterfaces: ["player"],
    supportedMimeTypes: ["audio/mpeg"],
  });

  instance.canRaise = true;
  instance.canQuit = false;
  // There is no queue to ask about: the site decides what "next" means (its own playlist, or the
  // recommendation it is already showing)
  instance.canGoNext = true;
  instance.canGoPrevious = true;
  // Absolute and relative seeks both work, and `SetPosition` is refused without this (measured:
  // `playerctl position 60` moves the video to 61 s, `position 15+` moves it 15 s on).
  instance.canSeek = true;
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

    const player = setupMPRIS();

    const seekTo = (event: Position) => {
      const videoId = currentSongInfo?.videoId;

      // `SetPosition` carries the track id the client read from our metadata; a seek aimed at
      // another track (a stale client, or a video that has since changed) is not ours to serve.
      if (!videoId || !isTrackFor(event.trackId, videoId)) {
        console.debug(
          LoggerPrefix,
          "MPRIS: ignoring a seek for another track",
          event.trackId
        );
        return;
      }

      win.webContents.send(
        "watchdeck:seek-to",
        microToSec(event.position ?? 0)
      );
      player.setPosition(event.position ?? 0);
      player.seeked(event.position ?? 0);
    };

    const seekBy = (offset: number) => {
      win.webContents.send("watchdeck:seek-by", microToSec(offset));
      player.setPosition(player.getPosition() + offset);
      player.seeked(player.getPosition());
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
            `Track/${trackIdFor(songInfo.videoId)}`
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
