import type { BrowserWindow } from "electron";
import type { Types } from "youtubei.js";
import { Innertube } from "youtubei.js";

import { SITE_ORIGIN } from "../site";
import type { WatchLaterAccount } from "../types";
import {
  accountsListPayload,
  addVideoPayload,
  answeredSignedOut,
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

/**
 * The site's own cookies, as one string, with the one alias the client needs.
 *
 * `youtubei.js` signs each request with `SAPISIDHASH`, and it builds that hash from the cookie
 * named `SAPISID` - no cookie by that name, no `Authorization` header, and the request is
 * answered as signed out. The site has stopped setting a plain `SAPISID` on `youtube.com` (it
 * still sets one on `.google.com`), but the account's `__Secure-3PAPISID` *is* on `youtube.com`,
 * and that is the secret the site's own script hashes. So it answers for `SAPISID` here, and a
 * real `SAPISID` still wins when the site has one.
 *
 * Kept pure so this is testable without a window.
 */
export const siteCookieString = (
  cookies: { name: string; value: string }[]
): string => {
  const byName = new Map<string, string>();
  for (const cookie of cookies) {
    byName.set(cookie.name, cookie.value);
  }
  const siteApisid = byName.get("__Secure-3PAPISID");
  if (!byName.has("SAPISID") && siteApisid) {
    byName.set("SAPISID", siteApisid);
  }
  return [...byName].map(([name, value]) => `${name}=${value}`).join("; ");
};

/**
 * The signed-in session, as one cookie string: the site's cookies, and only the site's.
 *
 * Measured against the live account on 2026-10-21, one request per row:
 *
 * - the `youtube.com` set alone carries no `SAPISID`, so no `SAPISIDHASH` goes with it and the
 *   answer is `loggedOut` with an empty list - which is what the app was getting;
 * - the same set with `SAPISID` = the site's `__Secure-3PAPISID` answers signed in, with the real
 *   list (101 items on the first page);
 * - adding `.google.com`'s cookies to that working string breaks it again. One at a time: the
 *   `.google.com` copies of `__Secure-1PSID` and of `__Secure-3PSIDTS` each turn the answer back
 *   into `loggedOut`, and the whole `google.com` set does the same.
 *
 * The `google.com` cookies are a second, differently-rotated copy of the same session, and this
 * request is not going to `google.com`. The page sends only the site's own cookies, so this does
 * too.
 */
export const readSessionCookies = async (win: BrowserWindow): Promise<string> =>
  siteCookieString(
    await win.webContents.session.cookies.get({ url: SITE_ORIGIN })
  );

export const looksSignedIn = (cookieString: string): boolean =>
  AUTH_COOKIES.some((name) => cookieString.includes(`${name}=`));

export interface WatchLaterSessionOptions {
  /**
   * The page's cookies, as they are now. YouTube rotates the session's binding cookies while the
   * app runs, so a session built from a snapshot goes stale and is answered as signed out - which
   * this is the way out of: read the jar again and retry. `undefined` means the jar holds no
   * session any more and there is nothing to retry with.
   */
  renewCookies?: () => Promise<string | undefined>;
  /** The network. The library's own fetch when not given; tests hand in their own. */
  fetch?: Types.FetchFunction;
}

/**
 * One construction path, for the first session and for a renewal alike.
 *
 * Nothing here needs the network. This plugin only ever calls `actions.execute`: never the
 * library's player, and never the InnerTube config, so a session can be built locally - which is
 * what makes replacing a stale one cheap enough to do on the spot. The player costs a request for
 * `iframe_api` and the config another; neither is asked for.
 */
const buildClient = (
  cookie: string,
  visitorData: string | undefined,
  fetchImpl: Types.FetchFunction | undefined
): Promise<Innertube> =>
  Innertube.create({
    cookie,
    fetch: fetchImpl,
    generate_session_locally: true,
    retrieve_innertube_config: false,
    retrieve_player: false,
    visitor_data: visitorData,
  });

/**
 * Wraps one signed-in session. Account switching is a session-level concern in
 * InnerTube: `session.account_index` decides which of the signed-in accounts
 * (`X-Goog-Authuser`) every following request acts as, so switching is a matter of
 * setting it and telling the caller which account is now active.
 */
export class WatchLaterSession {
  #yt: Innertube;
  #accountIndex: number;
  #accounts: WatchLaterAccount[] = [];
  readonly #options: WatchLaterSessionOptions;

  private constructor(
    yt: Innertube,
    accountIndex: number,
    options: WatchLaterSessionOptions
  ) {
    this.#yt = yt;
    this.#accountIndex = accountIndex;
    this.#options = options;
  }

  static async create(
    cookieString: string,
    accountIndex = 0,
    options: WatchLaterSessionOptions = {}
  ): Promise<WatchLaterSession> {
    const session = new WatchLaterSession(
      await buildClient(cookieString, undefined, options.fetch),
      accountIndex,
      options
    );
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
    const response = await this.#request(
      "/browse",
      browsePayload(continuation)
    );
    return parseWatchLaterPage(response.data);
  }

  async addVideo(videoId: string): Promise<void> {
    await this.#mutate(addVideoPayload(videoId));
  }

  async removeVideo(setVideoId: string): Promise<void> {
    await this.#mutate(removeVideoPayload(setVideoId));
  }

  async removeVideoById(videoId: string): Promise<void> {
    await this.#mutate(removeVideoByIdPayload(videoId));
  }

  async videoDetails(videoId: string): Promise<VideoDetails> {
    const response = await this.#request("/player", playerPayload(videoId));
    return parseVideoDetails(response.data);
  }

  /** `edit_playlist` reports its own refusals in the body, whatever the status code said. */
  async #mutate(payload: Record<string, unknown>): Promise<void> {
    const response = await this.#request("/browse/edit_playlist", payload);
    const result = parseMutationResponse(
      Number(response.status_code ?? 200),
      response.data
    );
    if (!result.ok) {
      throw new Error(result.error);
    }
  }

  /**
   * One request, retried once when the server answers as if no session were attached.
   *
   * A session built from an old cookie snapshot is not refused loudly: for a write the answer is
   * `{"status": "STATUS_FAILED"}` and for a page it is the empty list the sync reads as "empty
   * page". Reading the jar again is what clears it, and retrying here is where a dry snapshot stops
   * costing the user anything.
   */
  async #request(path: string, payload: Record<string, unknown>) {
    const response = await this.#yt.actions.execute(path, payload);
    if (!answeredSignedOut(response.data) || !(await this.#renew())) {
      return response;
    }
    return this.#yt.actions.execute(path, payload);
  }

  /** Rebuilds the client on the page's current cookies; false when there is nothing to renew. */
  async #renew(): Promise<boolean> {
    const renew = this.#options.renewCookies;
    if (!renew) {
      return false;
    }
    try {
      const cookies = await renew();
      if (!cookies) {
        return false;
      }
      // The visitor is kept: a renewal is a refresh of the cookies, not a new client showing up.
      const visitorData = this.#yt.session.context.client.visitorData;
      this.#yt = await buildClient(cookies, visitorData, this.#options.fetch);
      this.setAccountIndex(this.#accountIndex);
      return true;
    } catch {
      return false;
    }
  }
}
