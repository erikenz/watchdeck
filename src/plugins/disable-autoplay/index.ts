/**
 * Autoplay off, on youtube.com (docs/PRD.md §5.2, R3).
 *
 * Two behaviours, both configurable:
 *  1. the site's own autoplay toggle is forced off, by clicking it until `aria-checked`
 *     says so - the player API's `setAutonavState()` is a silent no-op;
 *  2. a video that starts *by itself* is paused: the block is armed on load and on each
 *     navigation, pauses the first playback, and disarms itself so a later play press
 *     is never touched.
 *
 * A navigation the user asked for is left alone. The site reports every navigation the
 * same way, so the one thing that separates "the user clicked this video" from "it moved
 * on while I was reading" is what happened just before: a click or an Enter press in the
 * page.
 */
import { t } from "@/i18n";
import { getAutonavToggle } from "@/providers/youtube-dom";
import { createPlugin } from "@/utils";

export interface DisableAutoPlayPluginConfig {
  enabled: boolean;
  /** Stop one video per session instead of every one. */
  applyOnce: boolean;
  /** A video that starts by itself when the app opens. */
  blockOnLoad: boolean;
  /** A video that starts by itself after a navigation the user did not ask for. */
  blockOnNavigation: boolean;
  /** Keep the site's own autoplay toggle off. */
  enforceAutonav: boolean;
}

/**
 * How long the block stays armed. Long enough to outlast the site's own autoplay, and it
 * always ends: after it, nothing the user does is interfered with.
 */
const ARM_TIMEOUT_MS = 10_000;

/** Clicks to spend on the site's autoplay toggle before leaving it alone. */
const AUTONAV_ATTEMPTS = 5;

/** Time to let the site react to a toggle click before reading its state back. */
const AUTONAV_SETTLE_MS = 250;

/** Clicking any of these means the user is driving; what follows is not an auto-advance. */
const LINK_SELECTOR =
  "a, ytd-thumbnail, yt-thumbnail-view-model, yt-lockup-view-model, ytd-video-renderer";

export const defaultConfig: DisableAutoPlayPluginConfig = {
  applyOnce: false,
  blockOnLoad: true,
  blockOnNavigation: true,
  enabled: true,
  enforceAutonav: true,
};

let activeConfig = defaultConfig;
let applied = false;
let armed = false;
let armTimeout: ReturnType<typeof setTimeout> | undefined;
let userDriven = false;

const getVideo = () => document.querySelector<HTMLVideoElement>("video");

const pauseNow = () => {
  const video = getVideo();

  if (video && !video.paused) {
    video.pause();
  }
};

const onPlay = () => {
  pauseNow();

  if (activeConfig.applyOnce) {
    applied = true;
  }
};

const disarm = () => {
  if (!armed) {
    return;
  }

  armed = false;
  clearTimeout(armTimeout);
  armTimeout = undefined;
  document.removeEventListener("play", onPlay, true);
};

/** Stops the next playback that starts on its own; a user's play press happens later. */
const arm = () => {
  if (!activeConfig.enabled || (activeConfig.applyOnce && applied)) {
    return;
  }

  disarm();
  armed = true;
  document.addEventListener("play", onPlay, { capture: true, once: true });
  pauseNow();
  armTimeout = setTimeout(disarm, ARM_TIMEOUT_MS);
};

/** Reads the toggle's state; the site has moved the attribute around over the years. */
const isAutonavOn = (toggle: Element) =>
  (toggle.getAttribute("aria-checked") ??
    toggle.querySelector("[aria-checked]")?.getAttribute("aria-checked")) ===
  "true";

const enforceAutonavOff = async () => {
  for (let attempt = 0; attempt < AUTONAV_ATTEMPTS; attempt += 1) {
    const toggle = getAutonavToggle();

    if (!toggle || !isAutonavOn(toggle)) {
      // Nothing to click, or it is already off
      return;
    }

    toggle.click();
    await new Promise((resolve) => {
      setTimeout(resolve, AUTONAV_SETTLE_MS);
    });
  }
};

const onNavigated = () => {
  if (userDriven) {
    userDriven = false;
  } else if (activeConfig.blockOnNavigation) {
    arm();
  }

  if (activeConfig.enabled) {
    void enforceAutonavOff();
  }
};

const onUserClick = (event: Event) => {
  if (
    event.target instanceof Element &&
    event.target.closest(LINK_SELECTOR) !== null
  ) {
    userDriven = true;
  }
};

const onUserKey = (event: KeyboardEvent) => {
  if (event.key === "Enter" || event.key === " ") {
    userDriven = true;
  }
};

/**
 * The app's own commands (`video-controls-front`) are user intent too. Without this, a
 * play press from the menu, the tray, MPRIS or a protocol URL arrives looking exactly
 * like the site starting a video by itself - and is paused straight back.
 */
const onAppCommand = (event: Event) => {
  const { type } = (event as CustomEvent<{ type?: string }>).detail ?? {};

  if (type === "play" || type === "toggle-play") {
    disarm();
  }

  if (
    type === "play" ||
    type === "toggle-play" ||
    type === "next-video" ||
    type === "previous-video"
  ) {
    userDriven = true;
  }
};

export default createPlugin<
  unknown,
  unknown,
  unknown,
  DisableAutoPlayPluginConfig
>({
  config: defaultConfig,
  description: () => t("plugins.disable-autoplay.description"),
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();

    return [
      {
        checked: Boolean(config.blockOnLoad),
        click(item) {
          void setConfig({ blockOnLoad: item.checked });
        },
        label: t("plugins.disable-autoplay.menu.block-on-load"),
        type: "checkbox",
      },
      {
        checked: Boolean(config.blockOnNavigation),
        click(item) {
          void setConfig({ blockOnNavigation: item.checked });
        },
        label: t("plugins.disable-autoplay.menu.block-on-navigation"),
        type: "checkbox",
      },
      {
        checked: Boolean(config.enforceAutonav),
        click(item) {
          void setConfig({ enforceAutonav: item.checked });
        },
        label: t("plugins.disable-autoplay.menu.enforce-autonav"),
        type: "checkbox",
      },
      { type: "separator" },
      {
        checked: Boolean(config.applyOnce),
        click(item) {
          void setConfig({ applyOnce: item.checked });
        },
        label: t("plugins.disable-autoplay.menu.apply-once"),
        type: "checkbox",
      },
    ];
  },
  name: () => t("plugins.disable-autoplay.name"),
  renderer: {
    async start({ getConfig }) {
      activeConfig = await getConfig();

      document.addEventListener("yt-navigate-finish", onNavigated);
      window.addEventListener("popstate", onNavigated);
      document.addEventListener("click", onUserClick, true);
      document.addEventListener("keydown", onUserKey, true);
      document.addEventListener("watchdeck:player-command", onAppCommand);
    },
    stop() {
      disarm();
      document.removeEventListener("yt-navigate-finish", onNavigated);
      window.removeEventListener("popstate", onNavigated);
      document.removeEventListener("click", onUserClick, true);
      document.removeEventListener("keydown", onUserKey, true);
      document.removeEventListener("watchdeck:player-command", onAppCommand);
    },
    onConfigChange(newConfig) {
      activeConfig = newConfig;

      if (!activeConfig.enabled) {
        disarm();
        return;
      }

      void enforceAutonavOff();
    },
    onPlayerApiReady() {
      if (activeConfig.blockOnLoad) {
        arm();
      }

      if (activeConfig.enabled) {
        void enforceAutonavOff();
      }
    },
  },
  restartNeeded: false,
});
