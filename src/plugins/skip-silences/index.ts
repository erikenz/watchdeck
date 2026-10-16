import { t } from "@/i18n";
import { createPlugin } from "@/utils";

import { onRendererLoad, onRendererUnload } from "./renderer";

export interface SkipSilencesPluginConfig {
  enabled: boolean;
  onlySkipBeginning: boolean;
}

export default createPlugin({
  config: {
    enabled: false,
    onlySkipBeginning: false,
  },
  description: () => t("plugins.skip-silences.description"),
  name: () => t("plugins.skip-silences.name"),
  renderer: {
    start: onRendererLoad,
    stop: onRendererUnload,
  },
  restartNeeded: true,
});
