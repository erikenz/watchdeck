/**
 * What a card is on this site, and how the site says "you have watched this".
 *
 * Both answers are shared: the save button hangs off the card and the dimming plugins fade it, and
 * a second copy of these selectors is a second thing to update when the site renames a tag. They
 * live here (`src/plugins/utils/` is the shared-helpers folder, not a plugin) rather than in one
 * plugin that the other would have to import from.
 */

/**
 * The card a video is rendered as, on every surface worth counting: the home and subscription
 * feeds, search, channels, the watch page's sidebar, playlists, and the newer view-model cards.
 */
export const CARD_SELECTOR = [
  "ytd-rich-item-renderer",
  "ytd-video-renderer",
  "ytd-grid-video-renderer",
  "ytd-compact-video-renderer",
  "ytd-playlist-video-renderer",
  "ytd-playlist-panel-video-renderer",
  "yt-lockup-view-model",
].join(",");

export const cardOf = (element: Element): Element | null =>
  element.closest(CARD_SELECTOR);

/**
 * The site's own marks for a video that has been watched: the red resume bar (the classic
 * renderer and the newer view-model one, which is what the live site serves now) and the
 * "Watched" badge a finished video gets where the site renders one.
 *
 * Measured on the live site (2026-10-19): a partially watched card carries
 * `ytw-thumbnail-overlay-resume-playback-renderer`, with an element whose class contains
 * `ResumePlaybackProgress` inside it. The older `ytd-` names are still listed - the site serves
 * both generations of markup per surface - and so is the playback-status overlay, which is the
 * one `inner-tube.ts` reads the watched badge out of.
 */
export const VIEWED_MARKER_SELECTOR = [
  "ytd-thumbnail-overlay-resume-playback-renderer",
  "ytw-thumbnail-overlay-resume-playback-renderer",
  "ytd-thumbnail-overlay-playback-status-renderer",
  "[class*='ResumePlaybackProgress']",
].join(",");

/** Whether the site marks this card's video as watched, fully or partly. */
export const isViewedCard = (card: Element): boolean =>
  card.querySelector(VIEWED_MARKER_SELECTOR) !== null;
