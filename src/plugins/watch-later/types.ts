/**
 * Shared types for the Watch Later plugin. Anything that crosses the IPC boundary
 * lives here so the backend, the renderer and the tests agree on the shape.
 */

/**
 * A threshold in either unit. `percent` is a share of the duration, `minutes` an amount of
 * video — for `inProgress.max` the minutes count *back from the end*, so a 1 minute maximum
 * on a 10 minute video means "from minute 9 onwards it counts as watched".
 */
export interface WatchLaterThreshold {
  minutes?: number;
  percent?: number;
}

export interface WatchLaterPluginConfig {
  enabled: boolean;
  /** Sync on app start, when a session is available. */
  syncOnStart: boolean;
  /** Minutes between automatic syncs; 0 disables the interval. */
  syncIntervalMinutes: number;
  /** Requests per second while paging the list. */
  requestsPerSecond: number;
  /** Fetch title/description/tags for every entry (rate limited as well). */
  enrichMetadata: boolean;
  /** Thresholds for the three buckets; percentages are 0-100, minutes are video minutes. */
  watched: WatchLaterThreshold;
  inProgress: { min: WatchLaterThreshold; max: WatchLaterThreshold };
  /** Show the save button when hovering a thumbnail. */
  showHoverButton: boolean;
  /** Add the toolbar and the enriched rows to the site's own Watch Later page. */
  enhancePage: boolean;
  /** Fade the cards of videos that are already in Watch Later. */
  dimSaved: boolean;
  /**
   * Opacity of a saved card, 0-1. Deliberately above the dim-viewed plugin's default: a video
   * saved for later is faded less than one that has already been watched.
   */
  savedOpacity: number;
}

export interface WatchLaterAccount {
  /** Stable id: the channel handle when the session gives one, else `account-<index>`. */
  id: string;
  name: string;
  handle?: string;
  photoUrl?: string;
  /**
   * The `X-Goog-Authuser` index this account answers to. It is *not* the position in any
   * list the API returns - the two differ, which is why the index is probed.
   */
  index: number;
  /** Subscriber/membership line, the only thing that tells two "Erik Enz" apart. */
  byline?: string;
  isSelected: boolean;
  lastSeenAt?: string;
}

export type WatchLaterBucket = "watched" | "in-progress" | "unwatched";

export interface WatchLaterEntry {
  videoId: string;
  title: string;
  channelTitle?: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
  setVideoId?: string;
  position?: number;
  savedAt?: string;
  /** 0-100, from YouTube's own resume indicator. */
  ytPercentWatched?: number;
  /** Seconds, merged from the local high-water mark and YouTube's percentage. */
  watchedSeconds: number;
  /** 0-1, the merged ratio the buckets are computed from. */
  ratio: number;
  bucket: WatchLaterBucket;
  progressSource: "none" | "local" | "youtube" | "both";
  isLive: boolean;
}

export interface WatchLaterQuery {
  accountId?: string;
  search?: string;
  bucket?: WatchLaterBucket;
  limit?: number;
  offset?: number;
}

export interface WatchLaterState {
  accounts: WatchLaterAccount[];
  activeAccountId: string | null;
  syncing: boolean;
  lastSync?: {
    startedAt: string;
    finishedAt?: string;
    pages: number;
    items: number;
    status: string;
    error?: string;
  };
  totalEntries: number;
  /**
   * Why the walk that is running now was started (`manual`, `menu`, `interval`, `start/…`,
   * `reconcile`, `repair`), so the toolbar can name it for what it is.
   */
  syncReason?: string;
  /** What the site says the list holds, learned from the running walk's first page. */
  expectedTotal?: number;
  /** Set when the app has no usable session cookies. */
  needsAuth: boolean;
}

export type WatchLaterMutationResult =
  | { ok: true; inWatchLater: boolean }
  | { ok: false; error: string };

export interface WatchLaterSyncProgress {
  pages: number;
  items: number;
  totalItems?: number;
}

export interface WatchLaterProgressReport {
  videoId: string;
  positionSeconds: number;
  durationSeconds: number;
  ended?: boolean;
}
