import type { YouTubePlayer } from "@/types/youtube-player";

/**
 * Every selector this app uses against the site's player lives here.
 *
 * The site's DOM and class names change without notice (docs/PRD.md §10), so the
 * matchers stay shallow - an id or a class YouTube has kept for years - and callers
 * re-read the document instead of holding on to an element.
 */
export const getPlayer = (): (Element & YouTubePlayer) | null =>
  document.querySelector<Element & YouTubePlayer>("#movie_player");

/** The `<video>` element the player is driving, if one is mounted. */
export const getVideo = (): HTMLVideoElement | null =>
  getPlayer()?.querySelector<HTMLVideoElement>("video") ?? null;

/**
 * The site's autoplay toggle. Its state is the `aria-checked` attribute, not a
 * method: `setAutonavState()` on the player is a silent no-op (docs/PRD.md §5.2).
 */
export const getAutonavToggle = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(".ytp-autonav-toggle-button");
