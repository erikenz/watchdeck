import { expect, test } from "@playwright/test";
import type { Types } from "youtubei.js";

import { WatchLaterSession } from "../backend/session";
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

// The bug this is about: YouTube answers a stale snapshot as signed out - not with a failure - so
// the write was recorded as saved and the page walk read as empty. Reading the jar again is what
// clears it.
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
