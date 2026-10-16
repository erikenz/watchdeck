import { t } from "@/i18n";
import type { RendererContext } from "@/types/contexts";
import type { MusicPlayer } from "@/types/music-player";

import type { WatchLaterPluginConfig, WatchLaterState } from "../types";
import {
  BUTTON_CLASS,
  createSaveButton,
  HOST_CLASS,
  isThumbnailHost,
  paintButton,
  THUMBNAIL_HOST_SELECTOR,
  videoIdFromHost,
} from "./dom";
import type { ButtonState } from "./dom";

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
  lastProgressSentAt: 0,
  videoDataListener: null as ((event: Event) => void) | null,
  timeUpdateListener: null as ((event: Event) => void) | null,

  async start(context: RendererContext<WatchLaterPluginConfig>) {
    this.ipc = context.ipc;
    this.config = await context.getConfig();

    await this.hydrate();

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
    document
      .querySelector("video")
      ?.addEventListener("timeupdate", this.timeUpdateListener);
  },

  stop(context: RendererContext<WatchLaterPluginConfig>) {
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
    if (this.config && !this.config.showHoverButton) {
      return;
    }
    for (const host of document.querySelectorAll(THUMBNAIL_HOST_SELECTOR)) {
      if (!isThumbnailHost(host)) {
        continue;
      }
      const videoId = videoIdFromHost(host);
      if (!videoId) {
        continue;
      }
      const existing = host.querySelector<HTMLButtonElement>(
        `.${BUTTON_CLASS}`
      );
      if (existing) {
        this.paint(existing);
        continue;
      }
      if (this.isOwnSurface(host)) {
        continue;
      }
      host.classList.add(HOST_CLASS);
      host.append(
        createSaveButton(videoId, (button) => {
          this.toggle(button).catch(() => undefined);
        })
      );
    }
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
