import prompt from "custom-electron-prompt";
import type { BrowserWindow } from "electron";

import { t } from "@/i18n";
import type { MenuTemplate } from "@/menu";
import promptOptions from "@/providers/prompt-options";
import type { MenuContext } from "@/types/contexts";

import type { ScrobblerPluginConfig } from "./index";
import { backend } from "./main";
import type { SetConfType } from "./main";

async function promptLastFmOptions(
  options: ScrobblerPluginConfig,
  setConfig: SetConfType,
  window: BrowserWindow
) {
  const output = await prompt(
    {
      height: 360,
      label: t("plugins.scrobbler.menu.lastfm.api-settings"),
      multiInputOptions: [
        {
          label: t("plugins.scrobbler.prompt.lastfm.api-key"),
          value: options.scrobblers.lastfm?.apiKey,
          inputAttrs: {
            type: "text",
          },
        },
        {
          label: t("plugins.scrobbler.prompt.lastfm.api-secret"),
          value: options.scrobblers.lastfm?.secret,
          inputAttrs: {
            type: "text",
          },
        },
      ],
      resizable: true,
      title: t("plugins.scrobbler.menu.lastfm.api-settings"),
      type: "multiInput",
      ...promptOptions(),
    },
    window
  );

  if (output) {
    if (output[0]) {
      options.scrobblers.lastfm.apiKey = output[0];
    }

    if (output[1]) {
      options.scrobblers.lastfm.secret = output[1];
    }

    setConfig(options);
  }
}

async function promptListenbrainzOptions(
  options: ScrobblerPluginConfig,
  setConfig: SetConfType,
  window: BrowserWindow
) {
  const output = await prompt(
    {
      label: t("plugins.scrobbler.prompt.listenbrainz.token.label"),
      title: t("plugins.scrobbler.prompt.listenbrainz.token.title"),
      type: "input",
      value: options.scrobblers.listenbrainz?.token,
      ...promptOptions(),
    },
    window
  );

  if (output) {
    options.scrobblers.listenbrainz.token = output;
    setConfig(options);
  }
}

export const onMenu = async ({
  window,
  getConfig,
  setConfig,
}: MenuContext<ScrobblerPluginConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();

  return [
    {
      label: "Last.fm",
      submenu: [
        {
          checked: Boolean(config.scrobblers.lastfm?.enabled),
          click(item) {
            backend.toggleScrobblers(config, window);
            config.scrobblers.lastfm.enabled = item.checked;
            setConfig(config);
          },
          label: t("main.menu.plugins.enabled"),
          type: "checkbox",
        },
        {
          click() {
            promptLastFmOptions(config, setConfig, window);
          },
          label: t("plugins.scrobbler.menu.lastfm.api-settings"),
        },
      ],
    },
    {
      label: "ListenBrainz",
      submenu: [
        {
          checked: Boolean(config.scrobblers.listenbrainz?.enabled),
          click(item) {
            backend.toggleScrobblers(config, window);
            config.scrobblers.listenbrainz.enabled = item.checked;
            setConfig(config);
          },
          label: t("main.menu.plugins.enabled"),
          type: "checkbox",
        },
        {
          click() {
            promptListenbrainzOptions(config, setConfig, window);
          },
          label: t("plugins.scrobbler.menu.listenbrainz.token"),
        },
      ],
    },
  ];
};
