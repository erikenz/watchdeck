import { t } from "@/i18n";
import { createPlugin } from "@/utils";

import { onConfigChange, onMainLoad } from "./main";
import { onMenu } from "./menu";
import { onPlayerApiReady } from "./renderer";

import style from "./style.css?inline";

export interface PictureInPicturePluginConfig {
  enabled: boolean;
  alwaysOnTop: boolean;
  savePosition: boolean;
  saveSize: boolean;
  hotkey: "P";
  "pip-position": [number, number];
  "pip-size": [number, number];
  isInPiP: boolean;
  useNativePiP: boolean;
}

export default createPlugin({
  backend: {
    onConfigChange,
    start: onMainLoad,
  },
  config: {
    enabled: false,
    alwaysOnTop: true,
    savePosition: true,
    saveSize: false,
    hotkey: "P",
    "pip-position": [10, 10],
    "pip-size": [450, 275],
    isInPiP: false,
    useNativePiP: true,
  },
  description: () => t("plugins.picture-in-picture.description"),
  menu: onMenu,
  name: () => t("plugins.picture-in-picture.name"),
  renderer: {
    onPlayerApiReady,
  },
  restartNeeded: true,
  stylesheets: [style],
});
