import { t } from "@/i18n";
import type { MenuContext } from "@/types/contexts";

import { syncNow } from "./backend";
import type { WatchLaterPluginConfig } from "./types";

/**
 * The levels the saved-card dimming offers. The numbers live next to the menu that sets them, and
 * the default (0.7, "slight") is above the dim-viewed plugin's default on purpose: a video saved
 * for later is faded less than one already watched.
 */
const SAVED_OPACITY_LEVELS = [
  [0.85, "slight"],
  [0.7, "medium"],
  [0.5, "strong"],
] as const;

export const menu = async ({
  getConfig,
  setConfig,
}: MenuContext<WatchLaterPluginConfig>) => {
  const config = await getConfig();

  const intervals = [
    [0, "off"],
    [15, "15m"],
    [60, "1h"],
    [360, "6h"],
    [1440, "24h"],
  ] as const;

  return [
    {
      click: () => {
        syncNow().catch(() => undefined);
      },
      label: t("plugins.watch-later.menu.sync-now"),
    },
    {
      label: t("plugins.watch-later.menu.sync-interval"),
      submenu: intervals.map(([minutes, key]) => ({
        checked: config.syncIntervalMinutes === minutes,
        click: () => {
          setConfig({ syncIntervalMinutes: minutes });
        },
        label: t(`plugins.watch-later.menu.interval.${key}`),
        type: "radio" as const,
      })),
    },
    { type: "separator" as const },
    {
      checked: config.enhancePage,
      click: () => setConfig({ enhancePage: !config.enhancePage }),
      label: t("plugins.watch-later.menu.enhance-page"),
      type: "checkbox" as const,
    },
    {
      checked: config.showHoverButton,
      click: () => setConfig({ showHoverButton: !config.showHoverButton }),
      label: t("plugins.watch-later.menu.hover-button"),
      type: "checkbox" as const,
    },
    {
      checked: config.dimSaved,
      click: () => setConfig({ dimSaved: !config.dimSaved }),
      label: t("plugins.watch-later.menu.dim-saved"),
      type: "checkbox" as const,
    },
    {
      enabled: config.dimSaved,
      label: t("plugins.watch-later.menu.dim-saved-opacity"),
      submenu: SAVED_OPACITY_LEVELS.map(([opacity, key]) => ({
        checked: config.savedOpacity === opacity,
        click: () => setConfig({ savedOpacity: opacity }),
        label: t(`plugins.watch-later.menu.level.${key}`),
        type: "radio" as const,
      })),
    },
    {
      checked: config.syncOnStart,
      click: () => setConfig({ syncOnStart: !config.syncOnStart }),
      label: t("plugins.watch-later.menu.sync-on-start"),
      type: "checkbox" as const,
    },
    {
      checked: config.enrichMetadata,
      click: () => setConfig({ enrichMetadata: !config.enrichMetadata }),
      label: t("plugins.watch-later.menu.enrich-metadata"),
      type: "checkbox" as const,
    },
  ];
};
