/**
 * What the app knows about the video that is loaded right now.
 *
 * The page builds this from the player (the `video-info` providers) and the main
 * process mirrors it, so plugins on either side read one shape instead of reaching
 * into the site's DOM.
 */
export interface VideoInfo {
  /** YouTube's 11-character id. Empty when a response cannot be read. */
  videoId: string;
  title: string;
  /** Channel display name, as the site shows it. */
  channel: string;
  channelId?: string;
  channelUrl?: string;
  /** Duration in seconds; 0 for a live stream with no known end. */
  duration: number;
  elapsedSeconds: number;
  isPaused: boolean;
  isLive?: boolean;
  views?: number;
  /** Human-readable upload date from the page's metadata, when it has one. */
  uploadDate?: string;
  /** The `list` parameter, when the video is playing from a playlist. */
  playlistId?: string;
  /** Canonical watch URL; the main process stores it so `resumeOnStart` can use it. */
  url?: string;
  /** Thumbnail URL without its signature, so consumers can fetch it later too. */
  imageSrc?: string;
  /** Thumbnail, fetched in the main process. Never set by the page. */
  image?: Electron.NativeImage | null;
  /** 0-100, as the site's own volume control shows it. */
  volume: number;
  isMuted: boolean;
}
