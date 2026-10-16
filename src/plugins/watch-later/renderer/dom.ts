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

/**
 * The thumbnail-ish parts a card is built from, in the order worth measuring: the box the site
 * sizes to the video first, then the pieces inside it. The `<img>` is last on purpose - the site
 * swaps it around (and hides it behind its preview), while the box it lives in keeps the video's
 * footprint.
 */
const MEDIA_SELECTOR = [
  "ytd-thumbnail",
  "yt-thumbnail-view-model",
  "a#thumbnail",
  "#thumbnail",
  "#mouseover-overlay",
  "img",
].join(",");

/** Anything smaller is an avatar, a badge, or a box the site has not laid out yet. */
const MIN_MEDIA_WIDTH = 80;
const MIN_MEDIA_HEIGHT = 45;

/** How far above the video's bottom edge the button sits: clear of the duration badge. */
const BUTTON_LIFT = 36;

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
 * The box that paints the video inside a card, with the element it was measured on. Candidates
 * are measured rather than assumed: a card also carries avatars and, on some surfaces, thumbnail
 * markup the site has not laid out yet, and aligning the button to one of those parks it in the
 * metadata row instead of on the video.
 */
export const mediaBoxOf = (
  card: Element
): { box: DOMRect; element: Element } | undefined => {
  for (const candidate of card.querySelectorAll(MEDIA_SELECTOR)) {
    const box = candidate.getBoundingClientRect();
    if (box.width >= MIN_MEDIA_WIDTH && box.height >= MIN_MEDIA_HEIGHT) {
      return { box, element: candidate };
    }
  }
  return undefined;
};

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
 * Puts the button in the bottom-right corner of the video itself, above what the site puts there
 * (the duration badge on a thumbnail, the timestamp on its inline preview). The offset does not
 * change with what is playing: a control that moves when the preview starts is worse than one
 * that sits a little closer to the site's own chrome.
 */
export const alignButton = (button: HTMLButtonElement, host: Element) => {
  const media = mediaBoxOf(host);
  if (!media) {
    return;
  }
  const hostRect = host.getBoundingClientRect();
  button.style.right = `${Math.max(4, Math.round(hostRect.right - media.box.right) + 8)}px`;
  button.style.bottom = `${Math.max(4, Math.round(hostRect.bottom - media.box.bottom) + BUTTON_LIFT)}px`;
};

const ICONS: Record<string, string> = {
  // The site's own Watch Later glyph: a clock. Filled means it is in the list, outline means it
  // is not - the same on/off language the site uses for its like button - so the button says
  // *what* it does. A bare plus or check would have to be learned first.
  saved:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm-.9 4.2v5.4l4.4 2.5.9-1.5-3.5-2V7.2Z"/></svg>',
  unsaved:
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.7"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.3v4.9l3.4 2"/></svg>',
  pending:
    '<svg viewBox="0 0 24 24" aria-hidden="true" class="wd-wl-spin"><path fill="currentColor" d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z"/></svg>',
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
