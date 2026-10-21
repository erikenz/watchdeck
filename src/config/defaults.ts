import type { WatchThresholds } from "@/types/watch-thresholds";

export interface WindowSizeConfig {
  width: number;
  height: number;
}

export interface WindowPositionConfig {
  x: number;
  y: number;
}

export interface DefaultConfig {
  "window-size": WindowSizeConfig;
  "window-maximized": boolean;
  "window-position": WindowPositionConfig;
  url: string;
  options: {
    language?: string;
    tray: boolean;
    appVisible: boolean;
    autoUpdates: boolean;
    alwaysOnTop: boolean;
    hideMenu: boolean;
    hideMenuWarned: boolean;
    startAtLogin: boolean;
    disableHardwareAcceleration: boolean;
    restartOnConfigChanges: boolean;
    trayClickPlayPause: boolean;
    autoResetAppCache: boolean;
    resumeOnStart: boolean;
    proxy: string;
    startingPage: string;
    overrideUserAgent: boolean;
    themes: string[];
    customWindowTitle?: string;
    /**
     * What counts as watched, and as "continue watching". Shared by the plugins that ask the
     * question (Watch Later's buckets, the dimming of viewed cards); see
     * `src/types/watch-thresholds.ts` for the units.
     */
    watched: WatchThresholds["watched"];
    inProgress: WatchThresholds["inProgress"];
  };
  plugins: Record<string, unknown>;
}

export const defaultConfig: DefaultConfig = {
  options: {
    tray: false,
    appVisible: true,
    // no update feed is configured yet (see docs/PRD.md §R8): the inherited
    // updater pointed at the upstream project's releases
    autoUpdates: false,
    alwaysOnTop: false,
    hideMenu: false,
    hideMenuWarned: false,
    startAtLogin: false,
    disableHardwareAcceleration: false,
    restartOnConfigChanges: false,
    trayClickPlayPause: false,
    autoResetAppCache: false,
    resumeOnStart: true,
    proxy: "",
    startingPage: "",
    overrideUserAgent: false,
    themes: [],
    // Watched: 90% of the video or more, or the site's own watched badge.
    watched: { percent: 90 },
    // Continue watching: past 5% or 2 minutes of video, and still short of the rules above.
    // A `max` given in minutes would mean "the last n minutes count as watched".
    inProgress: { min: { minutes: 2, percent: 5 }, max: { percent: 90 } },
  },
  plugins: {},
  url: "https://www.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com",
  "window-maximized": false,
  "window-position": {
    x: -1,
    y: -1,
  },
  "window-size": {
    height: 550,
    width: 1100,
  },
};
