import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { classifyProgress } from "@/plugins/utils/common/watch-thresholds";
import type { WatchThresholds } from "@/types/watch-thresholds";

import type {
  WatchLaterAccount,
  WatchLaterBucket,
  WatchLaterEntry,
  WatchLaterQuery,
} from "../types";

/**
 * The storage engine is behind this interface on purpose: `node:sqlite` is still
 * marked experimental, so a swap to better-sqlite3 has to stay a small change.
 */
export interface DbAdapter {
  exec(sql: string): void;
  all<T>(sql: string, ...params: unknown[]): T[];
  get<T>(sql: string, ...params: unknown[]): T | undefined;
  run(sql: string, ...params: unknown[]): { changes: number };
  close(): void;
}

export const openNodeSqlite = (file: string): DbAdapter => {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);

  // The mirror is written in bursts - a page of the list is 100 videos and 100 entries, and every
  // video write also fires the search-index triggers - and in the default rollback journal each of
  // those statements commits (and fsyncs) on its own. Measured on this machine: 1705 ms for one
  // page, which is the freeze the user feels when a save finishes. The same page is 10 ms in WAL,
  // where the writes go to the log and the fsync happens once, at the commit.
  //
  // `synchronous = NORMAL` is the usual pairing: a power cut can lose the last transactions, and
  // this database is a mirror of YouTube's list, so losing them costs a sync, not data.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");

  return {
    all: <T>(sql: string, ...params: unknown[]) =>
      db.prepare(sql).all(...(params as never[])) as T[],
    close: () => db.close(),
    exec: (sql: string) => db.exec(sql),
    get: <T>(sql: string, ...params: unknown[]) =>
      db.prepare(sql).get(...(params as never[])) as T | undefined,
    run: (sql: string, ...params: unknown[]) => {
      const result = db.prepare(sql).run(...(params as never[]));
      return { changes: Number(result.changes ?? 0) };
    },
  };
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS account (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  handle         TEXT,
  photo_url      TEXT,
  byline         TEXT,
  auth_user_index INTEGER NOT NULL DEFAULT 0,
  is_selected    INTEGER NOT NULL DEFAULT 0,
  last_seen_at   TEXT
);

CREATE TABLE IF NOT EXISTS video (
  video_id          TEXT PRIMARY KEY,
  title             TEXT NOT NULL DEFAULT '',
  channel_id        TEXT,
  channel_title     TEXT,
  description       TEXT,
  duration_seconds  INTEGER,
  published_at      TEXT,
  thumbnail_url     TEXT,
  tags_json         TEXT,
  is_live           INTEGER NOT NULL DEFAULT 0,
  availability      TEXT NOT NULL DEFAULT 'unknown',
  details_synced_at TEXT,
  raw_json          TEXT
);

CREATE TABLE IF NOT EXISTS wl_entry (
  account_id    TEXT NOT NULL,
  video_id      TEXT NOT NULL,
  set_video_id  TEXT,
  position      INTEGER,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  removed_at    TEXT,
  PRIMARY KEY (account_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_wl_entry_position
  ON wl_entry(account_id, removed_at, position);

CREATE TABLE IF NOT EXISTS progress (
  account_id              TEXT NOT NULL,
  video_id                TEXT NOT NULL,
  max_position_seconds    REAL NOT NULL DEFAULT 0,
  duration_seconds        REAL,
  total_watched_seconds   REAL NOT NULL DEFAULT 0,
  last_position_seconds   REAL,
  last_watched_at         TEXT,
  play_count              INTEGER NOT NULL DEFAULT 0,
  yt_percent_watched      REAL,
  yt_watched_badge        INTEGER NOT NULL DEFAULT 0,
  yt_percent_seen_at      TEXT,
  progress_source         TEXT NOT NULL DEFAULT 'none',
  PRIMARY KEY (account_id, video_id)
);

CREATE TABLE IF NOT EXISTS sync_run (
  id         INTEGER PRIMARY KEY,
  account_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  pages      INTEGER NOT NULL DEFAULT 0,
  items      INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'running',
  error      TEXT
);

CREATE TABLE IF NOT EXISTS sync_cursor (
  account_id   TEXT PRIMARY KEY,
  continuation TEXT,
  page_index   INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id         INTEGER PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind       TEXT NOT NULL,
  video_id   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  error      TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS video_fts USING fts5(
  video_id UNINDEXED, title, description, channel_title, tags
);

CREATE TRIGGER IF NOT EXISTS video_ai AFTER INSERT ON video BEGIN
  INSERT INTO video_fts(rowid, video_id, title, description, channel_title, tags)
  VALUES (new.rowid, new.video_id, new.title, coalesce(new.description, ''),
          coalesce(new.channel_title, ''), coalesce(new.tags_json, ''));
END;
CREATE TRIGGER IF NOT EXISTS video_ad AFTER DELETE ON video BEGIN
  DELETE FROM video_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER IF NOT EXISTS video_au AFTER UPDATE ON video BEGIN
  DELETE FROM video_fts WHERE rowid = old.rowid;
  INSERT INTO video_fts(rowid, video_id, title, description, channel_title, tags)
  VALUES (new.rowid, new.video_id, new.title, coalesce(new.description, ''),
          coalesce(new.channel_title, ''), coalesce(new.tags_json, ''));
END;
`;

const accountId = (account: WatchLaterAccount) =>
  account.handle?.trim() || account.id;

interface VideoRow {
  video_id: string;
  title: string;
  channel_title: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  is_live: number;
  description: string | null;
  tags_json: string | null;
}

interface EntryRow extends VideoRow {
  set_video_id: string | null;
  position: number | null;
  last_seen_at: string;
  yt_percent_watched: number | null;
  yt_watched_badge: number | null;
  max_position_seconds: number | null;
  progress_duration_seconds: number | null;
  progress_source: string | null;
}

/**
 * Classifies one entry into the three buckets the UI filters by. Kept pure so the merge rule for
 * the two progress sources is unit-testable: `effective = max(local high-water mark / duration,
 * YouTube's own resume %)`. The thresholds themselves are shared - the app's options, applied by
 * `classifyProgress` - because the dimming plugin asks the same question of the site's own
 * percentage.
 */
export const classifyEntry = (
  entry: {
    durationSeconds?: number | null;
    ytPercentWatched?: number | null;
    ytWatchedBadge?: boolean | null;
    maxPositionSeconds?: number | null;
  },
  thresholds: WatchThresholds
): { bucket: WatchLaterBucket; ratio: number; watchedSeconds: number } => {
  const duration = entry.durationSeconds ?? 0;
  const localSeconds = entry.maxPositionSeconds ?? 0;
  const ytRatio = (entry.ytPercentWatched ?? 0) / 100;
  const ratio =
    duration > 0 ? Math.max(localSeconds / duration, ytRatio) : ytRatio;
  const watchedSeconds = Math.max(localSeconds, ytRatio * duration);

  // The site's own badge is the one signal that needs no threshold: YouTube only draws it on a
  // video it counts as watched.
  const bucket = entry.ytWatchedBadge
    ? "watched"
    : classifyProgress({ durationSeconds: duration, ratio }, thresholds);

  return { bucket, ratio, watchedSeconds };
};

export class WatchLaterStore {
  readonly #db: DbAdapter;
  readonly #ftsAvailable: boolean;

  constructor(db: DbAdapter) {
    this.#db = db;
    this.#db.exec(SCHEMA);
    this.#migrateAccountTable();
    this.#ftsAvailable = this.#probeFts();
  }

  /**
   * `index_in_list` used to hold the position in the switcher's array, which is not the
   * `X-Goog-Authuser` index - so those rows pointed at the wrong account and are dropped
   * rather than translated. Everything else here is a mirror of YouTube's own data, which
   * the next sync refills.
   */
  #migrateAccountTable() {
    const columns = this.#db.all<{ name: string }>(
      "PRAGMA table_info(account)"
    );
    if (!columns.some((column) => column.name === "index_in_list")) {
      return;
    }
    this.#db.exec("DROP TABLE account");
    this.#db.exec(`CREATE TABLE account (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      handle          TEXT,
      photo_url       TEXT,
      byline          TEXT,
      auth_user_index INTEGER NOT NULL DEFAULT 0,
      is_selected     INTEGER NOT NULL DEFAULT 0,
      last_seen_at    TEXT
    );`);
  }

  #probeFts(): boolean {
    try {
      this.#db.all("SELECT rowid FROM video_fts LIMIT 1");
      return true;
    } catch {
      return false;
    }
  }

  get ftsAvailable() {
    return this.#ftsAvailable;
  }

  // --- accounts -----------------------------------------------------------

  upsertAccount(account: WatchLaterAccount): void {
    const now = new Date().toISOString();
    this.#db.run(
      `INSERT INTO account (id, name, handle, photo_url, byline, auth_user_index, is_selected, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         handle = excluded.handle,
         photo_url = excluded.photo_url,
         byline = excluded.byline,
         auth_user_index = excluded.auth_user_index,
         is_selected = excluded.is_selected,
         last_seen_at = excluded.last_seen_at`,
      accountId(account),
      account.name,
      account.handle ?? null,
      account.photoUrl ?? null,
      account.byline ?? null,
      account.index,
      account.isSelected ? 1 : 0,
      now
    );
  }

  listAccounts(): WatchLaterAccount[] {
    const rows = this.#db.all<{
      id: string;
      name: string;
      handle: string | null;
      photo_url: string | null;
      byline: string | null;
      auth_user_index: number;
      is_selected: number;
      last_seen_at: string | null;
    }>("SELECT * FROM account ORDER BY auth_user_index ASC");

    return rows.map((row) => ({
      byline: row.byline ?? undefined,
      handle: row.handle ?? undefined,
      id: row.id,
      index: row.auth_user_index,
      isSelected: row.is_selected === 1,
      lastSeenAt: row.last_seen_at ?? undefined,
      name: row.name,
      photoUrl: row.photo_url ?? undefined,
    }));
  }

  getAccount(id: string): WatchLaterAccount | undefined {
    return this.listAccounts().find(
      (account) => account.id === id || account.handle === id
    );
  }

  /**
   * Runs a burst of writes as one transaction.
   *
   * One page of the list is 200 rows plus the search-index triggers, and each statement would
   * otherwise commit on its own - 1.7 s of blocked main process per page, measured. Wrapping the
   * page makes it one commit: the freeze when a save finishes is this function's reason to exist.
   */
  transaction<T>(write: () => T): T {
    this.#db.exec("BEGIN");
    try {
      const result = write();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  // --- sync -------------------------------------------------------------

  startSyncRun(account: string): number {
    this.#db.run(
      "INSERT INTO sync_run (account_id, started_at, status) VALUES (?, ?, 'running')",
      account,
      new Date().toISOString()
    );
    const row = this.#db.get<{ id: number }>(
      "SELECT id FROM sync_run WHERE account_id = ? ORDER BY id DESC LIMIT 1",
      account
    );
    return row?.id ?? 0;
  }

  finishSyncRun(
    id: number,
    result: { pages: number; items: number; status: string; error?: string }
  ): void {
    this.#db.run(
      `UPDATE sync_run
       SET finished_at = ?, pages = ?, items = ?, status = ?, error = ?
       WHERE id = ?`,
      new Date().toISOString(),
      result.pages,
      result.items,
      result.status,
      result.error ?? null,
      id
    );
  }

  lastSyncRun(account: string) {
    return this.#db.get<{
      id: number;
      started_at: string;
      finished_at: string | null;
      pages: number;
      items: number;
      status: string;
      error: string | null;
    }>(
      "SELECT * FROM sync_run WHERE account_id = ? ORDER BY id DESC LIMIT 1",
      account
    );
  }

  saveCursor(account: string, continuation: string | null, pageIndex: number) {
    this.#db.run(
      `INSERT INTO sync_cursor (account_id, continuation, page_index, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         continuation = excluded.continuation,
         page_index = excluded.page_index,
         updated_at = excluded.updated_at`,
      account,
      continuation,
      pageIndex,
      new Date().toISOString()
    );
  }

  loadCursor(account: string) {
    return this.#db.get<{ continuation: string | null; page_index: number }>(
      "SELECT continuation, page_index FROM sync_cursor WHERE account_id = ?",
      account
    );
  }

  clearCursor(account: string) {
    this.#db.run("DELETE FROM sync_cursor WHERE account_id = ?", account);
  }

  upsertVideo(video: {
    videoId: string;
    title: string;
    channelId?: string;
    channelTitle?: string;
    durationSeconds?: number;
    thumbnailUrl?: string;
    isLive?: boolean;
  }): void {
    this.#db.run(
      `INSERT INTO video (video_id, title, channel_id, channel_title, duration_seconds,
                          thumbnail_url, is_live)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET
         title = excluded.title,
         channel_id = coalesce(excluded.channel_id, video.channel_id),
         channel_title = coalesce(excluded.channel_title, video.channel_title),
         duration_seconds = coalesce(excluded.duration_seconds, video.duration_seconds),
         thumbnail_url = coalesce(excluded.thumbnail_url, video.thumbnail_url),
         is_live = excluded.is_live`,
      video.videoId,
      video.title,
      video.channelId ?? null,
      video.channelTitle ?? null,
      video.durationSeconds ?? null,
      video.thumbnailUrl ?? null,
      video.isLive ? 1 : 0
    );
  }

  setVideoDetails(
    videoId: string,
    details: {
      description?: string;
      tags?: string[];
      channelId?: string;
      isLive?: boolean;
      availability?: string;
      raw?: unknown;
    }
  ): void {
    this.#db.run(
      `UPDATE video
       SET description = coalesce(?, description),
           tags_json = coalesce(?, tags_json),
           channel_id = coalesce(?, channel_id),
           is_live = coalesce(?, is_live),
           availability = coalesce(?, availability),
           raw_json = coalesce(?, raw_json),
           details_synced_at = ?
       WHERE video_id = ?`,
      details.description ?? null,
      details.tags ? JSON.stringify(details.tags) : null,
      details.channelId ?? null,
      details.isLive === undefined ? null : details.isLive ? 1 : 0,
      details.availability ?? null,
      details.raw ? JSON.stringify(details.raw) : null,
      new Date().toISOString(),
      videoId
    );
  }

  upsertEntry(entry: {
    accountId: string;
    videoId: string;
    setVideoId?: string;
    position?: number;
    seenAt?: string;
  }): void {
    const seenAt = entry.seenAt ?? new Date().toISOString();
    this.#db.run(
      `INSERT INTO wl_entry (account_id, video_id, set_video_id, position, first_seen_at, last_seen_at, removed_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(account_id, video_id) DO UPDATE SET
         set_video_id = coalesce(excluded.set_video_id, wl_entry.set_video_id),
         position = coalesce(excluded.position, wl_entry.position),
         last_seen_at = excluded.last_seen_at,
         removed_at = NULL`,
      entry.accountId,
      entry.videoId,
      entry.setVideoId ?? null,
      entry.position ?? null,
      seenAt,
      seenAt
    );
  }

  /** Marks entries that were not part of the last full page walk as removed. */
  softRemoveMissing(
    accountId: string,
    seenVideoIds: string[],
    removedAt = new Date().toISOString()
  ): number {
    const placeholders = seenVideoIds.map(() => "?").join(",");
    const clause = seenVideoIds.length
      ? `AND video_id NOT IN (${placeholders})`
      : "";
    const result = this.#db.run(
      `UPDATE wl_entry SET removed_at = ?
       WHERE account_id = ? AND removed_at IS NULL ${clause}`,
      removedAt,
      accountId,
      ...seenVideoIds
    );
    return result.changes;
  }

  setYouTubeProgress(
    accountId: string,
    videoId: string,
    progress: { percent: number; watchedBadge?: boolean }
  ): void {
    const seenAt = new Date().toISOString();
    this.#db.run(
      `INSERT INTO progress (account_id, video_id, yt_percent_watched, yt_watched_badge,
                             yt_percent_seen_at, progress_source)
       VALUES (?, ?, ?, ?, ?, 'youtube')
       ON CONFLICT(account_id, video_id) DO UPDATE SET
         yt_percent_watched = excluded.yt_percent_watched,
         -- The freshest observation wins: a badge that is no longer there (or was read
         -- wrongly by an older build) has to be able to clear.
         yt_watched_badge = excluded.yt_watched_badge,
         yt_percent_seen_at = excluded.yt_percent_seen_at,
         progress_source = CASE
           WHEN progress.max_position_seconds > 0 THEN 'both'
           ELSE 'youtube'
         END`,
      accountId,
      videoId,
      progress.percent,
      progress.watchedBadge ? 1 : 0,
      seenAt
    );
  }

  recordLocalProgress(
    accountId: string,
    videoId: string,
    report: {
      positionSeconds: number;
      durationSeconds: number;
      ended?: boolean;
    }
  ): void {
    const now = new Date().toISOString();
    const position = report.ended
      ? report.durationSeconds
      : report.positionSeconds;
    this.#db.run(
      `INSERT INTO progress (account_id, video_id, max_position_seconds, duration_seconds,
                             total_watched_seconds, last_position_seconds, last_watched_at,
                             play_count, progress_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'local')
       ON CONFLICT(account_id, video_id) DO UPDATE SET
         max_position_seconds = max(progress.max_position_seconds, excluded.max_position_seconds),
         duration_seconds = coalesce(excluded.duration_seconds, progress.duration_seconds),
         total_watched_seconds = max(progress.total_watched_seconds, excluded.max_position_seconds),
         last_position_seconds = excluded.last_position_seconds,
         last_watched_at = excluded.last_watched_at,
         play_count = CASE
           WHEN excluded.last_watched_at >= coalesce(progress.last_watched_at, '') THEN progress.play_count + 1
           ELSE progress.play_count
         END,
         progress_source = CASE
           WHEN progress.yt_percent_watched IS NULL THEN 'local'
           ELSE 'both'
         END`,
      accountId,
      videoId,
      position,
      report.durationSeconds,
      position,
      position,
      now
    );
  }

  // --- queries ----------------------------------------------------------

  membershipIds(accountId: string): string[] {
    return this.#db
      .all<{ video_id: string }>(
        "SELECT video_id FROM wl_entry WHERE account_id = ? AND removed_at IS NULL",
        accountId
      )
      .map((row) => row.video_id);
  }

  countEntries(accountId: string): number {
    const row = this.#db.get<{ count: number }>(
      "SELECT count(*) AS count FROM wl_entry WHERE account_id = ? AND removed_at IS NULL",
      accountId
    );
    return row?.count ?? 0;
  }

  /**
   * Entries the app added itself and no walk has seen yet: they have no `set_video_id`, so they
   * cannot be removed by id until a page carries them.
   */
  countEntriesMissingSetVideoId(accountId: string): number {
    const row = this.#db.get<{ count: number }>(
      `SELECT count(*) AS count FROM wl_entry
       WHERE account_id = ? AND removed_at IS NULL AND set_video_id IS NULL`,
      accountId
    );
    return row?.count ?? 0;
  }

  entryFor(accountId: string, videoId: string) {
    return this.#db.get<{
      set_video_id: string | null;
      removed_at: string | null;
    }>(
      "SELECT set_video_id, removed_at FROM wl_entry WHERE account_id = ? AND video_id = ?",
      accountId,
      videoId
    );
  }

  removeEntry(accountId: string, videoId: string): void {
    this.#db.run(
      "UPDATE wl_entry SET removed_at = ? WHERE account_id = ? AND video_id = ?",
      new Date().toISOString(),
      accountId,
      videoId
    );
  }

  unenrichedIds(limit: number, accountId: string): string[] {
    return this.#db
      .all<{ video_id: string }>(
        `SELECT e.video_id
         FROM wl_entry e
         JOIN video v ON v.video_id = e.video_id
         WHERE e.account_id = ? AND e.removed_at IS NULL AND v.details_synced_at IS NULL
         LIMIT ?`,
        accountId,
        limit
      )
      .map((row) => row.video_id);
  }

  query(
    query: WatchLaterQuery,
    thresholds: WatchThresholds
  ): WatchLaterEntry[] {
    const accountId = query.accountId ?? "";
    const limit = query.limit ?? 200;
    const offset = query.offset ?? 0;
    const search = query.search?.trim();

    const where: string[] = ["e.account_id = ?", "e.removed_at IS NULL"];
    const params: unknown[] = [accountId];

    let join = "";
    if (search) {
      if (this.#ftsAvailable) {
        join = "JOIN video_fts f ON f.rowid = v.rowid";
        where.push("video_fts MATCH ?");
        params.push(`${search.replaceAll(/["*]/g, " ").trim()}*`);
      } else {
        where.push(
          "(v.title LIKE ? OR v.description LIKE ? OR v.channel_title LIKE ?)"
        );
        const like = `%${search}%`;
        params.push(like, like, like);
      }
    }

    const rows = this.#db.all<EntryRow>(
      `SELECT v.*, e.set_video_id, e.position, e.last_seen_at,
              p.yt_percent_watched, p.yt_watched_badge, p.max_position_seconds,
              p.duration_seconds AS progress_duration_seconds, p.progress_source
       FROM wl_entry e
       JOIN video v ON v.video_id = e.video_id
       LEFT JOIN progress p ON p.account_id = e.account_id AND p.video_id = e.video_id
       ${join}
       WHERE ${where.join(" AND ")}
       ORDER BY e.position IS NULL, e.position ASC, e.last_seen_at DESC
       LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset
    );

    const entries = rows.map((row) => {
      const duration = row.duration_seconds ?? row.progress_duration_seconds;
      const classified = classifyEntry(
        {
          durationSeconds: duration,
          maxPositionSeconds: row.max_position_seconds,
          ytPercentWatched: row.yt_percent_watched,
          ytWatchedBadge: row.yt_watched_badge === 1,
        },
        thresholds
      );

      return {
        bucket: classified.bucket,
        channelTitle: row.channel_title ?? undefined,
        durationSeconds: duration ?? undefined,
        isLive: row.is_live === 1,
        position: row.position ?? undefined,
        progressSource: (row.progress_source ?? "none") as
          | "none"
          | "local"
          | "youtube"
          | "both",
        ratio: classified.ratio,
        savedAt: row.last_seen_at,
        setVideoId: row.set_video_id ?? undefined,
        thumbnailUrl: row.thumbnail_url ?? undefined,
        title: row.title,
        videoId: row.video_id,
        watchedSeconds: classified.watchedSeconds,
        ytPercentWatched: row.yt_percent_watched ?? undefined,
      } satisfies WatchLaterEntry;
    });

    return query.bucket
      ? entries.filter((entry) => entry.bucket === query.bucket)
      : entries;
  }

  // --- outbox -----------------------------------------------------------

  enqueueOutbox(entry: { accountId: string; kind: string; videoId: string }) {
    this.#db.run(
      "INSERT INTO outbox (account_id, kind, video_id, created_at) VALUES (?, ?, ?, ?)",
      entry.accountId,
      entry.kind,
      entry.videoId,
      new Date().toISOString()
    );
  }

  listOutbox(accountId: string) {
    return this.#db.all<{
      id: number;
      kind: string;
      video_id: string;
      attempts: number;
    }>(
      "SELECT id, kind, video_id, attempts FROM outbox WHERE account_id = ? ORDER BY id ASC",
      accountId
    );
  }

  dropOutbox(id: number) {
    this.#db.run("DELETE FROM outbox WHERE id = ?", id);
  }

  failOutbox(id: number, error: string) {
    this.#db.run(
      "UPDATE outbox SET attempts = attempts + 1, error = ? WHERE id = ?",
      error,
      id
    );
  }

  close() {
    this.#db.close();
  }
}
