import { For, createSignal, onCleanup, onMount } from "solid-js";

import { t } from "@/i18n";

import type {
  WatchLaterBucket,
  WatchLaterEntry,
  WatchLaterState,
  WatchLaterSyncProgress,
} from "../../types";
import type { WatchLaterBridge } from "./bridge";

/**
 * The controls that sit *above* the site's own Watch Later list. Nothing here renders a
 * list: the page's rows stay where they are, and the filter decisions are handed to the
 * caller, which shows or hides those rows.
 */
export interface ToolbarProps {
  bridge: WatchLaterBridge;
  /** Called whenever the visible set changes; `null` means "no filter, show everything". */
  onChange: (
    visible: Set<string> | null,
    entries: Map<string, WatchLaterEntry>
  ) => void;
}

const bucketLabel = (bucket: WatchLaterBucket) =>
  bucket === "in-progress"
    ? t("plugins.watch-later.filter.in-progress")
    : bucket === "watched"
      ? t("plugins.watch-later.filter.watched")
      : t("plugins.watch-later.filter.unwatched");

const Toolbar = (props: ToolbarProps) => {
  const [search, setSearch] = createSignal("");
  const [bucket, setBucket] = createSignal<WatchLaterBucket | "all">("all");
  const [state, setState] = createSignal<WatchLaterState | null>(null);
  const [entries, setEntries] = createSignal<WatchLaterEntry[]>([]);
  const [progress, setProgress] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [failure, setFailure] = createSignal(false);

  const selectedBucket = () => {
    const value = bucket();
    return value === "all" ? undefined : value;
  };

  const refresh = async () => {
    try {
      const [nextState, list] = await Promise.all([
        props.bridge.state(),
        props.bridge.query({
          bucket: selectedBucket(),
          limit: 5000,
          search: search().trim() || undefined,
        }),
      ]);
      setFailure(false);
      setState(nextState);
      setEntries(list);
      // A walk the backend starts on its own - the one-page retry after a failed write, or the
      // period - ends without this component being told, and its last line would otherwise sit in the
      // status for the rest of the session. The state says whether a walk is running: if none is,
      // clear it.
      if (!nextState.syncing) {
        setProgress(null);
      }
      props.onChange(
        bucket() === "all" && !search().trim()
          ? null
          : new Set(list.map((entry) => entry.videoId)),
        new Map(list.map((entry) => [entry.videoId, entry]))
      );
    } catch {
      // This toolbar is the only place that can say so: without it a read that fails looks like a
      // button that does nothing.
      setFailure(true);
    }
  };

  const statusText = () => {
    if (failure()) {
      return t("plugins.watch-later.status.failed");
    }
    const running = progress();
    if (running) {
      return running;
    }
    // A walk that failed leaves the mirror where it was, and the count on its own reads as if the
    // list had really shrunk. "empty page" is the site answering with nothing - a rate limit, an
    // expired read - and it is worth naming instead of showing a number nobody can trust.
    const lastError = state()?.lastSync?.error;
    if (lastError === "empty page") {
      return t("plugins.watch-later.status.empty-page");
    }
    if (lastError) {
      return t("plugins.watch-later.status.last-error", { error: lastError });
    }
    const mirrored = state()?.totalEntries ?? 0;
    const total = state()?.expectedTotal;
    return total && total > mirrored
      ? t("plugins.watch-later.status.mirrored-of", {
          items: mirrored,
          total,
        })
      : t("plugins.watch-later.status.mirrored", { count: mirrored });
  };

  const syncLabel = () => {
    if (busy()) {
      return t("plugins.watch-later.sync.running");
    }
    const current = state();
    if (current?.syncing) {
      // A walk the backend started by itself is not a full sync, and naming it as one makes the
      // button look like it is doing work nobody asked for.
      return current.syncReason === "reconcile" ||
        current.syncReason === "repair"
        ? t("plugins.watch-later.sync.reconciling")
        : t("plugins.watch-later.sync.running");
    }
    return t("plugins.watch-later.sync.now");
  };

  onMount(() => {
    refresh().catch(() => undefined);
    props.bridge.onChanged(() => refresh().catch(() => undefined));
    props.bridge.onProgress((current: WatchLaterSyncProgress) =>
      setProgress(
        t("plugins.watch-later.sync.progress", {
          items: current.items,
          pages: current.pages,
          total: current.totalItems ?? "?",
        })
      )
    );
  });

  let searchTimer: number | undefined;
  const scheduleRefresh = (delay: number) => {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(
      () => refresh().catch(() => undefined),
      delay
    );
  };
  onCleanup(() => clearTimeout(searchTimer));

  const counts = () => {
    const list = entries();
    return {
      inProgress: list.filter((entry) => entry.bucket === "in-progress").length,
      watched: list.filter((entry) => entry.bucket === "watched").length,
    };
  };

  const runSync = async () => {
    setBusy(true);
    try {
      setState(await props.bridge.sync());
      await refresh();
    } catch {
      setFailure(true);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div class="wd-wl-toolbar">
      <input
        aria-label={t("plugins.watch-later.search.label")}
        onInput={(event) => {
          setSearch(event.currentTarget.value);
          scheduleRefresh(250);
        }}
        placeholder={t("plugins.watch-later.search.placeholder")}
        type="search"
        value={search()}
      />
      <div class="wd-wl-chips">
        <For
          each={
            [
              [
                "all",
                t("plugins.watch-later.filter.all", {
                  count: entries().length,
                }),
              ],
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
              class={
                bucket() === value
                  ? "wd-wl-chip wd-wl-chip-active"
                  : "wd-wl-chip"
              }
              onClick={() => {
                setBucket(value);
                scheduleRefresh(0);
              }}
              type="button"
            >
              {label}
            </button>
          )}
        </For>
      </div>
      <div class="wd-wl-toolbar-right">
        <button
          class="wd-wl-chip wd-wl-sync"
          disabled={busy() || (state()?.syncing ?? false)}
          onClick={() => runSync().catch(() => undefined)}
          type="button"
        >
          {syncLabel()}
        </button>
        <span class="wd-wl-status">{statusText()}</span>
      </div>
    </div>
  );
};

export default Toolbar;
