import type { VideoInfo } from "@/types/video-info";

import type { ScrobblerPluginConfig } from "../index";
import type { SetConfType } from "../main";

export abstract class ScrobblerBase {
  public abstract isSessionCreated(config: ScrobblerPluginConfig): boolean;

  public abstract createSession(
    config: ScrobblerPluginConfig,
    setConfig: SetConfType
  ): Promise<ScrobblerPluginConfig>;

  public abstract setNowPlaying(
    songInfo: VideoInfo,
    config: ScrobblerPluginConfig,
    setConfig: SetConfType
  ): void;

  public abstract addScrobble(
    songInfo: VideoInfo,
    config: ScrobblerPluginConfig,
    setConfig: SetConfType
  ): void;
}
