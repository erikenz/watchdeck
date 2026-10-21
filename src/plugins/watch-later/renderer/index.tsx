import { render } from "solid-js/web";

import { t } from "@/i18n";
import { CARD_SELECTOR } from "@/plugins/utils/renderer/cards";
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
  buttonStateOf,
  cardOf,
  cardUnderPoint,
  createSaveButton,
  FLOATING_LAYER_CLASS,
  HOST_CLASS,
  isThumbnailHost,
  MEDIA_HOVER_CLASS,
  isToggleShortcut,
  paintButton,
  THUMBNAIL_HOST_SELECTOR,
  videoIdFromHost,
} from "./dom";
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

/** How long a change the server refused stays visible on the button. */
const REFUSAL_HOLD_MS = 1200;

/** The class a card gets while its video is in Watch Later. */
export const SAVED_CLASS = "wd-wl-dim";

/** Where the configured opacity lands; the stylesheet reads it, so a change needs no reload. */
const SAVED_OPACITY_VARIABLE = "--wd-wl-dim-opacity";

type Ipc = RendererContext<WatchLaterPluginConfig>["ipc"];

export const renderer = {
  api: null as MusicPlayer | null,
  config: null as WatchLaterPluginConfig | null,
  ipc: null as Ipc | null,
  membership: new Set<string>(),
  observer: null as MutationObserver | null,
  pending: new Set<string>(),
  /**
   * Videos whose change the server refused. Held apart from `pending` and painted over the rest, so
   * a failure is visible: a button that goes back to "not saved" on its own reads as "nothing
   * happened", which is how a save that never landed was missed.
   */
  refused: new Set<string>(),
  scanQueued: false,
  pointerMarkQueued: false,
  lastPointer: { x: -1, y: -1 },
  lastProgressSentAt: 0,
  sessionIndexAttempts: 0,
  reportedSessionIndex: null as number | null,
  reportedLoggedIn: null as boolean | null,
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
  shortcutListener: null as ((event: KeyboardEvent) => void) | null,
  markedCard: null as Element | null,
  /**
   * Whether the app has no usable YouTube session, as the backend last reported it.
   *
   * Read off the page's own `ytcfg.LOGGED_IN` by the renderer and carried back through the
   * backend's state, so a signed-out app knows it before any request has to fail to find out. The
   * buttons stay where they are and say why they will not act, instead of every click ending in a
   * refusal the user has to interpret.
   */
  signedOut: false,

  async start(context: RendererContext<WatchLaterPluginConfig>) {
    this.ipc = context.ipc;
    this.context = context;
    this.config = await context.getConfig();
    this.signedOut = await this.readSignedOut();

    await this.hydrate();
    this.reportSessionIndex(context);
    this.mountToolbar(context);
    this.applyDimOpacity();
    this.applyDims();

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
    this.shortcutListener = this.onShortcut.bind(this);
    document.addEventListener("keydown", this.shortcutListener);
    this.queueScan();

    context.ipc.on(
      "watchdeck:watch-later-changed",
      (state: WatchLaterState) => {
        // The session can go away while the app runs (signing out in the window, an expired
        // session): every button says so the moment the state says so, and goes back to its
        // action when the session comes back.
        if (state.needsAuth !== this.signedOut) {
          this.signedOut = state.needsAuth;
          this.repaint();
        }
        void this.hydrate();
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

  /**
   * Fades the cards of videos that are already in Watch Later.
   *
   * Deliberately a lighter fade than the dim-viewed plugin's: a video saved for later is dimmed
   * less than one already watched, and where a card is both, that plugin's rule wins (the
   * stylesheet explains how).
   */
  applyDims() {
    const dim = this.config?.dimSaved === true;
    // Not on the Watch Later page itself: every row there is a saved video, so fading all of them
    // says nothing and only makes the list harder to read.
    const onOwnList = this.config?.enhancePage === true && isWatchLaterPage();
    for (const card of document.querySelectorAll(CARD_SELECTOR)) {
      const videoId = videoIdFromHost(card);
      const saved = videoId !== undefined && this.membership.has(videoId);
      // `toggle` with the state the class already has is not a DOM mutation, and this plugin scans
      // on mutations: a write that repeats itself would scan for ever.
      card.classList.toggle(SAVED_CLASS, dim && !onOwnList && saved);
    }
  },

  /** Hands the configured fade to the stylesheet. */
  applyDimOpacity() {
    const opacity = this.config?.savedOpacity;
    if (opacity === undefined) {
      document.documentElement.style.removeProperty(SAVED_OPACITY_VARIABLE);
      return;
    }
    document.documentElement.style.setProperty(
      SAVED_OPACITY_VARIABLE,
      String(opacity)
    );
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
    if (this.shortcutListener) {
      document.removeEventListener("keydown", this.shortcutListener);
      this.shortcutListener = null;
    }
    this.markCard(null);
    this.toolbarHost?.remove();
    this.toolbarHost = null;
    this.filter = null;
    for (const card of document.querySelectorAll(`.${SAVED_CLASS}`)) {
      card.classList.remove(SAVED_CLASS);
    }
    document.documentElement.style.removeProperty(SAVED_OPACITY_VARIABLE);
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
    this.applyDimOpacity();
    this.applyDims();
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
      this.applyDims();
    } catch {
      // Not signed in yet, or the backend is still starting: the buttons simply
      // stay in their unsaved state.
    }
  },

  /**
   * Whether the app has a usable session, as the backend knows it right now.
   *
   * Asked once at start so the first scan already knows: creating a button and withdrawing it
   * again a moment later is a flicker, and on a signed-out app it would be a button that was never
   * going to work.
   */
  async readSignedOut(): Promise<boolean> {
    if (!this.ipc) {
      return false;
    }
    try {
      const state = (await this.ipc.invoke(
        "watchdeck:watch-later-state"
      )) as WatchLaterState;
      return state.needsAuth;
    } catch {
      // No answer yet: offer the buttons. A session that is missing says so through the state
      // broadcast as soon as the backend has one.
      return false;
    }
  },

  /**
   * Tells the backend which account the page is acting as, and whether it is signed in at all.
   *
   * With two identities under one login the index is the only signal that says which Watch Later
   * the buttons ask about. `LOGGED_IN` is the only signal that says there is no Watch Later to ask
   * about, and it arrives *before* any request has to be refused to find out. The two are reported
   * together but are not the same fact: a signed-out page publishes no `SESSION_INDEX` at all
   * (measured), so a report that needed one could never say "signed out".
   *
   * Two things are not there yet when the renderer starts: `ytcfg` is the page's own global, and
   * the backend's handler belongs to a plugin that loads in parallel with the page (~1.7 s of
   * account probing). A fire-and-forget send was therefore lost, and the app acted as the first
   * account in the list while the page was signed in as the second - which is why videos that are
   * in Watch Later showed up as unsaved. The call is acknowledged and retried instead.
   */
  reportSessionIndex(context: RendererContext<WatchLaterPluginConfig>) {
    const ytcfg = (
      window as unknown as { ytcfg?: { get: (key: string) => unknown } }
    ).ytcfg;

    // The page publishes its config late, and a page that never does is a page this plugin has
    // nothing to say about.
    if (!ytcfg) {
      this.scheduleSessionIndexReport(context);
      return;
    }

    const index = Number(ytcfg.get("SESSION_INDEX") ?? Number.NaN);
    const loggedIn = ytcfg.get("LOGGED_IN") === true;
    const report = {
      index: Number.isFinite(index) ? index : null,
      loggedIn,
    };

    // Once per value: the backend reconnects and repairs on every report, and every navigation
    // reports again - mostly with the same number and the same session.
    if (
      report.index === this.reportedSessionIndex &&
      loggedIn === this.reportedLoggedIn
    ) {
      return;
    }

    context.ipc
      .invoke("watchdeck:watch-later-session-index", report)
      .then(() => {
        this.reportedSessionIndex = report.index;
        this.reportedLoggedIn = loggedIn;
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
    // A card can leave the page while the mark is on it - the site re-renders a feed, the user
    // navigates - and nothing else would notice: the mark is cleared by pointer movement, and a
    // pointer that sits still does not move. Its button would then float over every page for the
    // rest of the session (the bug the owner saw), so a mark whose card is gone is dropped here.
    if (this.markedCard && !this.markedCard.isConnected) {
      this.markCard(null);
    }

    if (this.context) {
      this.mountToolbar(this.context);
    }
    this.applyRows();
    this.applyDims();

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

  /**
   * `w` toggles the video the pointer is on - the same card the button floats over. It is the one
   * keyboard path into Watch Later, and it exists because the pointer is already there: the button
   * only appears on the hovered card, so a shortcut that acts on "the video you are looking at"
   * needs no selection model of its own.
   */
  onShortcut(event: KeyboardEvent) {
    if (!isToggleShortcut(event)) {
      return;
    }

    // The button is disabled while there is no session, and the key stands for the button.
    if (this.signedOut) {
      return;
    }

    const card = this.markedCard;
    const button = card
      ? (this.buttons.get(card) ??
        card.querySelector<HTMLButtonElement>(`.${BUTTON_CLASS}`))
      : null;

    if (button) {
      void this.toggle(button);
    }
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
    const saved = this.membership.has(videoId);
    const labels = {
      // What the button says after a refusal. The state has been reverted by then, so it is the
      // video's own saved/unsaved standing that says which of the two actions failed.
      failed: t(
        saved
          ? "plugins.watch-later.button.remove-failed"
          : "plugins.watch-later.button.save-failed"
      ),
      remove: t("plugins.watch-later.button.remove"),
      save: t("plugins.watch-later.button.save"),
      // Nothing on a card page says why a button does nothing: the toolbar is on the Watch Later
      // page, and a signed-out Watch Later page has no list for it to sit above. So the button
      // says it - disabled, because a press is a promise this app cannot keep without a session.
      signedOut: this.signedOut
        ? t("plugins.watch-later.button.signed-out")
        : undefined,
    };
    const state = buttonStateOf({
      pending: this.pending.has(videoId),
      refused: this.refused.has(videoId),
      saved,
    });
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
    // A new attempt is this click, not the last one's failure.
    this.refused.delete(videoId);
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
      // Held in `refused`, not written onto the button: the `finally` below repaints from these sets,
      // and a state set here would be gone before it was ever seen - which is what hid every refusal.
      this.refused.add(videoId);
      setTimeout(() => {
        this.refused.delete(videoId);
        this.repaint();
      }, REFUSAL_HOLD_MS);
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
