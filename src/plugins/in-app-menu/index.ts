import { t } from "@/i18n";
import { createPlugin } from "@/utils";

import { defaultInAppMenuConfig } from "./constants";
import { onMainLoad } from "./main";
import { onMenu } from "./menu";
import { onConfigChange, onPlayerApiReady, onRendererLoad } from "./renderer";

import titlebarStyle from "./titlebar.css?inline";

export default createPlugin({
  backend: onMainLoad,
  config: defaultInAppMenuConfig,
  description: () => t("plugins.in-app-menu.description"),
  menu: onMenu,
  name: () => t("plugins.in-app-menu.name"),
  renderer: {
    onConfigChange,
    onPlayerApiReady,
    start: onRendererLoad,
  },
  restartNeeded: true,
  stylesheets: [titlebarStyle],
});
