import { deepmerge } from 'deepmerge-ts';
import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { allPlugins, mainPlugins } from 'virtual:plugins';

import * as config from '@/config';
import { t } from '@/i18n';
import type { BackendContext } from '@/types/contexts';
import type { PluginConfig, PluginDef } from '@/types/plugins';
import { LoggerPrefix, startPlugin, stopPlugin } from '@/utils';

const loadedPluginMap: Record<
  string,
  PluginDef<unknown, unknown, unknown>
> = {};

const createContext = (
  id: string,
  win: BrowserWindow,
): BackendContext<PluginConfig> => ({
  getConfig: async () =>
    deepmerge(
      (await allPlugins())[id].config ?? { enabled: false },
      config.get(`plugins.${id}`) ?? {},
    ) as PluginConfig,
  ipc: {
    handle: (event: string, listener: CallableFunction) => {
      // oxlint-disable-next-line typescript/no-unsafe-return,typescript/no-unsafe-call
      ipcMain.handle(event, (_, ...args: unknown[]) => listener(...args));
    },
    on: (event: string, listener: CallableFunction) => {
      ipcMain.on(event, (_, ...args: unknown[]) => {
        // oxlint-disable-next-line typescript/no-unsafe-call
        listener(...args);
      });
    },
    removeHandler: (event: string) => {
      ipcMain.removeHandler(event);
    },
    send: (event: string, ...args: unknown[]) => {
      win.webContents.send(event, ...args);
    },
  },
  setConfig: async (newConfig) => {
    config.setPartial(
      `plugins.${id}`,
      newConfig,
      (await allPlugins())[id].config,
    );
  },
  window: win,
});

export const forceUnloadMainPlugin = async (
  id: string,
  win: BrowserWindow,
): Promise<void> => {
  const plugin = loadedPluginMap[id];
  if (!plugin) {
    return;
  }

  try {
    const hasStopped = await stopPlugin(id, plugin, {
      context: createContext(id, win),
      ctx: 'backend',
    });
    if (
      hasStopped ||
      (hasStopped === null &&
        typeof plugin.backend !== 'function' &&
        plugin.backend)
    ) {
      delete loadedPluginMap[id];
      console.log(
        LoggerPrefix,
        t('common.console.plugins.unloaded', { pluginName: id }),
      );
      return;
    }
    const message = t('common.console.plugins.unload-failed', {
      pluginName: id,
    });
    console.log(LoggerPrefix, message);
    return Promise.reject(new Error(message));
  } catch (error) {
    console.error(
      LoggerPrefix,
      t('common.console.plugins.unload-failed', { pluginName: id }),
    );
    console.trace(error);
    return await Promise.reject(error);
  }
};

export const forceLoadMainPlugin = async (
  id: string,
  win: BrowserWindow,
): Promise<void> => {
  const plugin = (await mainPlugins())[id];
  if (!plugin) {
    return;
  }

  try {
    const hasStarted = await startPlugin(id, plugin, {
      context: createContext(id, win),
      ctx: 'backend',
    });
    if (
      hasStarted ||
      (hasStarted === null &&
        typeof plugin.backend !== 'function' &&
        plugin.backend)
    ) {
      loadedPluginMap[id] = plugin;
    } else {
      const message = t('common.console.plugins.load-failed', {
        pluginName: id,
      });
      console.log(LoggerPrefix, message);
      return Promise.reject(new Error(message));
    }
  } catch (error) {
    console.error(
      LoggerPrefix,
      t('common.console.plugins.initialize-failed', { pluginName: id }),
    );
    console.trace(error);
    return await Promise.reject(error);
  }
};

export const loadAllMainPlugins = async (win: BrowserWindow) => {
  console.log(LoggerPrefix, t('common.console.plugins.load-all'));
  const pluginConfigs = config.plugins.getPlugins();
  const queue: Promise<void>[] = [];

  for (const [plugin, pluginDef] of Object.entries(await mainPlugins())) {
    const config = deepmerge(pluginDef.config, pluginConfigs[plugin] ?? {});
    if (config.enabled) {
      queue.push(forceLoadMainPlugin(plugin, win));
    } else if (loadedPluginMap[plugin]) {
      queue.push(forceUnloadMainPlugin(plugin, win));
    }
  }

  await Promise.allSettled(queue);
};

export const unloadAllMainPlugins = async (win: BrowserWindow) => {
  for (const id of Object.keys(loadedPluginMap)) {
    await forceUnloadMainPlugin(id, win);
  }
};

export const getLoadedMainPlugin = (
  id: string,
): PluginDef<unknown, unknown, unknown> | undefined => loadedPluginMap[id];

export const getAllLoadedMainPlugins = () => loadedPluginMap;
