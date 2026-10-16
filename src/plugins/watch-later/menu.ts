import { t } from "@/i18n";
import type { MenuContext } from "@/types/contexts";

import { listAccounts, syncNow, switchAccount } from "./backend";
import type { WatchLaterPluginConfig } from "./types";

export const menu = async ({
  getConfig,
  setConfig,
}: MenuContext<WatchLaterPluginConfig>) => {
  const config = await getConfig();
  const accounts = listAccounts();

  return [
    {
      click: () => {
        syncNow().catch(() => undefined);
      },
      label: t("plugins.watch-later.menu.sync-now"),
    },
    ...(accounts.length > 1
      ? [
          {
            label: t("plugins.watch-later.menu.account"),
            submenu: accounts.map((account) => ({
              checked: config.activeAccountId === account.id,
              click: () => {
                switchAccount(account.id).catch(() => undefined);
              },
              label: account.handle
                ? `${account.name} (${account.handle})`
                : account.name,
              type: "radio" as const,
            })),
          },
        ]
      : []),
    { type: "separator" as const },
    {
      checked: config.showHoverButton,
      click: () => setConfig({ showHoverButton: !config.showHoverButton }),
      label: t("plugins.watch-later.menu.hover-button"),
      type: "checkbox" as const,
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
