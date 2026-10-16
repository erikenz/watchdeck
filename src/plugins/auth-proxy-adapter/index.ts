import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { backend } from './backend';
import { defaultAuthProxyConfig } from './config';
import { onMenu } from './menu';

export default createPlugin({
  addedVersion: '3.10.X',
  backend,
  config: defaultAuthProxyConfig,
  description: () => t('plugins.auth-proxy-adapter.description'),
  menu: onMenu,
  name: () => t('plugins.auth-proxy-adapter.name'),
  restartNeeded: true,
});
