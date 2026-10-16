/**
 * The page's half of the gestures plugin (docs/PRD.md §5.6, R7).
 *
 * Right-button drags over the player: up/down for volume, left/right to seek, up/down
 * with Shift for the playback speed. Right + wheel is volume as well.
 *
 * Three things this has to get right, and each is why a piece looks the way it does:
 *
 * - the right button is tracked, not assumed. `buttons` is the primary check and our own
 *   pointer bookkeeping is the fallback, because a wheel event's bitmask is not reliable
 *   everywhere;
 * - the site's own context menu still opens on a plain right-click: the menu is prevented
 *   while a press that could become a gesture is in flight, and re-opened afterwards if no
 *   gesture happened (the platforms disagree on whether it opens on the press or the
 *   release, so both orderings are handled);
 * - a gesture never survives a blur, a lost pointer or a navigation.
 */
import { getPlayer } from "@/providers/youtube-dom";

import type { GesturesPluginConfig } from "./index";

type Mode = "pending" | "volume" | "seek" | "speed";

interface Drag {
  mode: Mode;
  pointerId: number;
  startX: number;
  startY: number;
  startVolume: number;
  startTime: number;
  startRate: number;
  /** Whether a context menu was swallowed for this press, so it can be re-opened. */
  contextSuppressed: boolean;
}

/** Where a gesture may begin: the video area, in the player or in an inline preview. */
const SURFACE_SELECTOR = "#movie_player, .html5-video-player, #player, video";

/** Where it may not: the site's own controls and anything the user types in. */
const CONTROL_SELECTOR = [
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[role='slider']",
  ".ytp-chrome-bottom",
  ".ytp-chrome-top",
  ".ytp-popup",
  ".ytp-settings-menu",
].join(", ");

/** Movement before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD_PX = 8;

/** How long the readout stays after the last change. */
const HUD_VISIBLE_MS = 1200;

const RATE_MIN = 0.25;
const RATE_MAX = 4;

let activeConfig: GesturesPluginConfig | null = null;
let drag: Drag | undefined;
let rightButtonDown = false;
let suppressNextContextMenu = false;
let hud: HTMLElement | undefined;
let hudTimeout: ReturnType<typeof setTimeout> | undefined;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const rightButtonHeld = (event: MouseEvent) =>
  (event.buttons & 2) === 2 || rightButtonDown;

const overSurface = (target: EventTarget | null) =>
  target instanceof Element && target.closest(SURFACE_SELECTOR) !== null;

const overControl = (target: EventTarget | null) =>
  target instanceof Element && target.closest(CONTROL_SELECTOR) !== null;

const asSeconds = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(rest)}`
    : `${minutes}:${pad(rest)}`;
};

const ensureHud = (): HTMLElement | undefined => {
  if (hud?.isConnected) {
    return hud;
  }

  const player = getPlayer();

  if (!player) {
    return undefined;
  }

  hud = document.createElement("div");
  hud.className = "wd-gesture-hud";
  player.append(hud);

  return hud;
};

const showHud = (text: string) => {
  const element = ensureHud();

  if (!element) {
    return;
  }

  element.textContent = text;
  element.style.opacity = "1";
  clearTimeout(hudTimeout);
  hudTimeout = setTimeout(() => {
    if (hud) {
      hud.style.opacity = "0";
    }
  }, HUD_VISIBLE_MS);
};

const setVolume = (percent: number) => {
  const player = getPlayer();

  if (!player) {
    return;
  }

  const volume = Math.round(clamp(percent, 0, 100));
  // The site's own setter, so its slider and mute state stay in step (docs/PRD.md §5.6)
  player.setVolume?.(volume);

  if (volume > 0 && player.isMuted?.()) {
    player.unMute?.();
  }

  showHud(`${volume}%`);
};

const seekTo = (seconds: number) => {
  const player = getPlayer();

  if (!player) {
    return;
  }

  const duration = player.getDuration?.() ?? 0;
  const target = clamp(seconds, 0, duration > 0 ? duration : seconds);
  player.seekTo?.(target, true);
  showHud(asSeconds(target));
};

const setRate = (rate: number) => {
  const player = getPlayer();

  if (!player) {
    return;
  }

  const value = Math.round(clamp(rate, RATE_MIN, RATE_MAX) * 100) / 100;
  player.setPlaybackRate?.(value);
  showHud(`${value}×`);
};

const reset = () => {
  drag = undefined;
  rightButtonDown = false;
};

const onPointerDown = (event: PointerEvent) => {
  if (event.button !== 2 || !activeConfig?.enabled) {
    return;
  }

  rightButtonDown = true;

  if (!overSurface(event.target) || overControl(event.target)) {
    return;
  }

  const player = getPlayer();

  drag = {
    contextSuppressed: false,
    mode: "pending",
    pointerId: event.pointerId,
    startRate: player?.getPlaybackRate?.() ?? 1,
    startTime: player?.getCurrentTime?.() ?? 0,
    startVolume: player?.getVolume?.() ?? 0,
    startX: event.clientX,
    startY: event.clientY,
  };
};

const pickMode = (
  dx: number,
  dy: number,
  shiftKey: boolean
): Mode | undefined => {
  if (shiftKey && activeConfig?.speed) {
    return "speed";
  }

  const vertical = Math.abs(dy) >= Math.abs(dx);

  if (vertical && activeConfig?.volume) {
    return "volume";
  }

  if (!vertical && activeConfig?.seek) {
    return "seek";
  }

  // The gesture that would fit is switched off, or the other axis is the only one on
  if (activeConfig?.volume && activeConfig.seek) {
    return undefined;
  }

  return activeConfig?.volume ? "volume" : "seek";
};

const onPointerMove = (event: PointerEvent) => {
  if (!drag) {
    return;
  }

  if (!rightButtonHeld(event)) {
    // The button was released outside a window that reports it
    reset();
    return;
  }

  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;

  if (drag.mode === "pending") {
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
      return;
    }

    const mode = pickMode(dx, dy, event.shiftKey);

    if (!mode) {
      reset();
      return;
    }

    drag.mode = mode;
  }

  switch (drag.mode) {
    case "volume": {
      // Up is louder, so the sign flips
      const perPixel = (activeConfig?.volumePer100Px ?? 0) / 100;
      setVolume(drag.startVolume - dy * perPixel);
      break;
    }
    case "seek": {
      const perPixel = (activeConfig?.seekSecondsPer100Px ?? 0) / 100;
      seekTo(drag.startTime + dx * perPixel);
      break;
    }
    case "speed": {
      const perPixel = (activeConfig?.speedPer100Px ?? 0) / 100;
      setRate(drag.startRate - dy * perPixel);
      break;
    }
    case "pending": {
      // Cannot happen: the mode is decided above, before this switch
      break;
    }
  }
};

/** A press that never became a gesture ended as a plain right-click. */
const reopenContextMenu = (event: PointerEvent) => {
  if (event.target instanceof Element) {
    event.target.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        button: 2,
        buttons: 2,
        cancelable: true,
        clientX: event.clientX,
        clientY: event.clientY,
      })
    );
  }
};

const onPointerUp = (event: PointerEvent) => {
  if (event.button !== 2) {
    return;
  }

  rightButtonDown = false;

  if (!drag) {
    return;
  }

  const { contextSuppressed, mode } = drag;
  suppressNextContextMenu = mode !== "pending";
  reset();

  if (mode === "pending" && contextSuppressed) {
    reopenContextMenu(event);
  }
};

const onContextMenu = (event: MouseEvent) => {
  if (suppressNextContextMenu) {
    suppressNextContextMenu = false;
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (!drag) {
    return;
  }

  // The press may still turn into a gesture, so the menu waits for the release
  drag.contextSuppressed = true;
  event.preventDefault();
  event.stopPropagation();
};

const onWheel = (event: WheelEvent) => {
  if (!activeConfig?.enabled || !activeConfig.wheelVolume) {
    return;
  }

  if (!overSurface(event.target) || overControl(event.target)) {
    return;
  }

  if (!rightButtonHeld(event)) {
    return;
  }

  const step = activeConfig.wheelVolumeStep || 0;
  const direction = event.deltaY > 0 ? -1 : 1;
  event.preventDefault();
  setVolume((getPlayer()?.getVolume?.() ?? 0) + direction * step);
};

const onBlur = () => {
  reset();
  hideHud();
};

const hideHud = () => {
  clearTimeout(hudTimeout);

  if (hud) {
    hud.style.opacity = "0";
  }
};

const onNavigated = () => {
  reset();
  hideHud();
};

const onListeners = [
  ["pointerdown", onPointerDown, true],
  ["pointermove", onPointerMove, true],
  ["pointerup", onPointerUp, true],
  ["pointercancel", onBlur, true],
  ["contextmenu", onContextMenu, true],
  ["wheel", onWheel, { capture: true, passive: false }],
] as const;

/** Adds or removes every listener. Safe to call twice: the plugin hot-toggles. */
const listen = (add: boolean) => {
  for (const [type, handler, options] of onListeners) {
    if (add) {
      document.addEventListener(type, handler as EventListener, options);
    } else {
      document.removeEventListener(type, handler as EventListener, options);
    }
  }

  const windowListener = add ? "addEventListener" : "removeEventListener";
  window[windowListener]("blur", onBlur);
  window[windowListener]("popstate", onNavigated);
  document[windowListener]("yt-navigate-finish", onNavigated);
};

/** Starts listening. Safe to call twice: the plugin is hot-disabled and re-enabled. */
export const start = (config: GesturesPluginConfig) => {
  activeConfig = config;
  listen(true);
};

export const stop = () => {
  listen(false);
  reset();
  hideHud();
  hud?.remove();
  hud = undefined;
};

export const applyConfig = (config: GesturesPluginConfig) => {
  activeConfig = config;
};
