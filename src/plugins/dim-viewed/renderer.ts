import {
  classifyProgress,
  withThresholdDefaults,
} from "@/plugins/utils/common/watch-thresholds";
import {
  CARD_SELECTOR,
  durationOf,
  hasWatchedBadge,
  viewedPercent,
} from "@/plugins/utils/renderer/cards";
import type { WatchThresholds } from "@/types/watch-thresholds";

import type { DimViewedPluginConfig } from "./index";

/** The class a card gets while the site marks its video as watched. */
export const VIEWED_CLASS = "wd-dv-viewed";

/** Where the configured opacity lands; the stylesheet reads it, so a change needs no reload. */
const OPACITY_VARIABLE = "--wd-dv-opacity";

let observer: MutationObserver | null = null;
let unwatch: (() => void) | null = null;
let scanQueued = false;
let thresholds: WatchThresholds | null = null;

/**
 * The watched / continue-watching thresholds, read from the app's own options.
 *
 * They are the same numbers the Watch Later plugin buckets its list with, and they live with the
 * app rather than in a plugin so that this one works while that one is disabled. The page is handed
 * the config (`window.mainConfig`), so a read is a lookup and no IPC of its own is needed - and the
 * stored value goes through `withThresholdDefaults`, because a config file written before these
 * keys existed holds an `options` object without them (measured live: `{}`, which would have made
 * every card "unwatched").
 */
const readThresholds = (): WatchThresholds =>
  withThresholdDefaults({
    inProgress: window.mainConfig.get("options.inProgress"),
    watched: window.mainConfig.get("options.watched"),
  });

/**
 * Whether the card counts as *finished*.
 *
 * The percentage is the site's own - the width of the bar it draws - put through the shared
 * thresholds, so "finished" means the same thing here and in the Watch Later list's watched bucket.
 * Started is not finished: a card in the continue-watching band is deliberately left alone, because
 * fading a video the user is halfway through says the wrong thing about it. The site's own
 * "Watched" badge counts outright; a bar with no readable width is "started", not "finished".
 */
const isViewed = (card: Element): boolean => {
  if (hasWatchedBadge(card)) {
    return true;
  }

  const percent = viewedPercent(card);
  if (percent === undefined) {
    return false;
  }
  if (!thresholds) {
    // No thresholds read yet: only a bar the site drew all the way across is finished.
    return percent >= 100;
  }

  return (
    classifyProgress(
      { durationSeconds: durationOf(card), ratio: percent / 100 },
      thresholds
    ) === "watched"
  );
};

/**
 * Fades the cards that count as viewed, and only those.
 *
 * A card the site stops marking (a re-render, a fresh item) is faded back in, which is why this runs
 * over every card rather than only over the new ones.
 */
export const applyDims = () => {
  for (const card of document.querySelectorAll(CARD_SELECTOR)) {
    // `toggle` with the state it already has is not a DOM mutation, and this plugin's own observer
    // watches for those: a write that repeats itself would scan for ever.
    card.classList.toggle(VIEWED_CLASS, isViewed(card));
  }
};

const queueScan = () => {
  if (scanQueued) {
    return;
  }
  scanQueued = true;
  requestAnimationFrame(() => {
    scanQueued = false;
    applyDims();
  });
};

const setOpacity = (opacity: number) => {
  document.documentElement.style.setProperty(OPACITY_VARIABLE, String(opacity));
};

export const start = (config: DimViewedPluginConfig) => {
  thresholds = readThresholds();
  setOpacity(config.opacity);
  applyDims();
  // The site is a single-page app that re-renders its feeds: a card's mark comes and goes with the
  // item, so the cards are re-read whenever the page changes, coalesced to one frame.
  observer = new MutationObserver(() => queueScan());
  observer.observe(document.body, { childList: true, subtree: true });
  // A threshold changed in the Options menu re-reads the cards at once: the answer is a lookup.
  unwatch = window.mainConfig.watch(() => {
    thresholds = readThresholds();
    applyDims();
  });
};

export const applyConfig = (config: DimViewedPluginConfig) => {
  setOpacity(config.opacity);
};

export const stop = () => {
  observer?.disconnect();
  observer = null;
  unwatch?.();
  unwatch = null;
  thresholds = null;
  scanQueued = false;
  document.documentElement.style.removeProperty(OPACITY_VARIABLE);
  for (const card of document.querySelectorAll(`.${VIEWED_CLASS}`)) {
    card.classList.remove(VIEWED_CLASS);
  }
};
