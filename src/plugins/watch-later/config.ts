import type { WatchLaterPluginConfig } from "./types";

export const defaultConfig: WatchLaterPluginConfig = {
  enabled: true,
  syncOnStart: true,
  syncIntervalHours: 6,
  requestsPerSecond: 1,
  enrichMetadata: true,
  showHoverButton: true,
  showLibraryPanel: true,
  watched: { minutes: 0, percent: 90 },
  inProgress: { minMinutes: 2, minPercent: 5, maxPercent: 90 },
  activeAccountId: "",
};
