import type { DebloatPluginConfig } from "./index";

/** The class a shelf gets while the plugin is hiding it. */
export const HIDDEN_CLASS = "wd-db-hidden";

/**
 * The site's Shorts shelf.
 *
 * Measured on the live subscriptions feed (2026-10-21): one `ytd-rich-shelf-renderer` carries the
 * `is-shorts` attribute and ten `ytm-shorts-lockup-view-model` items. The attribute is what the
 * selector keys on; the `:has()` arm is the same shelf on a surface that forgets the attribute.
 */
export const SHORTS_SHELF_SELECTOR = [
  "ytd-rich-shelf-renderer[is-shorts]",
  "ytd-rich-shelf-renderer:has(ytm-shorts-lockup-view-model)",
].join(",");

let observer: MutationObserver | null = null;
let config: DebloatPluginConfig | null = null;
let scanQueued = false;

/**
 * Hides or shows the shelves, without touching the site's own nodes: the shelf keeps its place in
 * the page and only loses its layout box, so disabling the plugin puts everything back.
 */
const apply = () => {
  const hide = config?.hideShortsShelf === true;
  for (const shelf of document.querySelectorAll(SHORTS_SHELF_SELECTOR)) {
    // `toggle` with the state it already has is not a DOM mutation, and this plugin's own observer
    // watches for those: a write that repeats itself would scan for ever.
    shelf.classList.toggle(HIDDEN_CLASS, hide);
  }
};

const queueScan = () => {
  if (scanQueued) {
    return;
  }
  scanQueued = true;
  requestAnimationFrame(() => {
    scanQueued = false;
    apply();
  });
};

export const start = (initial: DebloatPluginConfig) => {
  config = initial;
  apply();
  // The site re-renders its feeds and moves between pages without a reload, and a shelf arrives
  // with the feed: the shelves are re-read whenever the page changes, coalesced to one frame.
  observer = new MutationObserver(() => queueScan());
  observer.observe(document.body, { childList: true, subtree: true });
};

export const applyConfig = (next: DebloatPluginConfig) => {
  config = next;
  apply();
};

export const stop = () => {
  observer?.disconnect();
  observer = null;
  config = null;
  scanQueued = false;
  for (const shelf of document.querySelectorAll(`.${HIDDEN_CLASS}`)) {
    shelf.classList.remove(HIDDEN_CLASS);
  }
};
