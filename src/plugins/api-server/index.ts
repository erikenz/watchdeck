import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './backend';
import { defaultAPIServerConfig } from './config';
import { onMenu } from './menu';

export default createPlugin({
  addedVersion: '3.6.X',
  backend,
  config: defaultAPIServerConfig,
  description: () => t('plugins.api-server.description'),
  menu: onMenu,
  name: () => t('plugins.api-server.name'),
  restartNeeded: false,
});
