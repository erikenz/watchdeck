import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { onConfigChange, onMainLoad } from './main';
import { onMenu } from './menu';

export interface NotificationsPluginConfig {
  enabled: boolean;
  unpauseNotification: boolean;
  /**
   * Has effect only on Linux
   */
  urgency: 'low' | 'normal' | 'critical';
  /**
   * the following has effect only on Windows
   */
  interactive: boolean;
  /**
   * See plugins/notifications/utils for more info
   */
  toastStyle: number;
  refreshOnPlayPause: boolean;
  trayControls: boolean;
  hideButtonText: boolean;
}

export const defaultConfig: NotificationsPluginConfig = {
  enabled: false,
  hideButtonText: false,
  interactive: true,
  refreshOnPlayPause: false,
  toastStyle: 1,
  trayControls: true,
  unpauseNotification: false,
  urgency: 'normal',
};

export default createPlugin({
  backend: {
    onConfigChange,
    start: onMainLoad,
  },
  config: defaultConfig,
  description: () => t('plugins.notifications.description'),
  menu: onMenu,
  name: () => t('plugins.notifications.name'),
  restartNeeded: true,
});
