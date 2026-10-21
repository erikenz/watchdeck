import type { WatchLaterPluginConfig } from "./types";

export const defaultConfig: WatchLaterPluginConfig = {
  enabled: true,
  syncOnStart: true,
  // Every 6 hours unless configured otherwise; 0 means "only when I ask".
  syncIntervalMinutes: 360,
  requestsPerSecond: 1,
  enrichMetadata: true,
  showHoverButton: true,
  enhancePage: true,
  // Saved videos fade a little, watched ones fade more (that one is the dim-viewed plugin's).
  dimSaved: true,
  savedOpacity: 0.7,
  // Watched: 90% of the video or more, or the site's own watched badge.
  watched: { percent: 90 },
  // Continue watching: past 5% or 2 minutes of video, and still short of the rules above.
  // A `max` given in minutes would mean "the last n minutes count as watched".
  inProgress: { min: { minutes: 2, percent: 5 }, max: { percent: 90 } },
};
