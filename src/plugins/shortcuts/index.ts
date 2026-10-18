import { t } from "@/i18n";
import { createPlugin } from "@/utils";

import { onConfigChange, onMainLoad, onMainStop } from "./main";
import { onMenu } from "./menu";

export interface ShortcutMappingType {
  previous: string;
  playPause: string;
  next: string;
}
export interface ShortcutsPluginConfig {
  enabled: boolean;
  overrideMediaKeys: boolean;
  global: ShortcutMappingType;
  local: ShortcutMappingType;
}

/**
 * Playback shortcuts, and MPRIS on Linux (docs/PRD.md §R5).
 *
 * Two sets of keybinds, because they answer different questions: **global** ones are registered with
 * the desktop and work from any application, **local** ones only while this window has focus. Both
 * are configured from the plugin's menu, and both take effect at once - nothing here needs a
 * restart.
 */
export default createPlugin({
  backend: {
    onConfigChange,
    start: onMainLoad,
    stop: onMainStop,
  },
  config: {
    enabled: false,
    overrideMediaKeys: false,
    global: {
      previous: "",
      playPause: "",
      next: "",
    },
    local: {
      previous: "",
      playPause: "",
      next: "",
    },
  },
  description: () => t("plugins.shortcuts.description"),
  menu: onMenu,
  name: () => t("plugins.shortcuts.name"),
  restartNeeded: false,
});
