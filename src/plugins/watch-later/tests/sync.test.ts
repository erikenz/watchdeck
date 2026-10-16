import { expect, test } from "@playwright/test";

import { openNodeSqlite, WatchLaterStore } from "../backend/db";
import { parseWatchLaterPage } from "../backend/inner-tube";
import type { VideoDetails, WatchLaterPage } from "../backend/inner-tube";
import { WatchLaterSync } from "../backend/sync";
import type { WatchLaterTransport } from "../backend/sync";
import { defaultConfig } from "../config";

const config = { ...defaultConfig, requestsPerSecond: 0 };

/** Synthetic pages in the shape the site returns (trimmed to what we read). */
const legacyPage = (items: number, continuation?: string) => ({
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  {
                    itemSectionRenderer: {
                      contents: [
                        {
                          playlistVideoListRenderer: {
                            contents: Array.from(
                              { length: items },
                              (_, index) => ({
                                playlistVideoRenderer: {
                                  lengthText: { simpleText: "10:00" },
                                  setVideoId: `set-${index}`,
                                  shortBylineText: {
                                    runs: [{ text: `Channel ${index}` }],
                                  },
                                  thumbnail: {
                                    thumbnails: [
                                      {
                                        url: `https://i.ytimg.com/vi/v${index}/hq.jpg`,
                                      },
                                    ],
                                  },
                                  thumbnailOverlays:
                                    index === 0
                                      ? [
                                          {
                                            thumbnailOverlayResumePlaybackRenderer:
                                              { percentDurationWatched: 42 },
                                          },
                                        ]
                                      : index === 1
                                        ? [
                                            {
                                              thumbnailOverlayPlaybackStatusRenderer:
                                                {
                                                  text: {
                                                    runs: [{ text: "Watched" }],
                                                  },
                                                },
                                            },
                                          ]
                                        : [],
                                  title: { runs: [{ text: `Video ${index}` }] },
                                  videoId: `vid${index.toString().padStart(8, "0")}`,
                                },
                              })
                            ),
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  },
  header: {
    playlistHeaderRenderer: { numVideosText: { runs: [{ text: "2 videos" }] } },
  },
  ...(continuation
    ? {
        onResponseReceivedActions: [
          { continuationCommand: { token: continuation } },
        ],
      }
    : {}),
});

test("parses a page into items, resume percent, badge and continuation", () => {
  const parsed = parseWatchLaterPage(legacyPage(3, "next-page"));

  expect(parsed.items).toHaveLength(3);
  expect(parsed.items[0].videoId).toBe("vid00000000");
  expect(parsed.items[0].ytPercentWatched).toBe(42);
  expect(parsed.items[0].setVideoId).toBe("set-0");
  expect(parsed.items[0].durationSeconds).toBe(600);
  expect(parsed.items[0].title).toBe("Video 0");
  expect(parsed.items[1].watchedBadge).toBe(true);
  expect(parsed.items[0].thumbnailUrl).toContain("i.ytimg.com");
  expect(parsed.continuation).toBe("next-page");
  expect(parsed.totalItems).toBe(2);
});

/**
 * The shape of a `VLWL` response, trimmed to the fields the parser reads; the values
 * are placeholders, not anyone's list.
 */
const pageFixture = {
  contents: {
    itemSectionRenderer: {
      contents: [
        {
          playlistVideoListRenderer: {
            contents: [
              {
                playlistVideoRenderer: {
                  index: { simpleText: "1" },
                  isPlayable: true,
                  navigationEndpoint: {
                    commandMetadata: {
                      webCommandMetadata: { url: "/watch?v=aaaa" },
                    },
                  },
                  setVideoId: "ExampleSet01",
                  shortBylineText: {
                    runs: [
                      {
                        navigationEndpoint: {
                          browseEndpoint: {
                            browseId: "UCExampleChannel000000",
                            canonicalBaseUrl: "/channel/UCExampleChannel000000",
                          },
                        },
                        text: "Example Channel",
                      },
                    ],
                  },
                  thumbnail: {
                    thumbnails: [
                      {
                        height: 94,
                        url: "https://i.ytimg.com/vi/aaaa/default.jpg",
                        width: 168,
                      },
                      {
                        height: 188,
                        url: "https://i.ytimg.com/vi/aaaa/mqdefault.jpg",
                        width: 336,
                      },
                    ],
                  },
                  thumbnailOverlays: [
                    {
                      thumbnailOverlayResumePlaybackRenderer: {
                        percentDurationWatched: 25,
                      },
                    },
                    {
                      thumbnailOverlayTimeStatusRenderer: {
                        text: { simpleText: "1:01:00" },
                        style: "DEFAULT",
                      },
                    },
                  ],
                  title: { runs: [{ text: "Example video" }] },
                  videoId: "aaaaaaaaaaa",
                },
              },
            ],
          },
        },
      ],
    },
  },
};

test("parses a page: channel, duration from the overlay, resume percent", () => {
  const [item] = parseWatchLaterPage(pageFixture).items;

  expect(item.videoId).toBe("aaaaaaaaaaa");
  expect(item.title).toBe("Example video");
  expect(item.channelTitle).toBe("Example Channel");
  expect(item.channelId).toBe("UCExampleChannel000000");
  expect(item.setVideoId).toBe("ExampleSet01");
  // No lengthText in this response shape: the duration comes from the time-status overlay.
  expect(item.durationSeconds).toBe(3660);
  expect(item.ytPercentWatched).toBe(25);
  expect(item.thumbnailUrl).toContain("mqdefault.jpg");
});

test("a nested playback-status node is not a watched badge", () => {
  // The regression this guards: scanning the whole item subtree found "playback status"
  // nodes inside menus and marked partially watched videos as watched.
  const [item] = parseWatchLaterPage({
    contents: {
      playlistVideoListRenderer: {
        contents: [
          {
            playlistVideoRenderer: {
              menu: {
                menuRenderer: {
                  items: [
                    {
                      menuServiceItemRenderer: {
                        thumbnailOverlayPlaybackStatusRenderer: {},
                      },
                    },
                  ],
                },
              },
              thumbnailOverlays: [
                {
                  thumbnailOverlayResumePlaybackRenderer: {
                    percentDurationWatched: 10,
                  },
                },
              ],
              title: { runs: [{ text: "Partially watched" }] },
              videoId: "partial00001",
            },
          },
        ],
      },
    },
  }).items;

  expect(item.ytPercentWatched).toBe(10);
  expect(item.watchedBadge).toBeUndefined();
});

test("paging walks to the end, captures progress and soft-deletes what is gone", async () => {
  const db = new WatchLaterStore(openNodeSqlite(":memory:"));
  db.upsertEntry({ accountId: "alpha", videoId: "stale000001" });

  const pages: Record<string, unknown> = {
    "": legacyPage(2, "page-2"),
    "page-2": {
      contents: {
        itemSectionRenderer: {
          contents: [
            {
              playlistVideoListRenderer: {
                contents: Array.from({ length: 1 }, (_, index) => ({
                  playlistVideoRenderer: {
                    lengthText: { simpleText: "3:00" },
                    setVideoId: `set-b${index}`,
                    title: { runs: [{ text: `Video b${index}` }] },
                    videoId: `vidb${index.toString().padStart(8, "0")}`,
                  },
                })),
              },
            },
          ],
        },
      },
    },
  };
  const asked: string[] = [];
  const transport: WatchLaterTransport = {
    addVideo: () => Promise.resolve(),
    fetchPage: (continuation?: string): Promise<WatchLaterPage> => {
      asked.push(continuation ?? "");
      return Promise.resolve(parseWatchLaterPage(pages[continuation ?? ""]));
    },
    removeVideo: () => Promise.resolve(),
    videoDetails: (): Promise<VideoDetails> => Promise.resolve({}),
  };

  const sync = new WatchLaterSync(db, config);
  const result = await sync.pull(transport, {
    accountId: "alpha",
    resume: false,
  });

  expect(result.status).toBe("ok");
  expect(result.pages).toBe(2);
  expect(result.items).toBe(3);
  expect(result.completed).toBe(true);
  expect(asked).toEqual(["", "page-2"]);
  expect(db.membershipIds("alpha").sort()).toEqual([
    "vid00000000",
    "vid00000001",
    "vidb00000000",
  ]);
  // The stale entry disappeared from the walk, so it is soft-deleted...
  expect(db.membershipIds("alpha")).not.toContain("stale000001");
  // ...but the row is still there for provenance.
  expect(db.entryFor("alpha", "stale000001")?.removed_at).not.toBeNull();
  // Progress from the same page walk needed no extra request.
  const [first] = db.query({ accountId: "alpha" }, defaultConfig);
  expect(first.bucket).toBe("in-progress");
  db.close();
});

test("an interrupted walk resumes from the stored cursor", async () => {
  const db = new WatchLaterStore(openNodeSqlite(":memory:"));
  const transport: WatchLaterTransport = {
    addVideo: () => Promise.resolve(),
    fetchPage: (continuation?: string) =>
      Promise.resolve(
        parseWatchLaterPage(
          continuation ? legacyPage(1) : legacyPage(1, "page-2")
        )
      ),
    removeVideo: () => Promise.resolve(),
    videoDetails: () => Promise.resolve({}),
  };

  const sync = new WatchLaterSync(db, config);
  const first = await sync.pull(transport, {
    accountId: "alpha",
    maxPages: 1,
    resume: true,
  });
  expect(first.status).toBe("partial");
  expect(db.loadCursor("alpha")?.continuation).toBe("page-2");

  const second = await sync.pull(transport, {
    accountId: "alpha",
    resume: true,
  });
  expect(second.completed).toBe(true);
  expect(db.loadCursor("alpha")).toBeUndefined();
  db.close();
});

test("a walk resumed from the middle does not declare the pages before it gone", async () => {
  const db = new WatchLaterStore(openNodeSqlite(":memory:"));
  const secondPage = {
    contents: {
      itemSectionRenderer: {
        contents: [
          {
            playlistVideoListRenderer: {
              contents: Array.from({ length: 1 }, (_, index) => ({
                playlistVideoRenderer: {
                  lengthText: { simpleText: "3:00" },
                  setVideoId: `set-b${index}`,
                  title: { runs: [{ text: `Video b${index}` }] },
                  videoId: `vidb${index.toString().padStart(8, "0")}`,
                },
              })),
            },
          },
        ],
      },
    },
  };
  const transport: WatchLaterTransport = {
    addVideo: () => Promise.resolve(),
    fetchPage: (continuation?: string) =>
      Promise.resolve(
        parseWatchLaterPage(continuation ? secondPage : legacyPage(2, "page-2"))
      ),
    removeVideo: () => Promise.resolve(),
    videoDetails: () => Promise.resolve({}),
  };

  const sync = new WatchLaterSync(db, config);
  // An interrupted walk: page one is in, page two is where it stopped.
  const first = await sync.pull(transport, {
    accountId: "alpha",
    maxPages: 1,
    resume: true,
  });
  expect(first.status).toBe("partial");
  const seenOnPageOne = db.membershipIds("alpha");
  expect(seenOnPageOne).toHaveLength(2);

  // The resume walks the tail and completes. Page one was never in this walk's sight, so nothing
  // on it can be called gone.
  const second = await sync.pull(transport, {
    accountId: "alpha",
    resume: true,
  });
  expect(second.completed).toBe(true);
  for (const videoId of seenOnPageOne) {
    expect(db.entryFor("alpha", videoId)?.removed_at).toBeNull();
  }
  expect(db.membershipIds("alpha")).toHaveLength(3);
  db.close();
});

test("a one-page top-up leaves the interrupted walk's cursor alone", async () => {
  const db = new WatchLaterStore(openNodeSqlite(":memory:"));
  const transport: WatchLaterTransport = {
    addVideo: () => Promise.resolve(),
    fetchPage: () =>
      Promise.resolve(parseWatchLaterPage(legacyPage(1, "page-2"))),
    removeVideo: () => Promise.resolve(),
    videoDetails: () => Promise.resolve({}),
  };

  const sync = new WatchLaterSync(db, config);
  // Where a walk that was killed in the middle had got to.
  db.saveCursor("alpha", "page-9", 9);

  // The top-up an add schedules: one page, from the first page, not a continuation.
  const topUp = await sync.pull(transport, {
    accountId: "alpha",
    maxPages: 1,
    resume: false,
  });
  expect(topUp.status).toBe("partial");
  expect(db.loadCursor("alpha")).toEqual({
    continuation: "page-9",
    page_index: 9,
  });
  db.close();
});

test("an empty page while the site still counts items is a failed read, not an empty list", async () => {
  const db = new WatchLaterStore(openNodeSqlite(":memory:"));
  db.upsertEntry({ accountId: "alpha", videoId: "vid00000000" });

  const transport: WatchLaterTransport = {
    addVideo: () => Promise.resolve(),
    // What a hiccup looks like: no items, no continuation, and a header that still counts the
    // list. Sweeping on this reading is what marked 3369 real entries removed once.
    fetchPage: () =>
      Promise.resolve(
        parseWatchLaterPage({
          contents: {
            itemSectionRenderer: {
              contents: [
                {
                  playlistVideoListRenderer: {
                    contents: [],
                    numVideosText: { simpleText: "3,477 videos" },
                  },
                },
              ],
            },
          },
        })
      ),
    removeVideo: () => Promise.resolve(),
    videoDetails: () => Promise.resolve({}),
  };

  const sync = new WatchLaterSync(db, config);
  const result = await sync.pull(transport, {
    accountId: "alpha",
    resume: false,
  });

  expect(result.status).toBe("error");
  expect(result.error).toBe("empty page");
  expect(db.membershipIds("alpha")).toEqual(["vid00000000"]);
  db.close();
});

test("a list the site itself calls empty does clear the mirror", async () => {
  const db = new WatchLaterStore(openNodeSqlite(":memory:"));
  db.upsertEntry({ accountId: "alpha", videoId: "vid00000000" });

  const transport: WatchLaterTransport = {
    addVideo: () => Promise.resolve(),
    fetchPage: () =>
      Promise.resolve(
        parseWatchLaterPage({
          contents: {
            itemSectionRenderer: {
              contents: [
                {
                  playlistVideoListRenderer: {
                    contents: [],
                    numVideosText: { simpleText: "No videos" },
                  },
                },
              ],
            },
          },
        })
      ),
    removeVideo: () => Promise.resolve(),
    videoDetails: () => Promise.resolve({}),
  };

  const sync = new WatchLaterSync(db, config);
  const result = await sync.pull(transport, {
    accountId: "alpha",
    resume: false,
  });

  expect(result.status).toBe("ok");
  expect(db.membershipIds("alpha")).toEqual([]);
  expect(db.entryFor("alpha", "vid00000000")?.removed_at).not.toBeNull();
  db.close();
});

test("remove resolves the entry id the list carries, and queues when it cannot", async () => {
  const db = new WatchLaterStore(openNodeSqlite(":memory:"));
  const removed: string[] = [];
  const transport: WatchLaterTransport = {
    addVideo: () => Promise.resolve(),
    fetchPage: () => Promise.resolve(parseWatchLaterPage(legacyPage(1))),
    removeVideo: (setVideoId: string) => {
      removed.push(setVideoId);
      return Promise.resolve();
    },
    videoDetails: () => Promise.resolve({}),
  };

  const sync = new WatchLaterSync(db, config);
  db.upsertVideo({ title: "Video 0", videoId: "vid00000000" });
  db.upsertEntry({
    accountId: "alpha",
    setVideoId: "set-0",
    videoId: "vid00000000",
  });

  await sync.remove(transport, "alpha", "vid00000000");
  expect(removed).toEqual(["set-0"]);
  expect(db.membershipIds("alpha")).toEqual([]);

  // Without the setVideoId the removal waits for a sync instead of guessing.
  db.upsertEntry({ accountId: "alpha", videoId: "unknown0001" });
  await expect(sync.remove(transport, "alpha", "unknown0001")).rejects.toThrow(
    "set-video-id-unknown"
  );
  expect(db.listOutbox("alpha")).toHaveLength(1);
  db.close();
});

test("a failed add is queued in the outbox for the next sync", async () => {
  const db = new WatchLaterStore(openNodeSqlite(":memory:"));
  const transport: WatchLaterTransport = {
    addVideo: () => Promise.reject(new Error("offline")),
    fetchPage: () => Promise.resolve(parseWatchLaterPage(legacyPage(0))),
    removeVideo: () => Promise.resolve(),
    videoDetails: () => Promise.resolve({}),
  };

  const sync = new WatchLaterSync(db, config);
  await expect(sync.add(transport, "alpha", "vid00000000")).rejects.toThrow(
    "offline"
  );
  expect(db.listOutbox("alpha")).toHaveLength(1);
  expect(db.listOutbox("alpha")[0].kind).toBe("add");
  db.close();
});
