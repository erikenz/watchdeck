import { render } from "solid-js/web";

import { t } from "@/i18n";
import type { RendererContext } from "@/types/contexts";
import type { MusicPlayer } from "@/types/music-player";

import { isWatchLaterPage } from "../site";
import type {
  WatchLaterEntry,
  WatchLaterPluginConfig,
  WatchLaterState,
  WatchLaterSyncProgress,
} from "../types";
import {
  alignButton,
  BUTTON_CLASS,
  cardOf,
  createSaveButton,
  HOST_CLASS,
  isThumbnailHost,
  mediaBoxOf,
  paintButton,
  PREVIEW_OPEN_CLASS,
  PREVIEW_SELECTOR,
  shownPreview,
  THUMBNAIL_HOST_SELECTOR,
  videoIdFromHost,
} from "./dom";
import type { ButtonState } from "./dom";
import type { WatchLaterBridge } from "./ui/bridge";
import {
  applyRowVisibility,
  enhanceRow,
  ROW_HIDDEN_CLASS,
  ROW_META_CLASS,
  ROW_SELECTOR,
  rowVideoId,
  TOOLBAR_HOST_CLASS,
  toolbarInsertionPoint,
} from "./ui/rows";
import Toolbar from "./ui/toolbar";

/** How often the local high-water mark is reported while something plays. */
const PROGRESS_INTERVAL_MS = 5000;

const overlapArea = (one: DOMRect, other: DOMRect) =>
  Math.max(
    0,
    Math.min(one.right, other.right) - Math.max(one.left, other.left)
  ) *
  Math.max(
    0,
    Math.min(one.bottom, other.bottom) - Math.max(one.top, other.top)
  );

type Ipc = RendererContext<WatchLaterPluginConfig>["ipc"];

export const renderer = {
  api: null as MusicPlayer | null,
  config: null as WatchLaterPluginConfig | null,
  ipc: null as Ipc | null,
  membership: new Set<string>(),
  observer: null as MutationObserver | null,
  pending: new Set<string>(),
  scanQueued: false,
  previewMarkQueued: false,
  lastProgressSentAt: 0,
  sessionIndexAttempts: 0,
  toolbarHost: null as HTMLElement | null,
  filter: null as Set<string> | null,
  rowEntries: new Map<string, WatchLaterEntry>(),
  context: null as RendererContext<WatchLaterPluginConfig> | null,
  videoDataListener: null as ((event: Event) => void) | null,
  timeUpdateListener: null as ((event: Event) => void) | null,
  previewCard: null as Element | null,
  previewObserved: null as Element | null,
  previewObserver: null as MutationObserver | null,

  async start(context: RendererContext<WatchLaterPluginConfig>) {
    this.ipc = context.ipc;
    this.context = context;
    this.config = await context.getConfig();

    await this.hydrate();
    this.reportSessionIndex(context);
    this.mountToolbar(context);

    this.resizeListener = this.onResize.bind(this);
    window.addEventListener("resize", this.resizeListener, { passive: true });
    this.cardEnterListener = this.onCardEnter.bind(this);
    document.addEventListener("mouseover", this.cardEnterListener, {
      passive: true,
    });
    this.observer = new MutationObserver(() => this.queueScan());
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    this.queueScan();

    context.ipc.on(
      "watchdeck:watch-later-changed",
      (state: WatchLaterState) => {
        void this.hydrate();
        void state;
      }
    );

    // Bound once so `stop` can remove exactly what was added.
    this.videoDataListener = this.onVideoDataChange.bind(this);
    this.timeUpdateListener = this.onTimeUpdate.bind(this);
    document.addEventListener("videodatachange", this.videoDataListener);
    this.navigateListener = this.onNavigate.bind(this);
    document.addEventListener("yt-navigate-finish", this.navigateListener);
    document
      .querySelector("video")
      ?.addEventListener("timeupdate", this.timeUpdateListener);
  },

  /**
   * The site's Watch Later page gets a toolbar above its own list and a line of context on
   * each of its rows. Nothing is re-rendered here: the page keeps its list, and the
   * filters decide which of its rows stay visible.
   */
  mountToolbar(context: RendererContext<WatchLaterPluginConfig>) {
    if (!this.config?.enhancePage || !isWatchLaterPage()) {
      this.toolbarHost?.remove();
      this.toolbarHost = null;
      this.filter = null;
      this.applyRows();
      return;
    }

    const point = toolbarInsertionPoint();
    if (!point) {
      return;
    }
    if (this.toolbarHost?.isConnected) {
      // The site renders its parts in whatever order it likes: if the header showed up after
      // we mounted, move the toolbar to where it belongs instead of leaving it among the rows.
      const expected = point.before ?? point.parent.lastElementChild;
      if (this.toolbarHost.previousElementSibling !== expected) {
        point.parent.insertBefore(this.toolbarHost, point.before);
      }
      return;
    }

    const host = document.createElement("div");
    host.className = TOOLBAR_HOST_CLASS;
    this.toolbarHost = host;
    point.parent.insertBefore(host, point.before);

    const bridge: WatchLaterBridge = {
      add: (videoId) =>
        context.ipc.invoke("watchdeck:watch-later-add", videoId),
      onChanged: (listener) =>
        context.ipc.on(
          "watchdeck:watch-later-changed",
          (state: WatchLaterState) => listener(state)
        ),
      onProgress: (listener) =>
        context.ipc.on(
          "watchdeck:watch-later-sync-progress",
          (progress: WatchLaterSyncProgress) => listener(progress)
        ),
      query: (query) =>
        context.ipc.invoke("watchdeck:watch-later-query", query),
      remove: (videoId) =>
        context.ipc.invoke("watchdeck:watch-later-remove", videoId),
      state: () => context.ipc.invoke("watchdeck:watch-later-state"),
      sync: () => context.ipc.invoke("watchdeck:watch-later-sync"),
    };

    render(
      () => (
        <Toolbar
          bridge={bridge}
          onChange={(visible, entries) => {
            this.filter = visible;
            this.rowEntries = entries;
            this.applyRows();
          }}
        />
      ),
      host
    );
  },

  navigateListener: null as ((event: Event) => void) | null,
  resizeListener: null as ((event: Event) => void) | null,
  cardEnterListener: null as ((event: Event) => void) | null,
  hoveredCard: null as Element | null,

  /**
   * Enrich and (when a filter is on) show or hide the rows of the *Watch Later* page. Every
   * other page is left exactly as the site rendered it: this is bookkeeping for a list you
   * are curating, not decoration for browsing.
   */
  applyRows() {
    const onWatchLater = isWatchLaterPage();
    for (const row of document.querySelectorAll(ROW_SELECTOR)) {
      if (!onWatchLater) {
        row.classList.remove(ROW_HIDDEN_CLASS);
        row.querySelector(`.${ROW_META_CLASS}`)?.remove();
        continue;
      }
      const videoId = rowVideoId(row);
      const visible = applyRowVisibility(row, this.filter);
      if (visible && videoId) {
        enhanceRow(row, this.rowEntries.get(videoId));
      }
    }
  },

  /** The site is a single-page app: the toolbar and the row state follow navigation. */
  onNavigate() {
    if (this.context) {
      this.mountToolbar(this.context);
      this.applyRows();
    }
  },

  stop(context: RendererContext<WatchLaterPluginConfig>) {
    if (this.resizeListener) {
      window.removeEventListener("resize", this.resizeListener);
      this.resizeListener = null;
    }
    if (this.cardEnterListener) {
      document.removeEventListener("mouseover", this.cardEnterListener);
      this.cardEnterListener = null;
    }
    this.hoveredCard = null;
    this.previewObserver?.disconnect();
    this.previewObserver = null;
    this.previewObserved = null;
    this.unmarkPreview();
    this.toolbarHost?.remove();
    this.toolbarHost = null;
    this.filter = null;
    for (const row of document.querySelectorAll(ROW_SELECTOR)) {
      row.classList.remove("wd-wl-row-hidden");
      row.querySelector(".wd-wl-row-meta")?.remove();
    }
    if (this.navigateListener) {
      document.removeEventListener("yt-navigate-finish", this.navigateListener);
      this.navigateListener = null;
    }
    this.observer?.disconnect();
    this.observer = null;
    for (const button of document.querySelectorAll(`.${BUTTON_CLASS}`)) {
      button.remove();
    }
    for (const host of document.querySelectorAll(`.${HOST_CLASS}`)) {
      host.classList.remove(HOST_CLASS);
    }
    context.ipc.removeAllListeners("watchdeck:watch-later-changed");
    if (this.videoDataListener) {
      document.removeEventListener("videodatachange", this.videoDataListener);
      this.videoDataListener = null;
    }
    if (this.timeUpdateListener) {
      document
        .querySelector("video")
        ?.removeEventListener("timeupdate", this.timeUpdateListener);
      this.timeUpdateListener = null;
    }
  },

  onConfigChange(config: WatchLaterPluginConfig) {
    this.config = config;
    this.repaint();
  },

  onPlayerApiReady(api: MusicPlayer) {
    this.api = api;
  },

  async hydrate() {
    if (!this.ipc) {
      return;
    }
    try {
      const ids = (await this.ipc.invoke(
        "watchdeck:watch-later-membership"
      )) as string[];
      this.membership = new Set(ids);
      this.repaint();
    } catch {
      // Not signed in yet, or the backend is still starting: the buttons simply
      // stay in their unsaved state.
    }
  },

  /**
   * Tells the backend which account the page is acting as - with two identities under one
   * login this is the only signal that says which Watch Later to sync. `ytcfg` is the
   * page's own global and is not there yet when the renderer starts, so this waits for it.
   */
  reportSessionIndex(context: RendererContext<WatchLaterPluginConfig>) {
    const ytcfg = (
      window as unknown as { ytcfg?: { get: (key: string) => unknown } }
    ).ytcfg;
    const index = Number(ytcfg?.get("SESSION_INDEX") ?? Number.NaN);

    if (Number.isFinite(index)) {
      context.ipc.send("watchdeck:watch-later-session-index", index);
      return;
    }
    if (this.sessionIndexAttempts < 40) {
      this.sessionIndexAttempts += 1;
      setTimeout(() => this.reportSessionIndex(context), 500);
    }
  },

  queueScan() {
    if (this.scanQueued) {
      return;
    }
    this.scanQueued = true;
    requestAnimationFrame(() => {
      this.scanQueued = false;
      this.scan();
    });
  },

  scan() {
    if (this.context) {
      this.mountToolbar(this.context);
    }
    this.applyRows();

    // On the Watch Later page every row is already saved, so a button per row is noise.
    if (
      !this.config?.showHoverButton ||
      (this.config.enhancePage && isWatchLaterPage())
    ) {
      this.unmarkPreview();
      return;
    }

    for (const host of document.querySelectorAll(THUMBNAIL_HOST_SELECTOR)) {
      if (!isThumbnailHost(host)) {
        continue;
      }
      // Host on the card, not on the thumbnail link inside it: the site's inline preview
      // replaces the thumbnail with a surface outside that link, so a button anchored there
      // only shows up when the pointer is over the little of the link that is left.
      const card = cardOf(host) ?? host;
      const videoId = videoIdFromHost(card);
      if (!videoId || card.closest(`.${HOST_CLASS}`)) {
        continue;
      }
      const existing = card.querySelector<HTMLButtonElement>(
        `.${BUTTON_CLASS}`
      );
      if (existing) {
        // The card may have swapped its thumbnail for the inline preview since last scan.
        alignButton(existing, card);
        this.paint(existing);
        continue;
      }
      if (this.isOwnSurface(card)) {
        continue;
      }
      card.classList.add(HOST_CLASS);
      const button = createSaveButton(videoId, (button_) => {
        this.toggle(button_).catch(() => undefined);
      });
      card.append(button);
      alignButton(button, card);
      // Paint it now: an unpainted button has no state, and a button with no state is an
      // invisible button (which is what "sometimes there is no button" was).
      this.paint(button);
      // Hovering can bring the preview in and move the video box; the button follows it.
      card.addEventListener("mouseenter", () => alignButton(button, card), {
        passive: true,
      });
    }
    this.markPreview();
  },

  /**
   * The site plays its inline preview in one overlay it moves over the hovered card, and while it
   * plays that overlay takes the pointer (`ytd-video-preview[active]` is `pointer-events: auto`),
   * so the card stops being `:hover`ed and a button that follows `:hover` fades out exactly while
   * the user is looking at it. Marking the covered card keeps its button up for as long as the
   * overlay is there. The mark only decides visibility - the button sits at the same offset in
   * every state.
   */
  markPreview() {
    const preview = shownPreview();
    const card = preview ? this.cardUnderPreview(preview) : null;
    this.observePreview();
    if (card === this.previewCard) {
      return;
    }
    this.previewCard?.classList.remove(PREVIEW_OPEN_CLASS);
    this.previewCard = card;
    card?.classList.add(PREVIEW_OPEN_CLASS);
  },

  /**
   * The preview shows and hides by setting attributes on itself, which the document observer
   * (structure only) never sees; that one element gets an observer of its own. Buttons left in
   * it by an older build are dropped: this overlay is not a host any more.
   */
  observePreview() {
    const preview = document.querySelector(PREVIEW_SELECTOR);
    if (preview && this.previewObserved !== preview) {
      this.previewObserver ??= new MutationObserver(() =>
        this.queuePreviewMark()
      );
      this.previewObserver.disconnect();
      this.previewObserver.observe(preview, {
        attributeFilter: ["active", "playing", "style"],
        attributes: true,
      });
      this.previewObserved = preview;
    }
    if (this.previewObserved) {
      for (const stray of this.previewObserved.querySelectorAll(
        `.${BUTTON_CLASS}`
      )) {
        stray.remove();
      }
    }
  },

  /** The card the preview is sitting on: the one under the pointer, or the one it covers. */
  cardUnderPreview(preview: Element): Element | null {
    const box = preview.getBoundingClientRect();
    const hovered = this.hoveredCard;
    if (hovered?.isConnected) {
      const media = mediaBoxOf(hovered);
      if (media && overlapArea(media.box, box) > 0) {
        return hovered;
      }
    }
    // While it plays the preview is the element under the pointer, so no card is hovered and
    // the one it was opened from has to be found by geometry.
    let found: Element | null = null;
    let foundArea = 0;
    for (const card of document.querySelectorAll(`.${HOST_CLASS}`)) {
      const media = mediaBoxOf(card);
      const area = media ? overlapArea(media.box, box) : 0;
      if (area > foundArea) {
        found = card;
        foundArea = area;
      }
    }
    return found;
  },

  unmarkPreview() {
    for (const card of document.querySelectorAll(`.${PREVIEW_OPEN_CLASS}`)) {
      card.classList.remove(PREVIEW_OPEN_CLASS);
    }
    this.previewCard = null;
  },

  /** Marks are geometry, and geometry changes without a structure change: coalesce them. */
  queuePreviewMark() {
    if (this.previewMarkQueued) {
      return;
    }
    this.previewMarkQueued = true;
    requestAnimationFrame(() => {
      this.previewMarkQueued = false;
      this.markPreview();
    });
  },

  /** The list inside our own UI must not grow buttons. */
  isOwnSurface(host: Element) {
    return host.closest("[data-watchdeck-owned]") !== null;
  },

  paint(button: HTMLButtonElement) {
    const videoId = button.dataset.videoId ?? "";
    const labels = {
      remove: t("plugins.watch-later.button.remove"),
      save: t("plugins.watch-later.button.save"),
    };
    let state: ButtonState = "unsaved";
    if (this.pending.has(videoId)) {
      state = "pending";
    } else if (this.membership.has(videoId)) {
      state = "saved";
    }
    paintButton(button, state, labels);
  },

  repaint() {
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      `.${BUTTON_CLASS}`
    )) {
      this.paint(button);
    }
  },

  async toggle(button: HTMLButtonElement) {
    const videoId = button.dataset.videoId;
    if (!videoId || !this.ipc || this.pending.has(videoId)) {
      return;
    }

    const wasSaved = this.membership.has(videoId);
    this.pending.add(videoId);
    // Optimistic: the click has to feel instant, and it is reverted on failure.
    if (wasSaved) {
      this.membership.delete(videoId);
    } else {
      this.membership.add(videoId);
    }
    this.repaint();

    try {
      const result = (await this.ipc.invoke(
        wasSaved ? "watchdeck:watch-later-remove" : "watchdeck:watch-later-add",
        videoId
      )) as { ok: boolean; error?: string };

      if (!result.ok) {
        throw new Error(result.error ?? "failed");
      }
      if (wasSaved) {
        this.membership.delete(videoId);
      } else {
        this.membership.add(videoId);
      }
    } catch {
      if (wasSaved) {
        this.membership.add(videoId);
      } else {
        this.membership.delete(videoId);
      }
      button.dataset.state = "error";
      setTimeout(() => this.repaint(), 1200);
    } finally {
      this.pending.delete(videoId);
      this.repaint();
    }
  },

  onCardEnter(event: Event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    // The preview is the pointer's target while it plays, so this may be no card at all: keep
    // the last one instead of forgetting which card the pointer came from.
    const card = cardOf(target);
    if (card) {
      this.hoveredCard = card;
    }
    this.queuePreviewMark();
  },

  onResize() {
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      `.${BUTTON_CLASS}`
    )) {
      const host = button.closest(`.${HOST_CLASS}`);
      if (host) {
        alignButton(button, host);
      }
    }
  },

  onVideoDataChange() {
    this.lastProgressSentAt = 0;
  },

  onTimeUpdate() {
    if (!this.api || !this.ipc) {
      return;
    }
    const now = Date.now();
    if (now - this.lastProgressSentAt < PROGRESS_INTERVAL_MS) {
      return;
    }
    this.lastProgressSentAt = now;

    const data = this.api.getVideoData?.();
    const videoId = data?.video_id;
    if (!videoId) {
      return;
    }

    this.ipc.send("watchdeck:watch-later-progress", {
      durationSeconds: this.api.getDuration(),
      positionSeconds: this.api.getCurrentTime(),
      videoId,
    });
  },
};
