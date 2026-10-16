import { deepmerge } from "deepmerge-ts";
import type { BrowserWindow, MenuItemConstructorOptions } from "electron";
import { allPlugins } from "virtual:plugins";

import * as config from "@/config";
import { t } from "@/i18n";
import { setApplicationMenu } from "@/menu";
import type { MenuContext } from "@/types/contexts";
import type { PluginConfig } from "@/types/plugins";
import { LoggerPrefix } from "@/utils";

const menuTemplateMap: Record<string, MenuItemConstructorOptions[]> = {};
const createContext = (
  id: string,
  win: BrowserWindow
): MenuContext<PluginConfig> => ({
  getConfig: async () =>
    deepmerge(
      (await allPlugins())[id].config ?? { enabled: false },
      config.get(`plugins.${id}`) ?? {}
    ) as PluginConfig,
  refresh: async () => {
    await setApplicationMenu(win);

    if (await config.plugins.isEnabled("in-app-menu")) {
      win.webContents.send("refresh-in-app-menu");
    }
  },
  setConfig: async (newConfig) => {
    config.setPartial(
      `plugins.${id}`,
      newConfig,
      (await allPlugins())[id].config
    );
  },
  window: win,
});

export const forceLoadMenuPlugin = async (id: string, win: BrowserWindow) => {
  try {
    const plugin = (await allPlugins())[id];
    if (!plugin) {
      return;
    }

    const menu = plugin.menu?.(createContext(id, win));
    if (menu) {
      const result = await menu;
      if (result.length > 0) {
        menuTemplateMap[id] = result;
      } else {
        return;
      }
    } else {
      return;
    }

    console.log(
      LoggerPrefix,
      t("common.console.plugins.loaded", { pluginName: `${id}::menu` })
    );
  } catch (error) {
    console.error(
      LoggerPrefix,
      t("common.console.plugins.initialize-failed", {
        pluginName: `${id}::menu`,
      })
    );
    console.trace(error);
  }
};

export const loadAllMenuPlugins = async (win: BrowserWindow) => {
  const pluginConfigs = config.plugins.getPlugins();

  for (const [pluginId, pluginDef] of Object.entries(await allPlugins())) {
    const config = deepmerge(
      pluginDef.config ?? { enabled: false },
      pluginConfigs[pluginId] ?? {}
    );

    if (config.enabled) {
      await forceLoadMenuPlugin(pluginId, win);
    }
  }
};

export const getMenuTemplate = (
  id: string
): MenuItemConstructorOptions[] | undefined => menuTemplateMap[id];

export const getAllMenuTemplate = () => menuTemplateMap;
