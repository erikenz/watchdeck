import { t } from "@/i18n";
import { createPlugin } from "@/utils";

import { backend } from "./main";
import { onMenu } from "./menu";

export interface ScrobblerPluginConfig {
  enabled: boolean;
  scrobblers: {
    lastfm: {
      /**
       * Enable Last.fm scrobbling
       *
       * @default false
       */
      enabled: boolean;
      /**
       * Token used for authentication
       */
      token: string | undefined;
      /**
       * Session key used for scrobbling
       */
      sessionKey: string | undefined;
      /**
       * Root of the Last.fm API
       *
       * @default 'http://ws.audioscrobbler.com/2.0/'
       */
      apiRoot: string;
      /**
       * Last.fm api key registered by @semvis123
       *
       * @default '04d76faaac8726e60988e14c105d421a'
       */
      apiKey: string;
      /**
       * Last.fm api secret registered by @semvis123
       *
       * @default 'a5d2a36fdf64819290f6982481eaffa2'
       */
      secret: string;
    };
    listenbrainz: {
      /**
       * Enable ListenBrainz scrobbling
       *
       * @default false
       */
      enabled: boolean;
      /**
       * Listenbrainz user token
       */
      token: string | undefined;
      /**
       * Root of the ListenBrainz API
       *
       * @default 'https://api.listenbrainz.org/1/'
       */
      apiRoot: string;
    };
  };
}

export const defaultConfig: ScrobblerPluginConfig = {
  enabled: false,
  scrobblers: {
    lastfm: {
      apiKey: "04d76faaac8726e60988e14c105d421a",
      apiRoot: "https://ws.audioscrobbler.com/2.0/",
      enabled: false,
      secret: "a5d2a36fdf64819290f6982481eaffa2",
      sessionKey: undefined,
      token: undefined,
    },
    listenbrainz: {
      apiRoot: "https://api.listenbrainz.org/1/",
      enabled: false,
      token: undefined,
    },
  },
};

export default createPlugin({
  backend,
  config: defaultConfig,
  description: () => t("plugins.scrobbler.description"),
  menu: onMenu,
  name: () => t("plugins.scrobbler.name"),
  restartNeeded: true,
});
