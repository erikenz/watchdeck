import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { VList } from "virtua/solid";

import { watchUrl } from "../../site";
import type {
  WatchLaterBucket,
  WatchLaterEntry,
  WatchLaterState,
  WatchLaterSyncProgress,
} from "../../types";

/** Everything the panel needs; the renderer hands it in from its IPC context. */
export interface WatchLaterBridge {
  add: (videoId: string) => Promise<{ ok: boolean; error?: string }>;
  onChanged: (listener: (state: WatchLaterState) => void) => void;
  onProgress: (listener: (progress: WatchLaterSyncProgress) => void) => void;
  query: (query: {
    bucket?: WatchLaterBucket;
    limit?: number;
    search?: string;
  }) => Promise<WatchLaterEntry[]>;
  remove: (videoId: string) => Promise<{ ok: boolean; error?: string }>;
  state: () => Promise<WatchLaterState>;
  switchAccount: (accountId: string) => Promise<WatchLaterState>;
  sync: () => Promise<WatchLaterState>;
}

type SortKey = "channel" | "longest" | "saved" | "shortest";

const formatDuration = (seconds?: number) => {
  if (!seconds) {
    return "";
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
};

const bucketLabel = (bucket: WatchLaterBucket) =>
  bucket === "in-progress"
    ? "Continue watching"
    : bucket === "watched"
      ? "Watched"
      : "Unwatched";

const Panel = (props: { bridge: WatchLaterBridge }) => {
  // The host element doubles as the collapsed pill: `data-open` drives the CSS, so the
  // page keeps its own layout whether the panel is open or not.

  const api = props.bridge;
  const [state, setState] = createSignal<WatchLaterState | null>(null);
  const [entries, setEntries] = createSignal<WatchLaterEntry[]>([]);
  const [bucket, setBucket] = createSignal<WatchLaterBucket | "all">("all");
  const [search, setSearch] = createSignal("");
  const [sort, setSort] = createSignal<SortKey>("saved");
  const [busy, setBusy] = createSignal(false);
  const [progress, setProgress] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [open, setOpen] = createSignal(true);

  const selectedBucket = () => {
    const value = bucket();
    return value === "all" ? undefined : value;
  };

  const refresh = async () => {
    const [nextState, list] = await Promise.all([
      api.state(),
      api.query({
        bucket: selectedBucket(),
        limit: 5000,
        search: search().trim() || undefined,
      }),
    ]);
    setState(nextState);
    setEntries(list);
  };

  onMount(() => {
    refresh().catch(() => undefined);
    api.onChanged(() => refresh().catch(() => undefined));
    api.onProgress((current) =>
      setProgress(
        `${current.items} of ${current.totalItems ?? "?"} entries (page ${current.pages})`
      )
    );
  });

  // Search is debounced; the other filters re-query immediately.
  let searchTimer: number | undefined;
  createEffect(() => {
    const term = search();
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(
      () => refresh().catch(() => undefined),
      term ? 250 : 0
    );
    onCleanup(() => clearTimeout(searchTimer));
  });
  createEffect(() => {
    bucket();
    refresh().catch(() => undefined);
  });

  const comparators: Record<
    SortKey,
    (left: WatchLaterEntry, right: WatchLaterEntry) => number
  > = {
    channel: (left, right) =>
      (left.channelTitle ?? "").localeCompare(right.channelTitle ?? ""),
    longest: (left, right) =>
      (right.durationSeconds ?? 0) - (left.durationSeconds ?? 0),
    saved: () => 0,
    shortest: (left, right) =>
      (left.durationSeconds ?? 0) - (right.durationSeconds ?? 0),
  };

  const sorted = () => [...entries()].sort(comparators[sort()]);

  const counts = () => {
    const list = entries();
    return {
      inProgress: list.filter((entry) => entry.bucket === "in-progress").length,
      watched: list.filter((entry) => entry.bucket === "watched").length,
    };
  };

  const runSync = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await api.sync());
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const remove = async (entry: WatchLaterEntry) => {
    // Optimistic: the row disappears now and comes back if the mutation fails.
    setEntries((list) => list.filter((item) => item.videoId !== entry.videoId));
    const result = await api.remove(entry.videoId);
    if (!result.ok) {
      setError(result.error ?? "Could not remove");
      await refresh();
    }
  };

  // Clicking the collapsed pill reopens the panel.
  onMount(() => {
    const host = document.querySelector<HTMLElement>(".wd-wl-panel-root");
    host?.addEventListener("click", () => {
      if (host.dataset.open === "false") {
        host.dataset.open = "true";
        setOpen(true);
      }
    });
  });

  return (
    <div class="app" data-open={open()}>
      <header>
        <div>
          <h1>Watch Later</h1>
          <p class="muted">
            <Show when={state()} fallback="Loading…">
              <span>{state()?.totalEntries ?? 0} entries</span>
              <Show when={state()?.lastSync}>
                {" · last sync "}
                {new Date(state()?.lastSync?.startedAt ?? "").toLocaleString()}
                {" · "}
                {state()?.lastSync?.status}
              </Show>
            </Show>
          </p>
        </div>
        <div class="controls">
          <Show when={(state()?.accounts.length ?? 0) > 1}>
            <select
              aria-label="Account"
              onChange={(event) =>
                api
                  .switchAccount(event.currentTarget.value)
                  .then(refresh)
                  .catch(() => undefined)
              }
              // The options come from <For>, so a `value` attribute is applied before they
              // exist and the select would show the first account instead of the active
              // one; set it once the element is in the DOM, and again on every change.
              ref={(element) =>
                createEffect(() => {
                  element.value = state()?.activeAccountId ?? "";
                })
              }
            >
              <For each={state()?.accounts ?? []}>
                {(account) => (
                  <option value={account.id}>
                    {account.handle ?? account.name}
                    {account.byline ? ` · ${account.byline}` : ""}
                  </option>
                )}
              </For>
            </select>
          </Show>
          <button
            class="primary"
            disabled={busy() || (state()?.syncing ?? false)}
            onClick={() => runSync().catch(() => undefined)}
            type="button"
          >
            {busy() || state()?.syncing ? "Syncing…" : "Sync now"}
          </button>
          <button
            class="toggle"
            onClick={() => {
              setOpen(false);
              const host =
                document.querySelector<HTMLElement>(".wd-wl-panel-root");
              if (host) {
                host.dataset.open = "false";
              }
            }}
            title="Hide the panel"
            type="button"
          >
            Hide
          </button>
        </div>
      </header>

      <Show when={state()?.needsAuth}>
        <p class="banner">
          Not signed in. Sign in to YouTube in the app's main window and sync
          again.
        </p>
      </Show>
      <Show when={error()}>
        <p class="banner error">{error()}</p>
      </Show>
      <Show when={progress()}>
        <p class="banner">{progress()}</p>
      </Show>

      <div class="toolbar">
        <input
          aria-label="Search"
          onInput={(event) => setSearch(event.currentTarget.value)}
          placeholder="Search title, channel, description…"
          type="search"
          value={search()}
        />
        <div class="tabs">
          <For
            each={
              [
                ["all", `All (${entries().length})`],
                [
                  "in-progress",
                  `${bucketLabel("in-progress")} (${counts().inProgress})`,
                ],
                ["watched", `${bucketLabel("watched")} (${counts().watched})`],
                ["unwatched", bucketLabel("unwatched")],
              ] as const
            }
          >
            {([value, label]) => (
              <button
                class={bucket() === value ? "tab active" : "tab"}
                onClick={() => setBucket(value)}
                type="button"
              >
                {label}
              </button>
            )}
          </For>
        </div>
        <select
          aria-label="Sort"
          onChange={(event) => setSort(event.currentTarget.value as SortKey)}
          value={sort()}
        >
          <option value="saved">Recently saved</option>
          <option value="longest">Longest first</option>
          <option value="shortest">Shortest first</option>
          <option value="channel">Channel</option>
        </select>
      </div>

      <main>
        <Show
          when={sorted().length > 0}
          fallback={<p class="muted empty">Nothing matches these filters.</p>}
        >
          <VList data={sorted()} itemSize={76}>
            {(entry) => (
              <div class="row">
                <img
                  alt=""
                  height="56"
                  loading="lazy"
                  src={entry.thumbnailUrl ?? ""}
                  width="100"
                />
                <div class="details">
                  <a class="title" href={watchUrl(entry.videoId)}>
                    {entry.title}
                  </a>
                  <p class="muted">
                    {entry.channelTitle ?? "unknown channel"}
                    {" · "}
                    {formatDuration(entry.durationSeconds)}
                    {" · "}
                    {bucketLabel(entry.bucket)}
                    <Show when={entry.progressSource !== "none"}>
                      {" · "}
                      {Math.round(entry.ratio * 100)}% watched (
                      {entry.progressSource})
                    </Show>
                  </p>
                  <div class="bar">
                    <div
                      class="bar-fill"
                      style={{ width: `${Math.min(100, entry.ratio * 100)}%` }}
                    />
                  </div>
                </div>
                <button
                  class="ghost"
                  onClick={() => remove(entry).catch(() => undefined)}
                  title="Remove from Watch Later"
                  type="button"
                >
                  Remove
                </button>
              </div>
            )}
          </VList>
        </Show>
      </main>
    </div>
  );
};

export default Panel;
