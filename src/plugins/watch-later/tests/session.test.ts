import { expect, test } from "@playwright/test";
import type { Types } from "youtubei.js";

import {
  WatchLaterSession,
  looksSignedIn,
  siteCookieString,
} from "../backend/session";
import {
  appliedEditAnswer,
  pageWithOneItemAnswer,
  refusedEditAnswer,
  signedOutBrowseAnswer,
} from "./fixture-answers";

/** The two cookie strings the tests move between: the stale snapshot and the page's fresh jar. */
const cookies = {
  fresh: "SID=fresh; SAPISID=fresh",
  stale: "SID=stale; SAPISID=stale",
};

/** Answers the requests in order, remembering the cookies and the account each one carried. */
const answeringFetch = (answers: unknown[]) => {
  const sent: { authuser: string | null; cookie: string }[] = [];
  const fetch = (async (_input: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    sent.push({
      authuser: headers.get("x-goog-authuser"),
      cookie: headers.get("cookie") ?? "",
    });
    const answer = answers[Math.min(sent.length - 1, answers.length - 1)];
    return { json: async () => answer, ok: true, status: 200 } as Response;
  }) as unknown as Types.FetchFunction;

  return { fetch, sent };
};

// What the site actually holds, measured on 2026-10-21: the `youtube.com` set carries
// `__Secure-3PSID` and `__Secure-3PAPISID` but no plain `SAPISID` - and `SAPISID` is the name
// youtubei.js hashes into the `SAPISIDHASH` header. Without one the header is not sent at all and
// every request is answered as signed out, which is what the app was getting.
test("the site's __Secure-3PAPISID answers for the SAPISID the client hashes", () => {
  const string = siteCookieString([
    { name: "__Secure-3PSID", value: "site" },
    { name: "__Secure-3PAPISID", value: "site-ap" },
    { name: "LOGIN_INFO", value: "site" },
  ]);

  expect(string.split("; ")).toEqual([
    "__Secure-3PSID=site",
    "__Secure-3PAPISID=site-ap",
    "LOGIN_INFO=site",
    "SAPISID=site-ap",
  ]);
  expect(looksSignedIn(string)).toBe(true);
});

// The alias is a fallback, not a replacement: a site that still sets the cookie it is named after
// is the one the page itself is using.
test("a SAPISID the site sets itself is left alone", () => {
  const string = siteCookieString([
    { name: "SAPISID", value: "own" },
    { name: "__Secure-3PAPISID", value: "site-ap" },
  ]);

  expect(string).toContain("SAPISID=own");
  expect(string).not.toContain("SAPISID=site-ap");
});

// The `.google.com` copies are not a substitute for the site's own: they are a second,
// differently-rotated copy of the same session, and one of them alongside the site's set is what
// turned a signed-in answer back into `loggedOut`.
test("a jar with no account cookie of its own reads as signed out", () => {
  expect(
    looksSignedIn(
      siteCookieString([{ name: "VISITOR_INFO1_LIVE", value: "v" }])
    )
  ).toBe(false);
});

test("a write answered as signed out is retried on the page's fresh cookies", async () => {
  const { fetch, sent } = answeringFetch([
    refusedEditAnswer(),
    appliedEditAnswer(),
  ]);
  const session = await WatchLaterSession.create(cookies.stale, 1, {
    fetch,
    renewCookies: async () => cookies.fresh,
  });

  await session.addVideo("abcdefghijk");

  // Building the session asks YouTube for nothing, so these two are the write and its retry.
  expect(sent).toEqual([
    { authuser: "1", cookie: expect.stringContaining("SID=stale") },
    { authuser: "1", cookie: expect.stringContaining("SID=fresh") },
  ]);
});

test("a page answered as signed out is fetched again", async () => {
  const { fetch, sent } = answeringFetch([
    signedOutBrowseAnswer(),
    pageWithOneItemAnswer("abcdefghijk"),
  ]);
  const session = await WatchLaterSession.create(cookies.stale, 0, {
    fetch,
    renewCookies: async () => cookies.fresh,
  });

  const page = await session.fetchPage();

  expect(sent).toHaveLength(2);
  expect(page.items.map((item) => item.videoId)).toEqual(["abcdefghijk"]);
});

test("an answer that is not signed out is kept", async () => {
  const { fetch, sent } = answeringFetch([appliedEditAnswer()]);
  const session = await WatchLaterSession.create(cookies.fresh, 1, {
    fetch,
    renewCookies: async () => cookies.stale,
  });

  await session.addVideo("abcdefghijk");

  expect(sent).toHaveLength(1);
});

test("a refusal stands when the jar holds no session to renew with", async () => {
  const { fetch, sent } = answeringFetch([refusedEditAnswer()]);
  const session = await WatchLaterSession.create(cookies.stale, 1, {
    fetch,
    renewCookies: async () => undefined,
  });

  await expect(session.addVideo("abcdefghijk")).rejects.toThrow(
    "STATUS_FAILED"
  );
  expect(sent).toHaveLength(1);
});
