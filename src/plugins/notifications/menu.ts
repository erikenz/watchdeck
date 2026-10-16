import type { MenuItem } from "electron";
import is from "electron-is";

import { t } from "@/i18n";
import type { MenuTemplate } from "@/menu";
import type { MenuContext } from "@/types/contexts";

import type { NotificationsPluginConfig } from "./index";
import { snakeToCamel, ToastStyles, urgencyLevels } from "./utils";

export const onMenu = async ({
  getConfig,
  setConfig,
}: MenuContext<NotificationsPluginConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();

  const getToastStyleMenuItems = (options: NotificationsPluginConfig) => {
    const array = Array.from({ length: Object.keys(ToastStyles).length });

    // ToastStyles index starts from 1
    for (const [name, index] of Object.entries(ToastStyles)) {
      array[index - 1] = {
        checked: options.toastStyle === index,
        click: () => setConfig({ toastStyle: index }),
        label: snakeToCamel(name),
        type: "radio",
      } satisfies Electron.MenuItemConstructorOptions;
    }

    return array as Electron.MenuItemConstructorOptions[];
  };

  const getMenu = (): MenuTemplate => {
    if (is.linux()) {
      return [
        {
          label: t("plugins.notifications.menu.priority"),
          submenu: urgencyLevels.map((level) => ({
            checked: config.urgency === level.value,
            click: () => setConfig({ urgency: level.value }),
            label: level.name,
            type: "radio",
          })),
        },
      ];
    } else if (is.windows()) {
      return [
        {
          label: t("plugins.notifications.menu.interactive"),
          type: "checkbox",
          checked: config.interactive,
          // Doesn't update until restart
          click: (item: MenuItem) => setConfig({ interactive: item.checked }),
        },
        {
          // Submenu with settings for interactive notifications (name shouldn't be too long)
          label: t("plugins.notifications.menu.interactive-settings.label"),
          submenu: [
            {
              checked: config.trayControls,
              click: (item: MenuItem) =>
                setConfig({ trayControls: item.checked }),
              label: t(
                "plugins.notifications.menu.interactive-settings.submenu.tray-controls"
              ),
              type: "checkbox",
            },
            {
              checked: config.hideButtonText,
              click: (item: MenuItem) =>
                setConfig({ hideButtonText: item.checked }),
              label: t(
                "plugins.notifications.menu.interactive-settings.submenu.hide-button-text"
              ),
              type: "checkbox",
            },
            {
              checked: config.refreshOnPlayPause,
              click: (item: MenuItem) =>
                setConfig({ refreshOnPlayPause: item.checked }),
              label: t(
                "plugins.notifications.menu.interactive-settings.submenu.refresh-on-play-pause"
              ),
              type: "checkbox",
            },
          ],
        },
        {
          label: t("plugins.notifications.menu.toast-style"),
          submenu: getToastStyleMenuItems(config),
        },
      ];
    }
    return [];
  };

  return [
    ...getMenu(),
    {
      checked: config.unpauseNotification,
      click: (item) => setConfig({ unpauseNotification: item.checked }),
      label: t("plugins.notifications.menu.unpause-notification"),
      type: "checkbox",
    },
  ];
};
