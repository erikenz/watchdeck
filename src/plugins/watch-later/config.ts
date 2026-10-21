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
};
