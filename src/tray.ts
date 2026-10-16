import PausedTrayIconWhite from "@assets/tray-paused-white.png?asset&asarUnpack";
import PausedTrayIcon from "@assets/tray-paused.png?asset&asarUnpack";
import TrayIconWhite from "@assets/tray-white.png?asset&asarUnpack";
import TrayIcon from "@assets/tray.png?asset&asarUnpack";
import { Menu, nativeImage, screen, Tray } from "electron";
import is from "electron-is";

import { APPLICATION_NAME, t } from "@/i18n";

import * as config from "./config";
import type { MenuTemplate } from "./menu";
import { restart } from "./providers/app-controls";
import { getVideoControls } from "./providers/video-controls";
import { registerCallback, VideoInfoEvent } from "./providers/video-info";

// Prevent tray being garbage collected
let tray: Electron.Tray | undefined;

type TrayEvent = (
  event: Electron.KeyboardEvent,
  bounds: Electron.Rectangle
) => void;

export const setTrayOnClick = (fn: TrayEvent) => {
  if (!tray) {
    return;
  }

  tray.removeAllListeners("click");
  tray.on("click", fn);
};

// Won't do anything on macOS since its disabled
export const setTrayOnDoubleClick = (fn: TrayEvent) => {
  if (!tray) {
    return;
  }

  tray.removeAllListeners("double-click");
  tray.on("double-click", fn);
};

export const setUpTray = (app: Electron.App, win: Electron.BrowserWindow) => {
  if (!config.get("options.tray")) {
    tray = undefined;
    return;
  }

  const { playPause, next, previous } = getVideoControls(win);

  const pixelRatio = is.windows()
    ? screen.getPrimaryDisplay().scaleFactor || 1
    : 1;

  const defaultTrayIcon = nativeImage
    .createFromPath(is.macOS() ? TrayIconWhite : TrayIcon)
    .resize({
      height: 16 * pixelRatio,
      width: 16 * pixelRatio,
    });
  const pausedTrayIcon = nativeImage
    .createFromPath(is.macOS() ? PausedTrayIconWhite : PausedTrayIcon)
    .resize({
      height: 16 * pixelRatio,
      width: 16 * pixelRatio,
    });

  tray = new Tray(defaultTrayIcon);

  tray.setToolTip(
    t("main.tray.tooltip.default", {
      applicationName: APPLICATION_NAME,
    })
  );

  // MacOS only
  tray.setIgnoreDoubleClickEvents(true);

  tray.on("click", () => {
    if (config.get("options.trayClickPlayPause")) {
      playPause();
    } else if (win.isVisible()) {
      win.hide();
      app.dock?.hide();
    } else {
      win.show();
      app.dock?.show();
    }
  });

  const template: MenuTemplate = [
    {
      click() {
        playPause();
      },
      label: t("main.tray.play-pause"),
    },
    {
      click() {
        next();
      },
      label: t("main.tray.next"),
    },
    {
      click() {
        previous();
      },
      label: t("main.tray.previous"),
    },
    {
      click() {
        win.show();
        app.dock?.show();
      },
      label: t("main.tray.show"),
    },
    { type: "separator" },
    {
      click: restart,
      label: t("main.tray.restart"),
    },
    { type: "separator" },
    {
      label: t("main.tray.quit"),
      role: "quit",
    },
  ];

  const trayMenu = Menu.buildFromTemplate(template);
  tray.setContextMenu(trayMenu);

  registerCallback((info, event) => {
    if (event === VideoInfoEvent.TimeChanged) {
      return;
    }

    if (tray) {
      if (info.videoId === "") {
        tray.setImage(defaultTrayIcon);
        return;
      }

      tray.setToolTip(
        t("main.tray.tooltip.with-song-info", {
          applicationName: APPLICATION_NAME,
          artist: info.channel,
          title: info.title,
        })
      );

      tray.setImage(info.isPaused ? pausedTrayIcon : defaultTrayIcon);
    }
  });
};
