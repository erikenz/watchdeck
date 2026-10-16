import prompt from 'custom-electron-prompt';
import { StatusDisplayType } from 'discord-api-types/v10';

import { setMenuOptions } from '@/config/plugins';
import { APPLICATION_NAME, t } from '@/i18n';
import type { MenuTemplate } from '@/menu';
import { singleton } from '@/providers/decorators';
import promptOptions from '@/providers/prompt-options';
import type { MenuContext } from '@/types/contexts';

import type { DiscordPluginConfig } from './index';
import { discordService } from './main';

const registerRefreshOnce = singleton((refreshMenu: () => void) => {
  discordService?.registerRefreshCallback(refreshMenu);
});

const DiscordStatusDisplayTypeLabels: Record<StatusDisplayType, string> = {
  [StatusDisplayType.Name]:
    'plugins.discord.menu.set-status-display-type.submenu.application',
  [StatusDisplayType.State]:
    'plugins.discord.menu.set-status-display-type.submenu.artist',
  [StatusDisplayType.Details]:
    'plugins.discord.menu.set-status-display-type.submenu.title',
};

export const onMenu = async ({
  window,
  getConfig,
  setConfig,
  refresh,
}: MenuContext<DiscordPluginConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();
  registerRefreshOnce(refresh);

  return [
    {
      click: () => discordService?.connect(true),
      enabled: !discordService?.isConnected(),
      label: discordService?.isConnected()
        ? t('plugins.discord.menu.connected')
        : t('plugins.discord.menu.disconnected'),
    },
    {
      checked: config.autoReconnect,
      click(item: Electron.MenuItem) {
        setConfig({
          autoReconnect: item.checked,
        });
      },
      label: t('plugins.discord.menu.auto-reconnect'),
      type: 'checkbox',
    },
    {
      click: () => discordService?.clearActivity(),
      label: t('plugins.discord.menu.clear-activity'),
    },
    {
      checked: config.activityTimeoutEnabled,
      click(item: Electron.MenuItem) {
        setConfig({
          activityTimeoutEnabled: item.checked,
        });
      },
      label: t('plugins.discord.menu.clear-activity-after-timeout'),
      type: 'checkbox',
    },
    {
      checked: config.playOnYouTubeMusic,
      click(item: Electron.MenuItem) {
        setConfig({
          'playOn\u0059\u006f\u0075\u0054\u0075\u0062\u0065Music': item.checked,
        });
      },
      label: t('plugins.discord.menu.play-on-application'),
      type: 'checkbox',
    },
    {
      checked: config.hideGitHubButton,
      click(item: Electron.MenuItem) {
        setConfig({
          hideGitHubButton: item.checked,
        });
      },
      label: t('plugins.discord.menu.hide-github-button'),
      type: 'checkbox',
    },
    {
      checked: config.hideDurationLeft,
      click(item: Electron.MenuItem) {
        setConfig({
          hideDurationLeft: item.checked,
        });
      },
      label: t('plugins.discord.menu.hide-duration-left'),
      type: 'checkbox',
    },
    {
      click: async () => setInactivityTimeout(window, config),
      label: t('plugins.discord.menu.set-inactivity-timeout'),
    },
    {
      label: t('plugins.discord.menu.set-status-display-type.label'),
      submenu: Object.values(StatusDisplayType)
        .filter(
          (v) => typeof StatusDisplayType[v as StatusDisplayType] !== 'number',
        )
        .map((statusDisplayType) => ({
          checked: config.statusDisplayType === statusDisplayType,
          click() {
            setConfig({
              statusDisplayType: statusDisplayType as StatusDisplayType,
            });
          },
          label: t(
            DiscordStatusDisplayTypeLabels[
              statusDisplayType as StatusDisplayType
            ],
            {
              applicationName: APPLICATION_NAME,
            },
          ),
          type: 'radio',
        })),
    },
  ];
};

async function setInactivityTimeout(
  win: Electron.BrowserWindow,
  options: DiscordPluginConfig,
) {
  const output = await prompt(
    {
      counterOptions: { minimum: 0, multiFire: true },
      label: t('plugins.discord.prompt.set-inactivity-timeout.label'),
      title: t('plugins.discord.prompt.set-inactivity-timeout.title'),
      type: 'counter',
      value: String(Math.round((options.activityTimeoutTime ?? 0) / 1e3)),
      width: 450,
      ...promptOptions(),
    },
    win,
  );

  if (output) {
    options.activityTimeoutTime = Math.round(~~output * 1e3);
    setMenuOptions('discord', options);
  }
}
