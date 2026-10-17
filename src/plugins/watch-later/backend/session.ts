import type { BrowserWindow } from "electron";
import { Innertube } from "youtubei.js";

import { SITE_ORIGIN } from "../site";
import type { WatchLaterAccount } from "../types";
import {
  accountsListPayload,
  addVideoPayload,
  browsePayload,
  parseIdentity,
  parseMutationResponse,
  parseVideoDetails,
  parseWatchLaterPage,
  playerPayload,
  probeAccounts,
  removeVideoByIdPayload,
  removeVideoPayload,
} from "./inner-tube";
import type {
  SessionIdentity,
  VideoDetails,
  WatchLaterPage,
} from "./inner-tube";

export { SITE_ORIGIN };

const AUTH_COOKIES = ["SAPISID", "SID"];

export const readSessionCookies = async (
  win: BrowserWindow
): Promise<string> => {
  const cookies = await win.webContents.session.cookies.get({
    url: SITE_ORIGIN,
  });
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
};

export const looksSignedIn = (cookieString: string): boolean =>
  AUTH_COOKIES.some((name) => cookieString.includes(`${name}=`));

/**
 * Wraps one signed-in session. Account switching is a session-level concern in
 * InnerTube: `session.account_index` decides which of the signed-in accounts
 * (`X-Goog-Authuser`) every following request acts as, so switching is a matter of
 * setting it and telling the caller which account is now active.
 */
export class WatchLaterSession {
  readonly #yt: Innertube;
  #accountIndex: number;
  #accounts: WatchLaterAccount[] = [];

  private constructor(yt: Innertube, accountIndex: number) {
    this.#yt = yt;
    this.#accountIndex = accountIndex;
  }

  static async create(
    cookieString: string,
    accountIndex = 0
  ): Promise<WatchLaterSession> {
    const yt = await Innertube.create({
      cookie: cookieString,
      generate_session_locally: true,
    });
    const session = new WatchLaterSession(yt, accountIndex);
    session.setAccountIndex(accountIndex);
    return session;
  }

  get accountIndex() {
    return this.#accountIndex;
  }

  setAccountIndex(index: number) {
    this.#accountIndex = index;
    this.#yt.session.account_index = index;
  }

  /**
   * The identities this session can act as, with the index each one answers to.
   *
   * There is no list to read: `account/accounts_list` answers with the identity the
   * request acted as, and the order of a multi-account response does not match
   * `X-Goog-Authuser` - assuming it did is what synced the wrong Watch Later list.
   */
  async listAccounts(): Promise<WatchLaterAccount[]> {
    const probed = await probeAccounts((index) => this.#identityAt(index));

    // Nothing answered: there is no account. Callers see an empty list and say
    // "no account", rather than a placeholder that looks like a real one.
    this.#accounts = probed.map(({ identity, index }) => ({
      byline: identity.byline,
      handle: identity.handle,
      id: identity.handle ?? `account-${index}`,
      index,
      isSelected: index === this.#accountIndex,
      name: identity.name,
      photoUrl: identity.photoUrl,
    }));

    return this.#accounts;
  }

  /** Asks the switcher who `X-Goog-Authuser: index` is; undefined when nobody answers. */
  async #identityAt(index: number): Promise<SessionIdentity | undefined> {
    const previous = this.#accountIndex;
    this.setAccountIndex(index);
    try {
      const response = await this.#yt.actions.execute(
        "/account/accounts_list",
        accountsListPayload()
      );
      const identity = parseIdentity(response.data);
      if (process.env.WATCHDECK_WL_DEBUG) {
        console.log(
          "[watch-later] probe",
          index,
          "->",
          identity?.handle ?? "no identity",
          "status",
          response.status_code ?? "?"
        );
      }
      return identity;
    } catch (error) {
      if (process.env.WATCHDECK_WL_DEBUG) {
        console.log("[watch-later] probe", index, "failed:", error);
      }
      return undefined;
    } finally {
      this.setAccountIndex(previous);
    }
  }

  async fetchPage(continuation?: string): Promise<WatchLaterPage> {
    const response = await this.#yt.actions.execute(
      "/browse",
      browsePayload(continuation)
    );
    return parseWatchLaterPage(response.data);
  }

  async addVideo(videoId: string): Promise<void> {
    const response = await this.#yt.actions.execute(
      "/browse/edit_playlist",
      addVideoPayload(videoId)
    );
    const result = parseMutationResponse(
      Number(response.status_code ?? 200),
      response.data
    );
    if (!result.ok) {
      throw new Error(result.error);
    }
  }

  async removeVideo(setVideoId: string): Promise<void> {
    const response = await this.#yt.actions.execute(
      "/browse/edit_playlist",
      removeVideoPayload(setVideoId)
    );
    const result = parseMutationResponse(
      Number(response.status_code ?? 200),
      response.data
    );
    if (!result.ok) {
      throw new Error(result.error);
    }
  }

  async removeVideoById(videoId: string): Promise<void> {
    const response = await this.#yt.actions.execute(
      "/browse/edit_playlist",
      removeVideoByIdPayload(videoId)
    );
    const result = parseMutationResponse(
      Number(response.status_code ?? 200),
      response.data
    );
    if (!result.ok) {
      throw new Error(result.error);
    }
  }

  async videoDetails(videoId: string): Promise<VideoDetails> {
    const response = await this.#yt.actions.execute(
      "/player",
      playerPayload(videoId)
    );
    return parseVideoDetails(response.data);
  }
}
