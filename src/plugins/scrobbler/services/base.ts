import type { SongInfo } from "@/providers/song-info";

import type { ScrobblerPluginConfig } from "../index";
import type { SetConfType } from "../main";

export abstract class ScrobblerBase {
  public abstract isSessionCreated(config: ScrobblerPluginConfig): boolean;

  public abstract createSession(
    config: ScrobblerPluginConfig,
    setConfig: SetConfType
  ): Promise<ScrobblerPluginConfig>;

  public abstract setNowPlaying(
    songInfo: SongInfo,
    config: ScrobblerPluginConfig,
    setConfig: SetConfType
  ): void;

  public abstract addScrobble(
    songInfo: SongInfo,
    config: ScrobblerPluginConfig,
    setConfig: SetConfType
  ): void;
}
