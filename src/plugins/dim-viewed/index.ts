import { t } from "@/i18n";
import { createPlugin } from "@/utils";

import { applyConfig, start, stop } from "./renderer";

import style from "./style.css?inline";

export interface DimViewedPluginConfig {
  enabled: boolean;
  /** Opacity of a card whose video the site marks as watched or partly watched, 0-1. */
  opacity: number;
}

/**
 * The levels the menu offers. The numbers live here and not in the menu so that the default and
 * the choices cannot drift apart.
 */
export const OPACITY_LEVELS = [
  [0.7, "slight"],
  [0.45, "medium"],
  [0.25, "strong"],
] as const;

export const defaultConfig: DimViewedPluginConfig = {
  enabled: true,
  // Noticeable at a glance without making the card unreadable.
  opacity: 0.45,
};

export default createPlugin<unknown, unknown, unknown, DimViewedPluginConfig>({
  addedVersion: "0.1.2",
  config: defaultConfig,
  description: () => t("plugins.dim-viewed.description"),
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();

    return [
      {
        label: t("plugins.dim-viewed.menu.opacity"),
        submenu: OPACITY_LEVELS.map(([opacity, key]) => ({
          checked: config.opacity === opacity,
          click: () => setConfig({ opacity }),
          label: t(`plugins.dim-viewed.menu.level.${key}`),
          type: "radio" as const,
        })),
      },
    ];
  },
  name: () => t("plugins.dim-viewed.name"),
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
