/**
 * Everything that touches the page's DOM lives here: the hosts the button attaches
 * to, how a video id is read off a thumbnail, and the button element itself. The
 * host list follows what the site actually serves - the classic `ytd-thumbnail`
 * cards and the newer view-model cards, which appear on different surfaces and
 * sometimes both at once.
 */

/** The thumbnail-ish parts a card is built from; the button walks up to the card itself. */
export const THUMBNAIL_HOST_SELECTOR = [
  "ytd-thumbnail",
  "a#thumbnail",
  "yt-thumbnail-view-model",
  "ytThumbnailViewModelHost",
  "a.ytLockupViewModelContentImage",
  "a.yt-lockup-view-model__content-image",
].join(",");

/**
 * The card the button belongs to. It has to be the card, not the thumbnail inside it: the
 * site's inline preview replaces the thumbnail with a surface outside that link, so a button
 * anchored to the link only appears when the pointer is over the little that is left of it.
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

export const BUTTON_CLASS = "wd-wl-save";
export const HOST_CLASS = "wd-wl-anchor";

const VIDEO_PATH = "/watch";
const VIDEO_ID_PATTERN = /(?:^|\/)(?:shorts|embed|live)\/([\w-]{11})/;

/** Reads the video id from anywhere in the card: a link, or the renderer's own attribute. */
export const videoIdFromHost = (host: Element): string | undefined => {
  const link =
    host.matches('a[href*="watch"]') || host.matches("a[href*='/shorts/']")
      ? host
      : (host.querySelector('a[href*="watch"]') ??
        host.querySelector("a[href*='/shorts/']") ??
        host.closest('a[href*="watch"]'));

  const href = link?.getAttribute("href");
  if (href) {
    try {
      const url = new URL(href, window.location.origin);
      if (url.pathname === VIDEO_PATH) {
        return url.searchParams.get("v") ?? undefined;
      }
      const matched = VIDEO_ID_PATTERN.exec(url.pathname)?.[1];
      if (matched) {
        return matched;
      }
    } catch {
      // fall through to the attributes below
    }
  }

  for (const attribute of ["data-video-id", "video-id", "href"]) {
    const value =
      host.getAttribute(attribute) ??
      host.closest<HTMLElement>("[data-video-id]")?.dataset.videoId;
    if (value && /^[\w-]{11}$/.test(value)) {
      return value;
    }
  }
  return undefined;
};

/**
 * The element that actually paints the video for a card. Cards wrap their thumbnail in boxes
 * with their own padding, so anchoring the button to the card's corner puts it in the gap
 * beside the video instead of on it. The thumbnail box is preferred over the `<img>` inside it:
 * the site swaps that image around (and hides it behind its preview), while the box it lives in
 * keeps the video's footprint.
 */
export const mediaOf = (host: Element): Element | undefined =>
  host.querySelector("ytd-thumbnail, yt-thumbnail-view-model, #thumbnail") ??
  host.querySelector(
    "#video-preview, ytd-video-preview, #inline-preview-player, #mouseover-overlay, img"
  ) ??
  undefined;

/**
 * The site's inline preview. Hidden, it is still in the document, keeps the geometry it last had
 * and reports `opacity: 0`; it becomes visible and interactive - `pointer-events: auto` - through
 * its own `active` attribute. It is one shared element the site moves over whichever card is
 * hovered, never part of the card's markup, which is why it gets no button of its own: a button
 * inside it would be painted by the site's player instead of above it, and until the preview
 * plays the overlay does not even take the pointer.
 */
export const PREVIEW_SELECTOR = "ytd-video-preview";

/** Set on the card the preview is covering, for as long as it covers it. */
export const PREVIEW_OPEN_CLASS = "wd-wl-preview-open";

/** The preview while it is actually on screen, `undefined` when there is none. */
export const shownPreview = (): Element | undefined => {
  const preview = document.querySelector(PREVIEW_SELECTOR);
  if (!preview) {
    return undefined;
  }
  // The site's own signal first, then what it looks like: a preview the site has put away keeps
  // its last geometry and is only faded out, so size alone would say it is still there.
  if (preview.matches("[active], [playing]")) {
    return preview;
  }
  const box = preview.getBoundingClientRect();
  const painted = Number.parseFloat(getComputedStyle(preview).opacity) > 0;
  return painted && box.width > 60 && box.height > 60 ? preview : undefined;
};

/**
 * Puts the button in the bottom-right corner of the video itself, clear of what sits there:
 * the duration badge on a thumbnail, the control bar of the preview playing over the card.
 */
export const alignButton = (button: HTMLButtonElement, host: Element) => {
  const media = mediaOf(host) ?? host;
  const hostRect = host.getBoundingClientRect();
  const mediaRect = media.getBoundingClientRect();
  if (mediaRect.width < 40 || mediaRect.height < 30) {
    return;
  }
  const clearance = (host.classList.contains(PREVIEW_OPEN_CLASS) ? 56 : 28) + 8;
  button.style.right = `${Math.max(4, Math.round(hostRect.right - mediaRect.right) + 8)}px`;
  button.style.bottom = `${Math.max(4, Math.round(hostRect.bottom - mediaRect.bottom) + clearance)}px`;
};

const ICONS: Record<string, string> = {
  saved:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
  unsaved:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3h-2v8H3v2h8v8h2v-8h8v-2h-8z"/></svg>',
  pending:
    '<svg viewBox="0 0 24 24" aria-hidden="true" class="wd-wl-spin"><path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z"/></svg>',
};

export type ButtonState = "saved" | "unsaved" | "pending" | "error";

export const paintButton = (
  button: HTMLButtonElement,
  state: ButtonState,
  labels: { save: string; remove: string }
) => {
  button.dataset.state = state;
  button.innerHTML =
    ICONS[state === "error" ? "unsaved" : state] ?? ICONS.unsaved;
  const label = state === "saved" ? labels.remove : labels.save;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.setAttribute("aria-pressed", String(state === "saved"));
};

export const createSaveButton = (
  videoId: string,
  onToggle: (button: HTMLButtonElement) => void
): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = BUTTON_CLASS;
  button.dataset.videoId = videoId;
  // The card underneath is a link: swallow the events that would navigate or open
  // the inline preview while the pointer is on the button.
  for (const eventName of ["mousedown", "pointerdown", "auxclick"] as const) {
    button.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  }
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onToggle(button);
  });
  return button;
};

export const isThumbnailHost = (element: Element): boolean =>
  element.matches(THUMBNAIL_HOST_SELECTOR);
