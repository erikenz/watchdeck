import type { WatchLaterPluginConfig } from "../types";
import type { VideoDetails, WatchLaterPage } from "./inner-tube";

/**
 * Everything the sync needs from the network, so the algorithm below can be tested
 * against a fake instead of a live session.
 */
export interface WatchLaterTransport {
  fetchPage(continuation?: string): Promise<WatchLaterPage>;
  addVideo(videoId: string): Promise<void>;
  removeVideo(setVideoId: string): Promise<void>;
  videoDetails(videoId: string): Promise<VideoDetails>;
}

/** Minimal view of the store the sync writes to, so tests can pass a stub too. */
export interface WatchLaterSink {
  startSyncRun(accountId: string): number;
  finishSyncRun(
    id: number,
    result: { pages: number; items: number; status: string; error?: string }
  ): void;
  saveCursor(
    accountId: string,
    continuation: string | null,
    pageIndex: number
  ): void;
  loadCursor(
    accountId: string
  ): { continuation: string | null; page_index: number } | undefined;
  clearCursor(accountId: string): void;
  upsertVideo(video: {
    videoId: string;
    title: string;
    channelId?: string;
    channelTitle?: string;
    durationSeconds?: number;
    thumbnailUrl?: string;
    isLive?: boolean;
  }): void;
  upsertEntry(entry: {
    accountId: string;
    videoId: string;
    setVideoId?: string;
    position?: number;
  }): void;
  softRemoveMissing(accountId: string, seenVideoIds: string[]): number;
  setYouTubeProgress(
    accountId: string,
    videoId: string,
    progress: { percent: number; watchedBadge?: boolean }
  ): void;
  setVideoDetails(videoId: string, details: VideoDetails): void;
  entryFor(
    accountId: string,
    videoId: string
  ): { set_video_id: string | null; removed_at: string | null } | undefined;
  removeEntry(accountId: string, videoId: string): void;
  unenrichedIds(limit: number, accountId: string): string[];
  enqueueOutbox(entry: {
    accountId: string;
    kind: string;
    videoId: string;
  }): void;
  listOutbox(
    accountId: string
  ): { id: number; kind: string; video_id: string; attempts: number }[];
  dropOutbox(id: number): void;
  failOutbox(id: number, error: string): void;
}

export type SyncStatus = "ok" | "partial" | "error";

export interface SyncResult {
  status: SyncStatus;
  pages: number;
  items: number;
  totalItems?: number;
  error?: string;
  /** true when the list shrank because entries vanished from it, i.e. a full walk */
  completed: boolean;
}

export interface SyncProgress {
  pages: number;
  items: number;
  totalItems?: number;
}

export interface SyncOptions {
  accountId: string;
  /**
   * Ids the user changed while this walk is running. The closing sweep that marks
   * disappeared entries must not undo a change it read before the change happened.
   */
  protectVideoIds?: Set<string>;
  /** Continue the persisted cursor instead of starting from page one. */
  resume?: boolean;
  /** Stop after this many pages (used by tests and by "peek" syncs). */
  maxPages?: number;
  onProgress?: (progress: SyncProgress) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Spacing requests out is part of the design: a 5 000 item list is ~50 round trips. */
class RateLimiter {
  readonly #intervalMs: number;
  #lastRequest = 0;

  constructor(requestsPerSecond: number) {
    this.#intervalMs = requestsPerSecond > 0 ? 1000 / requestsPerSecond : 0;
  }

  async wait() {
    const waitFor = this.#lastRequest + this.#intervalMs - Date.now();
    if (waitFor > 0) {
      await sleep(waitFor);
    }
    this.#lastRequest = Date.now();
  }
}

export class WatchLaterSync {
  readonly #sink: WatchLaterSink;
  readonly #config: WatchLaterPluginConfig;
  readonly #limiter: RateLimiter;

  constructor(sink: WatchLaterSink, config: WatchLaterPluginConfig) {
    this.#sink = sink;
    this.#config = config;
    this.#limiter = new RateLimiter(config.requestsPerSecond);
  }

  /**
   * Walks the whole list, page by page, persisting the continuation after each page.
   * A killed app resumes from the last stored page instead of page one.
   */
  async pull(
    transport: WatchLaterTransport,
    options: SyncOptions
  ): Promise<SyncResult> {
    const { accountId } = options;
    const runId = this.#sink.startSyncRun(accountId);
    const seen = new Set<string>();
    let pages = 0;
    let items = 0;
    let totalItems: number | undefined;
    let continuation: string | undefined = options.resume
      ? (this.#sink.loadCursor(accountId)?.continuation ?? undefined)
      : undefined;
    let pageIndex = options.resume
      ? (this.#sink.loadCursor(accountId)?.page_index ?? 0)
      : 0;
    // Only a walk that starts at the first page has seen the whole list by the time it runs out
    // of pages. One resumed from the middle saw the tail, and the ids on the pages before it are
    // not gone just because this walk never looked at them.
    const coversWholeList = pageIndex === 0;

    try {
      for (;;) {
        if (options.maxPages && pages >= options.maxPages) {
          this.#finish(runId, pages, items, "partial");
          return {
            completed: false,
            items,
            pages,
            status: "partial",
            totalItems,
          };
        }

        await this.#limiter.wait();
        const page = await transport.fetchPage(continuation);
        pageIndex += 1;
        pages += 1;
        totalItems ??= page.totalItems;

        for (const item of page.items) {
          seen.add(item.videoId);
          items += 1;
          this.#sink.upsertVideo({
            channelId: item.channelId,
            channelTitle: item.channelTitle,
            durationSeconds: item.durationSeconds,
            isLive: item.isLive,
            thumbnailUrl: item.thumbnailUrl,
            title: item.title || item.videoId,
            videoId: item.videoId,
          });
          this.#sink.upsertEntry({
            accountId,
            position: items - 1,
            setVideoId: item.setVideoId,
            videoId: item.videoId,
          });
          if (
            item.ytPercentWatched !== undefined ||
            item.watchedBadge === true
          ) {
            this.#sink.setYouTubeProgress(accountId, item.videoId, {
              percent: item.ytPercentWatched ?? 0,
              watchedBadge: item.watchedBadge,
            });
          }
        }

        continuation = page.continuation;
        // The cursor exists to continue a walk. A top-up that deliberately starts from page one
        // is not that walk, and must leave the interrupted one's position where it was.
        if (options.resume) {
          this.#sink.saveCursor(accountId, continuation ?? null, pageIndex);
        }
        options.onProgress?.({ items, pages, totalItems });

        if (!continuation) {
          break;
        }
      }

      // A full walk is the only moment we know what is *still* in the list - minus the ids
      // the user touched while we were walking (see `protectVideoIds`).
      if (coversWholeList) {
        this.#sink.softRemoveMissing(accountId, [
          ...seen,
          ...(options.protectVideoIds ?? []),
        ]);
      }
      this.#sink.clearCursor(accountId);
      this.#finish(runId, pages, items, "ok");
      return { completed: true, items, pages, status: "ok", totalItems };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#finish(runId, pages, items, "error", message);
      return {
        completed: false,
        error: message,
        items,
        pages,
        status: "error",
        totalItems,
      };
    }
  }

  #finish(
    runId: number,
    pages: number,
    items: number,
    status: SyncStatus,
    error?: string
  ) {
    this.#sink.finishSyncRun(runId, {
      error,
      items,
      pages,
      status: status === "ok" ? "ok" : status,
    });
  }

  /** The list is long and the metadata fetch is one request per video. */
  async enrich(
    transport: WatchLaterTransport,
    accountId: string,
    limit = 25
  ): Promise<number> {
    if (!this.#config.enrichMetadata) {
      return 0;
    }
    const ids = this.#sink.unenrichedIds(limit, accountId);
    let done = 0;
    for (const videoId of ids) {
      try {
        await this.#limiter.wait();
        const details = await transport.videoDetails(videoId);
        this.#sink.setVideoDetails(videoId, details);
        done += 1;
      } catch {
        break;
      }
    }
    return done;
  }

  async add(
    transport: WatchLaterTransport,
    accountId: string,
    videoId: string
  ): Promise<void> {
    const existing = this.#sink.entryFor(accountId, videoId);
    if (existing && existing.removed_at === null) {
      return;
    }
    try {
      await this.#limiter.wait();
      await transport.addVideo(videoId);
      this.#sink.upsertEntry({ accountId, videoId });
    } catch (error) {
      this.#sink.enqueueOutbox({ accountId, kind: "add", videoId });
      throw error;
    }
  }

  async remove(
    transport: WatchLaterTransport,
    accountId: string,
    videoId: string
  ): Promise<void> {
    const setVideoId = await this.#resolveSetVideoId(
      transport,
      accountId,
      videoId
    );
    if (!setVideoId) {
      // InnerTube removes by the per-entry id, so without it the removal has to wait
      // for the next sync to learn it.
      this.#sink.enqueueOutbox({ accountId, kind: "remove", videoId });
      throw new Error("set-video-id-unknown");
    }
    try {
      await this.#limiter.wait();
      await transport.removeVideo(setVideoId);
      this.#sink.removeEntry(accountId, videoId);
    } catch (error) {
      this.#sink.enqueueOutbox({ accountId, kind: "remove", videoId });
      throw error;
    }
  }

  /** Entries added from the app only get their `setVideoId` once a page carries them. */
  async #resolveSetVideoId(
    transport: WatchLaterTransport,
    accountId: string,
    videoId: string
  ): Promise<string | undefined> {
    const existing = this.#sink.entryFor(accountId, videoId);
    if (existing?.set_video_id) {
      return existing.set_video_id;
    }

    let continuation: string | undefined;
    for (let page = 0; page < 3; page += 1) {
      await this.#limiter.wait();
      const result = await transport.fetchPage(continuation);
      const match = result.items.find((item) => item.videoId === videoId);
      if (match?.setVideoId) {
        this.#sink.upsertEntry({
          accountId,
          setVideoId: match.setVideoId,
          videoId,
        });
        return match.setVideoId;
      }
      continuation = result.continuation;
      if (!continuation) {
        break;
      }
    }
    return undefined;
  }

  /** Replays mutations that were queued while the API or the session was unavailable. */
  async replayOutbox(
    transport: WatchLaterTransport,
    accountId: string
  ): Promise<{ replayed: number; pending: number }> {
    const entries = this.#sink.listOutbox(accountId);
    let replayed = 0;

    for (const entry of entries) {
      try {
        if (entry.kind === "add") {
          await this.add(transport, accountId, entry.video_id);
        } else if (entry.kind === "remove") {
          await this.remove(transport, accountId, entry.video_id);
        }
        this.#sink.dropOutbox(entry.id);
        replayed += 1;
      } catch (error) {
        this.#sink.failOutbox(
          entry.id,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    return { pending: entries.length - replayed, replayed };
  }
}
