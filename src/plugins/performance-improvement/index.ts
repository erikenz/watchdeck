import { t } from "@/i18n";
import { createPlugin } from "@/utils";

import { injectCpuTamer } from "./scripts/cpu-tamer";
import { injectRm3 } from "./scripts/rm3";

export default createPlugin({
  addedVersion: "3.9.X",
  config: {
    enabled: true,
  },
  description: () => t("plugins.performance-improvement.description"),
  name: () => t("plugins.performance-improvement.name"),
  renderer() {
    injectRm3();
    injectCpuTamer();
  },
  restartNeeded: true,
});
