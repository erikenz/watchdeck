import { t } from "@/i18n";
import { createPlugin } from "@/utils";

import { onConfigChange, onMainLoad, onMainUnload } from "./backend";
import { defaultConfig } from "./config";
import { menu } from "./menu";
import { renderer } from "./renderer";
import type { WatchLaterPluginConfig } from "./types";

import style from "./renderer/style.css?inline";

export type { WatchLaterPluginConfig } from "./types";

export default createPlugin<
  unknown,
  unknown,
  typeof renderer,
  WatchLaterPluginConfig
>({
  addedVersion: "0.2.0",
  backend: {
    onConfigChange,
    start: onMainLoad,
    stop: onMainUnload,
  },
  config: defaultConfig,
  description: () => t("plugins.watch-later.description"),
  menu,
  name: () => t("plugins.watch-later.name"),
  renderer,
  stylesheets: [style],
});
