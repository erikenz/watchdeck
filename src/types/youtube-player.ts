import type { GetPlayerResponse } from "./get-player-response";
import type { VideoDataChangeValue } from "./player-api-events";
import type { VideoDetails } from "./video-details";

/** `#movie_player.getPlayerState()` values, numbered the way YouTube numbers them. */
export enum PlayerState {
  Unstarted = -1,
  Ended = 0,
  Playing = 1,
  Paused = 2,
  Buffering = 3,
  Cued = 5,
}

/**
 * The slice of YouTube's `#movie_player` element this app uses.
 *
 * `src/types/music-player.ts` describes the same element with every method the
 * inherited tree reached for, most of which only exist on YouTube Music. New code
 * takes this narrower view; the wide type stays until the plugins that use it are
 * reworked (docs/PRD.md §R5).
 */
export interface YouTubePlayer {
  /**
   * Fires once per media load: `dataloaded`, then usually `dataupdated` - which
   * carries the metadata the site has finished fetching.
   */
  addEventListener(
    type: "videodatachange",
    listener: (
      name: "dataloaded" | "dataupdated",
      data: VideoDataChangeValue
    ) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: "videodatachange",
    listener: (
      name: "dataloaded" | "dataupdated",
      data: VideoDataChangeValue
    ) => void,
    options?: boolean | EventListenerOptions
  ): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerResponse(): GetPlayerResponse;
  /** One of YouTube's own states; see {@link PlayerState}. */
  getPlayerState(): PlayerState;
  getVideoData(): VideoDetails;
  /** 0-100. */
  getVolume(): number;
  isMuted(): boolean;
  mute(): void;
  nextVideo(): void;
  pauseVideo(): void;
  playVideo(): void;
  previousVideo(): void;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  /** 0-100. */
  setVolume(percent: number): void;
  unMute(): void;
}
