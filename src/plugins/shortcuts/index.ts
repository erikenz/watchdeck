import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { onMainLoad } from './main';
import { onMenu } from './menu';

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

export default createPlugin({
  backend: onMainLoad,
  config: {
    enabled: false,
    overrideMediaKeys: false,
    global: {
      previous: '',
      playPause: '',
      next: '',
    },
    local: {
      previous: '',
      playPause: '',
      next: '',
    },
  },
  description: () => t('plugins.shortcuts.description'),
  menu: onMenu,
  name: () => t('plugins.shortcuts.name'),
  restartNeeded: true,
});
