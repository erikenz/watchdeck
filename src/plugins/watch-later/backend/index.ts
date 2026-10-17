import { join } from "node:path";

import { app } from "electron";

import { t } from "@/i18n";
import type { BackendContext } from "@/types/contexts";
import { LoggerPrefix } from "@/utils";

import type {
  WatchLaterAccount,
  WatchLaterPluginConfig,
  WatchLaterProgressReport,
  WatchLaterQuery,
  WatchLaterState,
} from "../types";
import { openNodeSqlite, WatchLaterStore } from "./db";
import {
  looksSignedIn,
  readSessionCookies,
  WatchLaterSession,
} from "./session";
import { WatchLaterSync } from "./sync";

interface BackendState {
  store: WatchLaterStore;
  sync: WatchLaterSync;
  session: WatchLaterSession | null;
  accounts: WatchLaterAccount[];
  activeAccountId: string | null;
  syncing: boolean;
  needsAuth: boolean;
  /** `SESSION_INDEX` the page reports, i.e. the account the user is browsing as. */
  sessionIndex: number | null;
  /** The reason the running walk was started with, and what the site says the list holds. */
  syncReason: string | null;
  expectedTotal: number | null;
  /** The repair below runs at most once per start; see `repairEntryIds`. */
  repairedEntryIds: boolean;
  interval?: NodeJS.Timeout;
  window: BackendContext<WatchLaterPluginConfig>["window"] | null;
  config: WatchLaterPluginConfig | null;
}

const state: BackendState = {
  accounts: [],
  activeAccountId: null,
  config: null,
  expectedTotal: null,
  needsAuth: false,
  repairedEntryIds: false,
  session: null,
  sessionIndex: null,
  // Both are assigned in onMainLoad, before any IPC handler or menu click can use
  // them; the assertion is the module-private way of saying so.
  store: null!,
  sync: null!,
  syncReason: null,
  syncing: false,
  window: null,
};

const log = (...args: unknown[]) =>
  console.log(LoggerPrefix, "[watch-later]", ...args);

const currentState = (): WatchLaterState => {
  const run = state.activeAccountId
    ? state.store.lastSyncRun(state.activeAccountId)
    : undefined;

  return {
    accounts: state.accounts,
    activeAccountId: state.activeAccountId,
    expectedTotal: state.expectedTotal ?? undefined,
    lastSync: run
      ? {
          error: run.error ?? undefined,
          finishedAt: run.finished_at ?? undefined,
          items: run.items,
          pages: run.pages,
          startedAt: run.started_at,
          status: run.status,
        }
      : undefined,
    needsAuth: state.needsAuth,
    syncReason: state.syncReason ?? undefined,
    syncing: state.syncing,
    totalEntries: state.activeAccountId
      ? state.store.countEntries(state.activeAccountId)
      : 0,
  };
};

const broadcast = () => {
  state.window?.webContents.send(
    "watchdeck:watch-later-changed",
    currentState()
  );
};

const connect = async () => {
  if (!state.window) {
    return;
  }

  const cookies = await readSessionCookies(state.window);
  state.needsAuth = !looksSignedIn(cookies);

  if (state.needsAuth) {
    log("no signed-in session yet; waiting for one");
    return;
  }

  try {
    state.session = await WatchLaterSession.create(cookies, 0);
    const accounts = await state.session.listAccounts();
    for (const account of accounts) {
      state.store.upsertAccount(account);
    }
    state.accounts = state.store.listAccounts();

    // The session decides which identity we act as: the site's own avatar menu is where a
    // user changes accounts, so we follow it instead of offering a second switcher.
    const active =
      state.accounts.find((account) => account.index === state.sessionIndex) ??
      state.accounts[0];
    if (active) {
      state.activeAccountId = active.id;
      state.session.setAccountIndex(active.index);
    }
  } catch (error) {
    log(
      "could not reach the account list, falling back to what is stored",
      error
    );
    state.accounts = state.store.listAccounts();
    state.activeAccountId = state.accounts[0]?.id ?? null;
  }
};

const switchAccount = async (accountId: string) => {
  const account = state.accounts.find((entry) => entry.id === accountId);
  if (!account) {
    throw new Error(`unknown account ${accountId}`);
  }
  state.session?.setAccountIndex(account.index);
  state.activeAccountId = account.id;
  log(`switched to ${account.name} (authuser ${account.index})`);
};

/**
 * Ids the user changed while a walk was running. The walk's closing "these are gone from
 * the list" pass must not undo a change it read before that change happened, and a video
 * added mid-walk may not appear in the pages it saw. The next sync reconciles both; this set
 * only stops a running walk from actively making things worse.
 */
const mutatedDuringWalk = new Set<string>();

const noteMutation = (videoId: string) => {
  if (state.syncing) {
    mutatedDuringWalk.add(videoId);
  }
};

const runSync = async (options: {
  maxPages?: number;
  resume?: boolean;
  reason: string;
}): Promise<void> => {
  if (state.syncing) {
    log("sync already running, skipping", options.reason);
    return;
  }
  if (!state.session || !state.activeAccountId) {
    await connect();
  }
  if (!state.session || !state.activeAccountId) {
    state.needsAuth = true;
    broadcast();
    return;
  }

  state.syncing = true;
  state.syncReason = options.reason;
  broadcast();

  const accountId = state.activeAccountId;
  const session = state.session;

  try {
    const result = await state.sync.pull(session, {
      accountId,
      maxPages: options.maxPages,
      onProgress: (progress) => {
        state.expectedTotal = progress.totalItems ?? state.expectedTotal;
        state.window?.webContents.send("watchdeck:watch-later-sync-progress", {
          accountId,
          ...progress,
        });
      },
      protectVideoIds: new Set(mutatedDuringWalk),
      resume: options.resume ?? true,
    });
    log(`sync ${options.reason}: ${result.status}`, result.items, "items");
    if (result.status !== "error") {
      await state.sync.enrich(session, accountId);
      const replayed = await state.sync.replayOutbox(session, accountId);

      if (replayed.replayed > 0 || replayed.pending > 0) {
        log(
          `outbox: applied ${replayed.replayed} queued change(s), ${replayed.pending} still waiting`
        );
      }
    }
  } catch (error) {
    log("sync failed", error);
  } finally {
    state.syncing = false;
    state.syncReason = null;
    broadcast();
  }
};

const scheduleInterval = () => {
  if (state.interval) {
    clearInterval(state.interval);
    state.interval = undefined;
  }
  const minutes = state.config?.syncIntervalMinutes ?? 0;
  if (minutes > 0) {
    state.interval = setInterval(
      () => {
        runSync({ reason: "interval" }).catch(() => undefined);
      },
      minutes * 60 * 1000
    );
  }
};

let startupSyncPending = false;

/** Follows the identity the session is acting as, whichever one the site switched to. */
const adoptSessionIndex = async (index: number) => {
  if (!Number.isFinite(index)) {
    log(`session index report was not a number (${String(index)})`);
    return;
  }
  state.sessionIndex = index;

  const account = state.accounts.find((entry) => entry.index === index);
  log(
    `session index ${index} reported; acting as ${account?.handle ?? account?.name ?? "nobody yet"}`
  );

  if (account && state.activeAccountId !== account.id) {
    await switchAccount(account.id);
    // A half-synced list belongs to the account it was synced for.
    state.store.clearCursor(account.id);
    // Everything the page is showing was drawn against the other account's list, buttons
    // included - and the two lists have nothing to do with each other.
    broadcast();
  }

  flushStartupSync("session-index");
  repairEntryIds();
};

const flushStartupSync = (reason: string) => {
  if (!startupSyncPending) {
    return;
  }
  startupSyncPending = false;
  void runSync({ reason: `start/${reason}` });
};

/**
 * An entry the app added gets its `set_video_id` from the one-page walk scheduled 15s later. If the
 * app is closed before that walk runs, nothing else teaches it, and the entry cannot be removed by
 * id until a later walk - one page at the top is enough, so it is repaired once per start.
 */
const repairEntryIds = () => {
  if (state.repairedEntryIds || !state.activeAccountId) {
    return;
  }
  state.repairedEntryIds = true;
  if (state.store.countEntriesMissingSetVideoId(state.activeAccountId) === 0) {
    return;
  }
  log("entries without an entry id: checking the top of the list");
  void runSync({ maxPages: 1, reason: "repair", resume: false });
};

export const onMainLoad = async ({
  window,
  ipc,
  getConfig,
}: BackendContext<WatchLaterPluginConfig>) => {
  state.window = window;
  state.config = await getConfig();
  state.store = new WatchLaterStore(
    openNodeSqlite(join(app.getPath("userData"), "watch-later.db"))
  );
  state.sync = new WatchLaterSync(state.store, state.config);

  ipc.handle("watchdeck:watch-later-state", () => currentState());
  ipc.handle("watchdeck:watch-later-membership", () =>
    state.activeAccountId
      ? state.store.membershipIds(state.activeAccountId)
      : []
  );
  ipc.handle("watchdeck:watch-later-query", (query: WatchLaterQuery) =>
    state.store.query(
      { ...query, accountId: state.activeAccountId ?? "" },
      // set in onMainLoad, before this handler can be registered
      state.config!
    )
  );
  ipc.handle("watchdeck:watch-later-session-index", (index: number) =>
    adoptSessionIndex(index)
  );

  ipc.handle("watchdeck:watch-later-sync", async () => {
    await runSync({ reason: "manual" });
    return currentState();
  });
  ipc.handle(
    "watchdeck:watch-later-add",
    async (videoId: string): Promise<{ ok: boolean; error?: string }> => {
      if (!state.session || !state.activeAccountId) {
        return { error: "not-signed-in", ok: false };
      }
      try {
        noteMutation(videoId);
        await state.sync.add(state.session, state.activeAccountId, videoId);
        broadcast();
        // One page is enough to learn the entry id and position we do not know yet.
        setTimeout(() => {
          runSync({ maxPages: 1, reason: "reconcile", resume: false }).catch(
            () => undefined
          );
        }, 15_000);
        return { ok: true };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
          ok: false,
        };
      }
    }
  );

  ipc.handle(
    "watchdeck:watch-later-remove",
    async (videoId: string): Promise<{ ok: boolean; error?: string }> => {
      if (!state.session || !state.activeAccountId) {
        return { error: "not-signed-in", ok: false };
      }
      try {
        noteMutation(videoId);
        await state.sync.remove(state.session, state.activeAccountId, videoId);
        broadcast();
        return { ok: true };
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
          ok: false,
        };
      }
    }
  );

  ipc.on(
    "watchdeck:watch-later-progress",
    (report: WatchLaterProgressReport) => {
      if (!state.activeAccountId || !report?.videoId) {
        return;
      }
      state.store.recordLocalProgress(state.activeAccountId, report.videoId, {
        durationSeconds: report.durationSeconds,
        ended: report.ended,
        positionSeconds: report.positionSeconds,
      });
    }
  );

  // A second window (the library) or a reconnect needs the session re-checked.
  state.window.webContents.on("did-finish-load", () => {
    connect().catch(() => undefined);
  });

  await connect();
  scheduleInterval();

  if (state.config.syncOnStart) {
    // The page has not said which identity the session acts as yet; syncing now would pull
    // whichever account happens to answer first.
    startupSyncPending = true;
    setTimeout(() => flushStartupSync("timeout"), 20_000);
  }

  log(
    state.needsAuth
      ? "loaded; sign in to sync"
      : `loaded for ${state.activeAccountId}`
  );
};

/** Used by the plugin menu; the state object is module-private on purpose. */
export const syncNow = (): Promise<void> => runSync({ reason: "menu" });

export const onConfigChange = async (config: WatchLaterPluginConfig) => {
  state.config = config;
  state.sync = new WatchLaterSync(state.store, config);
  scheduleInterval();
};

export const onMainUnload = () => {
  if (state.interval) {
    clearInterval(state.interval);
    state.interval = undefined;
  }
  state.store?.close();
  state.window = null;
  log("unloaded", t("plugins.watch-later.name"));
};
