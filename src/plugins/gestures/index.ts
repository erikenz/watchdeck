import { t } from "@/i18n";
import { createPlugin } from "@/utils";

import { applyConfig, start, stop } from "./renderer";

import hudStyle from "./hud.css?inline";

export interface GesturesPluginConfig {
  enabled: boolean;
  /** Right-drag up/down changes the volume. */
  volume: boolean;
  /** Right-drag left/right seeks. */
  seek: boolean;
  /** Shift + right-drag up/down changes the playback speed. */
  speed: boolean;
  /** Right + wheel changes the volume. */
  wheelVolume: boolean;
  /** Volume percent per 100 px dragged. */
  volumePer100Px: number;
  /** Seconds of video per 100 px dragged. */
  seekSecondsPer100Px: number;
  /** Playback-rate change per 100 px dragged. */
  speedPer100Px: number;
  /** Volume percent per wheel notch. */
  wheelVolumeStep: number;
}

export const defaultConfig: GesturesPluginConfig = {
  enabled: true,
  seek: true,
  seekSecondsPer100Px: 30,
  speed: true,
  speedPer100Px: 0.5,
  volume: true,
  volumePer100Px: 25,
  wheelVolume: true,
  wheelVolumeStep: 5,
};

export default createPlugin<unknown, unknown, unknown, GesturesPluginConfig>({
  config: defaultConfig,
  description: () => t("plugins.gestures.description"),
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();

    const gesture = (
      key: "volume" | "seek" | "speed" | "wheelVolume",
      labelKey: string
    ): Electron.MenuItemConstructorOptions => ({
      checked: Boolean(config[key]),
      click(item) {
        void setConfig({ [key]: item.checked });
      },
      label: t(labelKey),
      type: "checkbox",
    });

    return [
      gesture("volume", "plugins.gestures.menu.volume-drag"),
      gesture("seek", "plugins.gestures.menu.seek-drag"),
      gesture("speed", "plugins.gestures.menu.speed-drag"),
      gesture("wheelVolume", "plugins.gestures.menu.wheel-volume"),
      { type: "separator" },
      {
        enabled: false,
        label: t("plugins.gestures.menu.sensitivity-hint"),
      },
    ];
  },
  name: () => t("plugins.gestures.name"),
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
  stylesheets: [hudStyle],
});
