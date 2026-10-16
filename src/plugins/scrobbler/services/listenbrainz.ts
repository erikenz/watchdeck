import { net } from "electron";

import { APPLICATION_NAME } from "@/i18n";
import type { VideoInfo } from "@/types/video-info";

import type { ScrobblerPluginConfig } from "../index";
import type { SetConfType } from "../main";
import { ScrobblerBase } from "./base";

interface ListenbrainzRequestBody {
  listen_type?: string;
  payload: {
    track_metadata?: {
      artist_name?: string;
      track_name?: string;
      release_name?: string;
      additional_info?: {
        media_player?: string;
        submission_client?: string;
        origin_url?: string;
        duration?: number;
      };
    };
    listened_at?: number;
  }[];
}

export class ListenbrainzScrobbler extends ScrobblerBase {
  override isSessionCreated(): boolean {
    return true;
  }

  override async createSession(
    config: ScrobblerPluginConfig,
    _setConfig: SetConfType
  ): Promise<ScrobblerPluginConfig> {
    return Promise.resolve(config);
  }

  override setNowPlaying(
    songInfo: VideoInfo,
    config: ScrobblerPluginConfig,
    _setConfig: SetConfType
  ): void {
    if (
      !config.scrobblers.listenbrainz.apiRoot ||
      !config.scrobblers.listenbrainz.token
    ) {
      return;
    }

    const body = createRequestBody("playing_now", songInfo);
    submitListen(body, config);
  }

  override addScrobble(
    songInfo: VideoInfo,
    config: ScrobblerPluginConfig,
    _setConfig: SetConfType
  ): void {
    if (
      !config.scrobblers.listenbrainz.apiRoot ||
      !config.scrobblers.listenbrainz.token
    ) {
      return;
    }

    const body = createRequestBody("single", songInfo);
    body.payload[0].listened_at = Math.trunc(Date.now() / 1000);

    submitListen(body, config);
  }
}

function createRequestBody(
  listenType: string,
  songInfo: VideoInfo
): ListenbrainzRequestBody {
  const trackMetadata = {
    additional_info: {
      duration: songInfo.duration,
      media_player: `${APPLICATION_NAME} Desktop App`,
      origin_url: songInfo.url,
      submission_client: `${APPLICATION_NAME} Desktop App - Scrobbler Plugin`,
    },
    artist_name: songInfo.channel,
    track_name: songInfo.title,
  };

  return {
    listen_type: listenType,
    payload: [
      {
        track_metadata: trackMetadata,
      },
    ],
  };
}

function submitListen(
  body: ListenbrainzRequestBody,
  config: ScrobblerPluginConfig
) {
  net
    .fetch(`${config.scrobblers.listenbrainz.apiRoot}submit-listens`, {
      body: JSON.stringify(body),
      headers: {
        Authorization: "Token " + config.scrobblers.listenbrainz.token,
        "Content-Type": "application/json",
      },
      method: "POST",
    })
    .catch(console.error);
}
