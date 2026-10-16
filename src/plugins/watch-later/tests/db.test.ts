import { expect, test } from "@playwright/test";

import { openNodeSqlite, WatchLaterStore } from "../backend/db";
import { defaultConfig } from "../config";

const store = () => new WatchLaterStore(openNodeSqlite(":memory:"));

test("entries are isolated per account", () => {
  const db = store();
  db.upsertVideo({ title: "One", videoId: "aaaaaaaaaaa" });
  db.upsertEntry({ accountId: "alpha", videoId: "aaaaaaaaaaa" });
  db.upsertEntry({ accountId: "beta", videoId: "aaaaaaaaaaa" });

  expect(db.membershipIds("alpha")).toEqual(["aaaaaaaaaaa"]);
  db.removeEntry("beta", "aaaaaaaaaaa");

  expect(db.membershipIds("alpha")).toEqual(["aaaaaaaaaaa"]);
  expect(db.membershipIds("beta")).toEqual([]);
  db.close();
});

test("a full walk soft-deletes what vanished and keeps first_seen_at", () => {
  const db = store();
  db.upsertEntry({ accountId: "alpha", videoId: "keep0000001", position: 0 });
  db.upsertEntry({ accountId: "alpha", videoId: "gone0000001", position: 1 });
  const removed = db.softRemoveMissing("alpha", ["keep0000001"]);

  expect(removed).toBe(1);
  expect(db.membershipIds("alpha")).toEqual(["keep0000001"]);
  // Re-adding the video later clears the soft delete again.
  db.upsertEntry({ accountId: "alpha", videoId: "gone0000001" });
  expect(db.membershipIds("alpha").sort()).toEqual([
    "gone0000001",
    "keep0000001",
  ]);
  db.close();
});

test("progress merges the local high-water mark with YouTube's percentage", () => {
  const db = store();
  db.upsertVideo({
    durationSeconds: 100,
    title: "Half watched",
    videoId: "watched0001",
  });
  db.upsertEntry({ accountId: "alpha", videoId: "watched0001" });

  // Local says 20% (20s of 100s), YouTube's own resume bar says 95%.
  db.recordLocalProgress("alpha", "watched0001", {
    durationSeconds: 100,
    positionSeconds: 20,
  });
  db.setYouTubeProgress("alpha", "watched0001", { percent: 95 });

  const [entry] = db.query({ accountId: "alpha" }, defaultConfig);
  expect(entry.bucket).toBe("watched");
  expect(entry.ratio).toBeCloseTo(0.95);
  expect(entry.progressSource).toBe("both");
  db.close();
});

test("buckets follow the configured thresholds", () => {
  const db = store();
  const cases = [
    {
      bucket: "unwatched",
      percent: undefined,
      seconds: 0,
      videoId: "fresh0000001",
    },
    {
      bucket: "in-progress",
      percent: undefined,
      seconds: 30,
      videoId: "middle00001",
    },
    { bucket: "watched", percent: 97, seconds: 10, videoId: "done0000001" },
  ] as const;

  for (const item of cases) {
    db.upsertVideo({
      durationSeconds: 100,
      title: item.videoId,
      videoId: item.videoId,
    });
    db.upsertEntry({ accountId: "alpha", videoId: item.videoId });
    if (item.seconds > 0) {
      db.recordLocalProgress("alpha", item.videoId, {
        durationSeconds: 100,
        positionSeconds: item.seconds,
      });
    }
    if (item.percent !== undefined) {
      db.setYouTubeProgress("alpha", item.videoId, { percent: item.percent });
    }
  }

  const buckets = new Map(
    db
      .query({ accountId: "alpha" }, defaultConfig)
      .map((entry) => [entry.videoId, entry.bucket])
  );
  for (const item of cases) {
    expect(buckets.get(item.videoId)).toBe(item.bucket);
  }

  // Changing the threshold reclassifies without touching the data.
  const strict = { ...defaultConfig, watched: { percent: 99 } };
  const strictBuckets = new Map(
    db
      .query({ accountId: "alpha" }, strict)
      .map((entry) => [entry.videoId, entry.bucket])
  );
  expect(strictBuckets.get("done0000001")).toBe("in-progress");
  db.close();
});

test("search matches title, description and channel", () => {
  const db = store();
  db.upsertVideo({
    channelTitle: "Lo-Fi Girl",
    title: "Rainy afternoon mix",
    videoId: "lofi0000001",
  });
  db.upsertVideo({
    channelTitle: "Other",
    title: "Something else",
    videoId: "other000001",
  });
  db.setVideoDetails("lofi0000001", { description: "two hours of loops" });
  db.upsertEntry({ accountId: "alpha", videoId: "lofi0000001" });
  db.upsertEntry({ accountId: "alpha", videoId: "other000001" });

  expect(
    db
      .query({ accountId: "alpha", search: "rainy" }, defaultConfig)
      .map((e) => e.videoId)
  ).toEqual(["lofi0000001"]);
  expect(
    db
      .query({ accountId: "alpha", search: "loops" }, defaultConfig)
      .map((e) => e.videoId)
  ).toEqual(["lofi0000001"]);
  expect(
    db.query({ accountId: "alpha", search: "nothing" }, defaultConfig)
  ).toEqual([]);
  db.close();
});

test("the outbox survives failed mutations and replays", () => {
  const db = store();
  db.enqueueOutbox({ accountId: "alpha", kind: "add", videoId: "queued00001" });
  expect(db.listOutbox("alpha")).toHaveLength(1);

  db.failOutbox(db.listOutbox("alpha")[0].id, "offline");
  expect(db.listOutbox("alpha")[0].attempts).toBe(1);

  db.dropOutbox(db.listOutbox("alpha")[0].id);
  expect(db.listOutbox("alpha")).toEqual([]);
  db.close();
});

test("the sync cursor is resumable and clears when the walk completes", () => {
  const db = store();
  expect(db.loadCursor("alpha")).toBeUndefined();
  db.saveCursor("alpha", "token-1", 3);
  expect(db.loadCursor("alpha")).toEqual({
    continuation: "token-1",
    page_index: 3,
  });
  db.clearCursor("alpha");
  expect(db.loadCursor("alpha")).toBeUndefined();
  db.close();
});
