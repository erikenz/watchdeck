import { t } from "@/i18n";
import { createPlugin } from "@/utils";

import { onPlayerApiReady, onUnload } from "./renderer";

export default createPlugin({
  config: {
    enabled: false,
  },
  description: () => t("plugins.playback-speed.description"),
  name: () => t("plugins.playback-speed.name"),
  renderer: {
    onPlayerApiReady,
    stop: onUnload,
  },
  restartNeeded: false,
});
