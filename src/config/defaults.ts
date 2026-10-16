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
