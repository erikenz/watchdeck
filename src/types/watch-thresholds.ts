/**
 * What counts as watched, and what counts as "continue watching".
 *
 * These live in the app's own options (`options.watched`, `options.inProgress`) rather than in one
 * plugin's config, because more than one plugin asks the question: the Watch Later plugin buckets
 * its list with them, and the dimming plugin decides from them whether a card has been viewed. A
 * plugin that is disabled cannot own a setting another plugin needs.
 *
 * A threshold is either a percentage of the video or an amount of video, in the unit that fits the
 * rule being written; `inProgress.max` given in minutes counts *back from the end*, so "5" means
 * the last five minutes count as watched.
 */
export interface WatchThreshold {
  minutes?: number;
  percent?: number;
}

export interface WatchThresholds {
  /** Watched: at or above this. */
  watched: WatchThreshold;
  /** Continue watching: at or above `min`, still short of the thresholds above. */
  inProgress: { min: WatchThreshold; max: WatchThreshold };
}

export type WatchBucket = "watched" | "in-progress" | "unwatched";
