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
  cardUnderPoint,
  createSaveButton,
  FLOATING_LAYER_CLASS,
  HOST_CLASS,
  isThumbnailHost,
  MEDIA_HOVER_CLASS,
  paintButton,
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
  toolbarNeedsMoving,
} from "./ui/rows";
import Toolbar from "./ui/toolbar";

/** How often the local high-water mark is reported while something plays. */
const PROGRESS_INTERVAL_MS = 5000;

type Ipc = RendererContext<WatchLaterPluginConfig>["ipc"];

export const renderer = {
  api: null as MusicPlayer | null,
  config: null as WatchLaterPluginConfig | null,
  ipc: null as Ipc | null,
  membership: new Set<string>(),
  observer: null as MutationObserver | null,
  pending: new Set<string>(),
  scanQueued: false,
  pointerMarkQueued: false,
  lastPointer: { x: -1, y: -1 },
  lastProgressSentAt: 0,
  sessionIndexAttempts: 0,
  reportedSessionIndex: null as number | null,
  toolbarHost: null as HTMLElement | null,
  filter: null as Set<string> | null,
  /** Cards to their button. A floating button lives outside its card, so a query cannot find it. */
  buttons: new WeakMap<Element, HTMLButtonElement>(),
  rowEntries: new Map<string, WatchLaterEntry>(),
  context: null as RendererContext<WatchLaterPluginConfig> | null,
  videoDataListener: null as ((event: Event) => void) | null,
  timeUpdateListener: null as ((event: Event) => void) | null,
  pointerMoveListener: null as ((event: PointerEvent) => void) | null,
  pointerGoneListener: null as ((event: PointerEvent) => void) | null,
  scrollListener: null as (() => void) | null,
  markedCard: null as Element | null,

  async start(context: RendererContext<WatchLaterPluginConfig>) {
    this.ipc = context.ipc;
    this.context = context;
    this.config = await context.getConfig();

    await this.hydrate();
    this.reportSessionIndex(context);
    this.mountToolbar(context);

    this.resizeListener = this.onResize.bind(this);
    window.addEventListener("resize", this.resizeListener, { passive: true });
    this.pointerMoveListener = this.onPointerMove.bind(this);
    document.addEventListener("pointermove", this.pointerMoveListener, {
      passive: true,
    });
    this.pointerGoneListener = this.onPointerGone.bind(this);
    // `pointerout` bubbles, and `relatedTarget === null` means the pointer left the page rather
    // than an element inside it. `pointerleave` was the obvious event and the wrong one: it does
    // not bubble, so listening for it on `document` only works with `capture`, and in the capture
    // phase it fires for *every* element the pointer leaves - the thumbnail, the card, the
    // preview's own `<video>`. Each of those cleared the last pointer position, so a move that
    // landed on a card right after a fast hover in/out/in left the button hidden until the pointer
    // twitched again.
    document.addEventListener("pointerout", this.pointerGoneListener, {
      passive: true,
    });
    this.scrollListener = this.queuePointerMark.bind(this);
    document.addEventListener("scroll", this.scrollListener, {
      capture: true,
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
    const placed = this.toolbarHost;
    if (placed?.isConnected) {
      // The site renders its parts in whatever order it likes, so a toolbar that is no longer
      // against its anchor is put back - and only then; `toolbarNeedsMoving` carries the reason.
      if (!toolbarNeedsMoving(placed, point)) {
        return;
      }
      point.parent.insertBefore(placed, point.before);
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
      // The site's own account switcher is a navigation, and the Watch Later list is per
      // account: whoever the page is acting as now is who the buttons must ask about.
      this.reportSessionIndex(this.context);
      this.mountToolbar(this.context);
      this.applyRows();
    }
  },

  stop(context: RendererContext<WatchLaterPluginConfig>) {
    if (this.resizeListener) {
      window.removeEventListener("resize", this.resizeListener);
      this.resizeListener = null;
    }
    if (this.pointerMoveListener) {
      document.removeEventListener("pointermove", this.pointerMoveListener);
      this.pointerMoveListener = null;
    }
    if (this.pointerGoneListener) {
      document.removeEventListener("pointerout", this.pointerGoneListener);
      this.pointerGoneListener = null;
    }
    if (this.scrollListener) {
      document.removeEventListener("scroll", this.scrollListener, true);
      this.scrollListener = null;
    }
    this.markCard(null);
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
    for (const layer of document.querySelectorAll(`.${FLOATING_LAYER_CLASS}`)) {
      layer.remove();
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
   * Tells the backend which account the page is acting as - with two identities under one login
   * this is the only signal that says which Watch Later the buttons ask about. Two things are
   * not there yet when the renderer starts: `ytcfg` is the page's own global, and the backend's
   * handler belongs to a plugin that loads in parallel with the page (~1.7 s of account
   * probing). A fire-and-forget send was therefore lost, and the app acted as the first account
   * in the list while the page was signed in as the second - which is why videos that are in
   * Watch Later showed up as unsaved. The call is acknowledged and retried instead.
   */
  reportSessionIndex(context: RendererContext<WatchLaterPluginConfig>) {
    const ytcfg = (
      window as unknown as { ytcfg?: { get: (key: string) => unknown } }
    ).ytcfg;
    const index = Number(ytcfg?.get("SESSION_INDEX") ?? Number.NaN);

    if (!Number.isFinite(index)) {
      this.scheduleSessionIndexReport(context);
      return;
    }

    // Once per value: the backend reconnects and repairs on every report, and every navigation
    // reports again - mostly with the same number.
    if (index === this.reportedSessionIndex) {
      return;
    }

    context.ipc
      .invoke("watchdeck:watch-later-session-index", index)
      .then(() => {
        this.reportedSessionIndex = index;
        this.sessionIndexAttempts = 0;
      })
      .catch(() => this.scheduleSessionIndexReport(context));
  },

  /** Waits for the page's config or the backend, then reports; gives up after ~20 s. */
  scheduleSessionIndexReport(context: RendererContext<WatchLaterPluginConfig>) {
    if (this.sessionIndexAttempts >= 40) {
      return;
    }

    this.sessionIndexAttempts += 1;
    setTimeout(() => this.reportSessionIndex(context), 500);
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
      this.markCard(null);
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
      const existing =
        this.buttons.get(card) ??
        card.querySelector<HTMLButtonElement>(`.${BUTTON_CLASS}`);
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
      this.buttons.set(card, button);
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
    this.queuePointerMark();
  },

  /**
   * Keeps the mark on the card whose video box the pointer is over, and off every other card.
   *
   * The site plays its inline preview in one overlay it moves over the hovered card, and while it
   * plays that overlay takes the pointer (`ytd-video-preview` is `pointer-events: auto`), so the
   * card stops being `:hover`ed - and a button that follows `:hover` fades out exactly while the
   * user is looking at it. The mark is read off the pointer instead of off the preview, because
   * the preview's own state is the site's business and it changes shape between surfaces; the
   * card under the pointer is the same card in every state. `style.css` raises the marked card
   * above that overlay, so the button stays visible *and* clickable.
   */
  markCard(card: Element | null) {
    if (card !== this.markedCard) {
      const previous = this.markedCard;
      this.markedCard?.classList.remove(MEDIA_HOVER_CLASS);
      this.markedCard = card;
      card?.classList.add(MEDIA_HOVER_CLASS);
      this.alignCardButton(previous);
    }

    // While marked, the button is placed against the viewport, so its coordinates follow the page
    this.alignCardButton(card);
  },

  alignCardButton(card: Element | null) {
    if (!card) {
      return;
    }

    const button =
      this.buttons.get(card) ??
      card.querySelector<HTMLButtonElement>(`.${BUTTON_CLASS}`);

    if (button) {
      alignButton(button, card);
    }
  },

  /** Geometry changes without a structure change (scrolling, the overlay moving): coalesce it. */
  queuePointerMark() {
    if (this.pointerMarkQueued) {
      return;
    }

    this.pointerMarkQueued = true;
    requestAnimationFrame(() => {
      this.pointerMarkQueued = false;
      const { x, y } = this.lastPointer;
      this.markCard(x < 0 ? null : cardUnderPoint(x, y));
    });
  },

  onPointerMove(event: PointerEvent) {
    this.lastPointer = { x: event.clientX, y: event.clientY };
    this.queuePointerMark();
  },

  /** The pointer left the page: nothing is under it any more. */
  onPointerGone(event: PointerEvent) {
    if (event.relatedTarget !== null) {
      return;
    }

    this.lastPointer = { x: -1, y: -1 };
    this.markCard(null);
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

  onResize() {
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      `.${BUTTON_CLASS}`
    )) {
      const host = button.closest(`.${HOST_CLASS}`);
      if (host) {
        alignButton(button, host);
      }
    }
    this.queuePointerMark();
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
