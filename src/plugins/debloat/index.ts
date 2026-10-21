import { t } from "@/i18n";
import { createPlugin } from "@/utils";

import { applyConfig, start, stop } from "./renderer";

import style from "./style.css?inline";

export interface DebloatPluginConfig {
  enabled: boolean;
  /** Hide the Shorts shelf, wherever the site shows one. */
  hideShortsShelf: boolean;
}

export const defaultConfig: DebloatPluginConfig = {
  // Off by default on purpose: this is a preference about the site's own layout, not a fix for
  // anything, and the site is what the app is for.
  enabled: false,
  hideShortsShelf: true,
};

export default createPlugin<unknown, unknown, unknown, DebloatPluginConfig>({
  addedVersion: "0.1.3",
  config: defaultConfig,
  description: () => t("plugins.debloat.description"),
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();

    return [
      {
        checked: config.hideShortsShelf,
        click: () => setConfig({ hideShortsShelf: !config.hideShortsShelf }),
        label: t("plugins.debloat.menu.shorts-shelf"),
        type: "checkbox" as const,
      },
    ];
  },
  name: () => t("plugins.debloat.name"),
  renderer: {
    async start({ getConfig }) {
      start(await getConfig());
    },
    stop() {
      stop();
    },
    onConfigChange(newConfig) {
      applyConfig(newConfig);
    },
  },
  restartNeeded: false,
  stylesheets: [style],
});
