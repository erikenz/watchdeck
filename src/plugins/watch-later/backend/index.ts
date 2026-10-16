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
  interval?: NodeJS.Timeout;
  window: BackendContext<WatchLaterPluginConfig>["window"] | null;
  config: WatchLaterPluginConfig | null;
}

const state: BackendState = {
  accounts: [],
  activeAccountId: null,
  config: null,
  needsAuth: false,
  session: null,
  sessionIndex: null,
  // Both are assigned in onMainLoad, before any IPC handler or menu click can use
  // them; the assertion is the module-private way of saying so.
  store: null!,
  sync: null!,
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

/** Cookies are the source of truth for "who is signed in"; the DB only remembers. */
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

  const preferred = state.config?.activeAccountId
    ? state.store.getAccount(state.config.activeAccountId)
    : undefined;

  try {
    state.session = await WatchLaterSession.create(
      cookies,
      preferred?.index ?? 0
    );
    const accounts = await state.session.listAccounts();
    for (const account of accounts) {
      state.store.upsertAccount(account);
    }
    state.accounts = state.store.listAccounts();

    // Default to the account the *page* is acting as: with two identities under one
    // login, "the first one" is a coin flip and the wrong list looks like a bug.
    const active =
      preferred ??
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
    state.activeAccountId = preferred?.id ?? state.accounts[0]?.id ?? null;
  }
};

export const switchAccount = async (accountId: string) => {
  const account = state.accounts.find((entry) => entry.id === accountId);
  if (!account) {
    throw new Error(`unknown account ${accountId}`);
  }
  state.session?.setAccountIndex(account.index);
  state.activeAccountId = account.id;
  log(`switched to ${account.name} (authuser ${account.index})`);
};

const runSync = async (options: {
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
  broadcast();

  const accountId = state.activeAccountId;
  const session = state.session;

  try {
    const result = await state.sync.pull(session, {
      accountId,
      onProgress: (progress) =>
        state.window?.webContents.send("watchdeck:watch-later-sync-progress", {
          accountId,
          ...progress,
        }),
      resume: options.resume ?? true,
    });
    log(`sync ${options.reason}: ${result.status}`, result.items, "items");
    if (result.status !== "error") {
      await state.sync.enrich(session, accountId);
      await state.sync.replayOutbox(session, accountId);
    }
  } catch (error) {
    log("sync failed", error);
  } finally {
    state.syncing = false;
    broadcast();
  }
};

const scheduleInterval = () => {
  if (state.interval) {
    clearInterval(state.interval);
    state.interval = undefined;
  }
  const hours = state.config?.syncIntervalHours ?? 0;
  if (hours > 0) {
    state.interval = setInterval(
      () => {
        runSync({ reason: "interval" }).catch(() => undefined);
      },
      hours * 60 * 60 * 1000
    );
  }
};

let startupSyncPending = false;

/**
 * Adopts the account the page is acting as, but only while the user has not picked one:
 * an explicit choice (config or menu) always wins.
 */
const adoptSessionIndex = async (index: number) => {
  if (!Number.isFinite(index)) {
    return;
  }
  state.sessionIndex = index;

  const active = state.activeAccountId
    ? state.store.getAccount(state.activeAccountId)
    : undefined;
  if (!state.config?.activeAccountId && active && active.index !== index) {
    const account = state.accounts.find((entry) => entry.index === index);
    if (account) {
      log(
        `following the page's account: ${account.handle ?? account.name} (authuser ${index})`
      );
      await switchAccount(account.id);
      state.store.clearCursor(account.id);
    }
  }

  flushStartupSync("session-index");
};

const flushStartupSync = (reason: string) => {
  if (!startupSyncPending) {
    return;
  }
  startupSyncPending = false;
  void runSync({ reason: `start/${reason}` });
};

export const onMainLoad = async ({
  window,
  ipc,
  getConfig,
  setConfig,
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
  ipc.on("watchdeck:watch-later-session-index", (index: number) => {
    void adoptSessionIndex(index);
  });

  ipc.handle("watchdeck:watch-later-sync", async () => {
    await runSync({ reason: "manual" });
    return currentState();
  });
  ipc.handle(
    "watchdeck:watch-later-switch-account",
    async (accountId: string) => {
      await switchAccount(accountId);
      await setConfig({ activeAccountId: accountId });
      if (state.config) {
        state.config.activeAccountId = accountId;
      }
      // The list is per account; start over rather than showing a stale one.
      if (state.activeAccountId) {
        state.store.clearCursor(state.activeAccountId);
      }
      broadcast();
      return currentState();
    }
  );

  ipc.handle(
    "watchdeck:watch-later-add",
    async (videoId: string): Promise<{ ok: boolean; error?: string }> => {
      if (!state.session || !state.activeAccountId) {
        return { error: "not-signed-in", ok: false };
      }
      try {
        await state.sync.add(state.session, state.activeAccountId, videoId);
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

  ipc.handle(
    "watchdeck:watch-later-remove",
    async (videoId: string): Promise<{ ok: boolean; error?: string }> => {
      if (!state.session || !state.activeAccountId) {
        return { error: "not-signed-in", ok: false };
      }
      try {
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
    if (state.config.activeAccountId) {
      void runSync({ reason: "start" });
    } else {
      // The page has not told us which account it is on yet; syncing now would pull
      // whichever identity happens to answer first.
      startupSyncPending = true;
      setTimeout(() => void flushStartupSync("timeout"), 20_000);
    }
  }

  log(
    state.needsAuth
      ? "loaded; sign in to sync"
      : `loaded for ${state.activeAccountId}`
  );
};

/** Used by the plugin menu; the state object is module-private on purpose. */
export const listAccounts = (): WatchLaterAccount[] => state.accounts;

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
