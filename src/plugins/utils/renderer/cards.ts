import { secondsFromText } from "../common/watch-thresholds";

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
 * The site's own marks for a video that has been watched.
 *
 * Measured on the live site (2026-10-21) on the history page, where every card is watched:
 *
 * ```html
 * <yt-thumbnail-overlay-progress-bar-view-model class="ytThumbnailOverlayProgressBarHost">
 *   <div class="ytThumbnailOverlayProgressBarHostWatchedProgressBar">
 *     <div class="ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment" style="width: 10%"></div>
 *   </div>
 * </yt-thumbnail-overlay-progress-bar-view-model>
 * ```
 *
 * The segment's width is the watched percentage - which is what the shared thresholds are applied
 * to. The older `resume-playback` families (both generations, measured on the home feed and named
 * in docs/PRD.md §4.3) are still listed: the site serves whichever markup a surface was built
 * with. The watched badge is the classic playback-status overlay, the one `inner-tube.ts` reads
 * the "Watched" text out of - not the badge view-model, which is where the duration lives.
 */
export const PROGRESS_MARKER_SELECTOR = [
  "yt-thumbnail-overlay-progress-bar-view-model",
  "ytw-thumbnail-overlay-resume-playback-renderer",
  "ytd-thumbnail-overlay-resume-playback-renderer",
  "[class*='ResumePlaybackProgress']",
].join(",");

export const WATCHED_BADGE_SELECTOR =
  "ytd-thumbnail-overlay-playback-status-renderer";

/** Whether the site marks this card's video as watched, fully or partly. */
export const isViewedCard = (card: Element): boolean =>
  card.querySelector(
    `${PROGRESS_MARKER_SELECTOR},${WATCHED_BADGE_SELECTOR}`
  ) !== null;

/** Whether the card carries the site's own "Watched" badge. */
export const hasWatchedBadge = (card: Element): boolean =>
  card.querySelector(WATCHED_BADGE_SELECTOR) !== null;

/**
 * How far through the video the site says the viewer is, 0-100, or `undefined` when it draws a bar
 * without a readable width.
 *
 * The width is a percentage in the markup the site serves today (`style="width: 10%"`) and was a
 * percentage in the classic `#progress` element too, so a value that parses as a number is a
 * percentage; a bar whose width is not a number is treated as "some progress, amount unknown".
 */
export const viewedPercent = (card: Element): number | undefined => {
  const candidates = card.querySelectorAll<HTMLElement>(
    [
      "[class*='WatchedProgressBarSegment']",
      "[class*='ResumePlaybackProgress']",
      "#progress",
    ].join(",")
  );

  let percent: number | undefined;
  for (const candidate of candidates) {
    const parsed = Number.parseFloat(candidate.style.width);
    if (Number.isFinite(parsed)) {
      percent = parsed;
    }
  }
  return percent;
};

/** The duration the card prints on its thumbnail (`24:07`, `1:02:33`), in seconds. */
const DURATION_SELECTOR = [
  "ytd-thumbnail-overlay-time-status-renderer",
  "yt-thumbnail-badge-view-model",
  ".ytThumbnailBottomOverlayViewModelBadgeContainer",
].join(",");

export const durationOf = (card: Element): number | undefined => {
  let seconds: number | undefined;
  for (const candidate of card.querySelectorAll(DURATION_SELECTOR)) {
    // Badge containers carry "New" and "Live" too; only a duration parses.
    const parsed = secondsFromText(candidate.textContent?.trim());
    if (parsed !== undefined) {
      seconds = parsed;
    }
  }
  return seconds;
};
