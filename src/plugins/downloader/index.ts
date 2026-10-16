import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { onConfigChange, onMainLoad } from './main';
import { onMenu } from './menu';
import { onPlayerApiReady, onRendererLoad } from './renderer';
import { DefaultPresetList } from './types';
import type { Preset } from './types';

import style from './style.css?inline';

export interface DownloaderPluginConfig {
  enabled: boolean;
  downloadFolder?: string;
  downloadOnFinish?: {
    enabled: boolean;
    seconds: number;
    percent: number;
    mode: 'percent' | 'seconds';
    folder?: string;
  };
  selectedPreset: string;
  customPresetSetting: Preset;
  skipExisting: boolean;
  playlistMaxItems?: number;
}

export const defaultConfig: DownloaderPluginConfig = {
  customPresetSetting: DefaultPresetList['mp3 (256kbps)'], // Presets
  downloadFolder: undefined,
  downloadOnFinish: {
    enabled: false,
    folder: undefined,
    mode: 'seconds',
    percent: 10,
    seconds: 20,
  },
  enabled: false,
  playlistMaxItems: undefined,
  selectedPreset: 'mp3 (256kbps)', // Selected preset
  skipExisting: false,
};

export default createPlugin({
  backend: {
    onConfigChange,
    start: onMainLoad,
  },
  config: defaultConfig,
  description: () => t('plugins.downloader.description'),
  menu: onMenu,
  name: () => t('plugins.downloader.name'),
  renderer: {
    onPlayerApiReady,
    start: onRendererLoad,
  },
  restartNeeded: true,
  stylesheets: [style],
});
