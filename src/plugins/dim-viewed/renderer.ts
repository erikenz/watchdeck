import { CARD_SELECTOR, isViewedCard } from "@/plugins/utils/renderer/cards";

import type { DimViewedPluginConfig } from "./index";

/** The class a card gets while the site marks its video as watched. */
export const VIEWED_CLASS = "wd-dv-viewed";

/** Where the configured opacity lands; the stylesheet reads it, so a change needs no reload. */
const OPACITY_VARIABLE = "--wd-dv-opacity";

let observer: MutationObserver | null = null;
let scanQueued = false;

/**
 * Fades the cards the site itself marks as watched - and only those.
 *
 * The mark is the site's own resume bar or watched badge, read off the card: what the app believes
 * about a video and what the page shows are two different things, and this is decoration for the
 * page, so the page decides. A card the site stops marking (a re-render, a fresh item) is faded
 * back in, which is why this runs over every card rather than only over the new ones.
 */
export const applyDims = () => {
  for (const card of document.querySelectorAll(CARD_SELECTOR)) {
    // `toggle` with the state it already has is not a DOM mutation, and this plugin's own observer
    // watches for those: a write that repeats itself would scan for ever.
    card.classList.toggle(VIEWED_CLASS, isViewedCard(card));
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
  setOpacity(config.opacity);
  applyDims();
  // The site is a single-page app that re-renders its feeds: a card's mark comes and goes with the
  // item, so the cards are re-read whenever the page changes, coalesced to one frame.
  observer = new MutationObserver(() => queueScan());
  observer.observe(document.body, { childList: true, subtree: true });
};

export const applyConfig = (config: DimViewedPluginConfig) => {
  setOpacity(config.opacity);
};

export const stop = () => {
  observer?.disconnect();
  observer = null;
  scanQueued = false;
  document.documentElement.style.removeProperty(OPACITY_VARIABLE);
  for (const card of document.querySelectorAll(`.${VIEWED_CLASS}`)) {
    card.classList.remove(VIEWED_CLASS);
  }
};
