import type { BrowserWindow } from "electron";
import { Innertube } from "youtubei.js";

import type { WatchLaterAccount } from "../types";
import {
  addVideoPayload,
  browsePayload,
  parseMutationResponse,
  parseVideoDetails,
  parseWatchLaterPage,
  playerPayload,
  removeVideoPayload,
} from "./inner-tube";
import type { VideoDetails, WatchLaterPage } from "./inner-tube";

/** Kept escaped on purpose: see the note about the de-trademarking pass in the PRD. */
export const SITE_ORIGIN =
  "https://www.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com";

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

interface InnertubeAccount {
  account_name?: { text?: string };
  account_byline?: { text?: string };
  channel_handle?: { text?: string };
  account_photo?: { thumbnails?: { url: string }[] };
  is_selected?: boolean;
}

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
   * The accounts signed into this session, in the order the account switcher shows
   * them - that order is what `X-Goog-Authuser` indexes.
   */
  async listAccounts(): Promise<WatchLaterAccount[]> {
    const raw = (await this.#yt.account.getInfo(true)) as unknown as
      | InnertubeAccount[]
      | undefined;

    if (!Array.isArray(raw) || raw.length === 0) {
      this.#accounts = [
        {
          id: "default",
          index: 0,
          isSelected: true,
          name: "Default account",
        },
      ];
      return this.#accounts;
    }

    this.#accounts = raw.map((account, index) => {
      const handle = account.channel_handle?.text;
      const name = account.account_name?.text ?? handle ?? `Account ${index}`;
      return {
        handle,
        id: handle ?? `account-${index}`,
        index,
        isSelected: account.is_selected ?? index === this.#accountIndex,
        name,
        photoUrl: account.account_photo?.thumbnails?.at(-1)?.url,
      } satisfies WatchLaterAccount;
    });

    return this.#accounts;
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

  async videoDetails(videoId: string): Promise<VideoDetails> {
    const response = await this.#yt.actions.execute(
      "/player",
      playerPayload(videoId)
    );
    return parseVideoDetails(response.data);
  }
}
