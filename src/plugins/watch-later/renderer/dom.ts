/**
 * Everything that touches the page's DOM lives here: the hosts the button attaches
 * to, how a video id is read off a thumbnail, and the button element itself. The
 * host list follows what the site actually serves - the classic `ytd-thumbnail`
 * cards and the newer view-model cards, which appear on different surfaces and
 * sometimes both at once.
 */

import { CARD_SELECTOR, cardOf } from "@/plugins/utils/renderer/cards";

/** The thumbnail-ish parts a card is built from; the button walks up to the card itself. */
export const THUMBNAIL_HOST_SELECTOR = [
  "ytd-thumbnail",
  "a#thumbnail",
  "yt-thumbnail-view-model",
  "ytThumbnailViewModelHost",
  "a.ytLockupViewModelContentImage",
  "a.yt-lockup-view-model__content-image",
].join(",");

// The card itself is shared with the dimming plugins - see `plugins/utils/renderer/cards.ts`. The
// button has to hang off the card and not the thumbnail inside it: the site's inline preview
// replaces the thumbnail with a surface outside that link, so a button anchored to the link only
// appears when the pointer is over the little of it that is left.
export { CARD_SELECTOR, cardOf };

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
 * Set on the card whose video box the pointer is on, for as long as it is there. The site's
 * inline preview is a fixed overlay that takes the pointer while it plays, so the card stops
 * being `:hover`ed exactly when its button matters (docs/PRD.md R4). This mark is what keeps
 * the button up - read off the pointer rather than off the preview, because the preview's own
 * state is the site's business and it changes shape between surfaces.
 */
export const MEDIA_HOVER_CLASS = "wd-wl-media-hover";

/**
 * The card whose video box contains the point.
 *
 * A hit test rather than a measurement per card: this runs on every pointer move and every scroll
 * frame, and measuring *every* card on the page - each `getBoundingClientRect` invalidated by the
 * scroll that just happened - is what made the floating button lag behind its card while the page
 * scrolled, then snap back when the scrolling stopped. `elementsFromPoint` returns everything at
 * the point, including the cards *under* the site's inline preview overlay, which is the case the
 * measurement was there for. The video box still decides: a hit in the card's metadata row is not a
 * hit on the video.
 */
export const cardUnderPoint = (x: number, y: number): Element | null => {
  for (const element of document.elementsFromPoint(x, y)) {
    const card = element.closest(`.${HOST_CLASS}`);
    if (!card) {
      continue;
    }

    const media = mediaBoxOf(card);
    if (!media) {
      continue;
    }

    const { box } = media;
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
      return card;
    }
  }

  return null;
};

/**
 * The button that floats above a card's video box lives here while it does.
 *
 * A `position: fixed` box is clipped by whichever ancestor is its containing block, and the site's
 * shelves make their scrolling wrapper one - an identity `transform` *and* `overflow: clip`. A
 * button placed against the card's video box was therefore clipped by that wrapper: half of it
 * cut off while the pointer sat on the card, and gone once the preview replaced the thumbnail and
 * the video box moved. A child of `<body>` is outside every one of those subtrees, so `fixed`
 * means the viewport and no `overflow` of theirs applies.
 */
export const FLOATING_LAYER_CLASS = "wd-wl-floating-layer";

/** Marks the button itself, because while floating it is no longer inside its card. */
export const FLOATING_BUTTON_CLASS = "wd-wl-floating";

const floatingLayer = (): HTMLElement => {
  const placed = document.querySelector<HTMLElement>(
    `.${FLOATING_LAYER_CLASS}`
  );

  if (placed) {
    return placed;
  }

  const layer = document.createElement("div");
  layer.className = FLOATING_LAYER_CLASS;
  document.body.append(layer);
  return layer;
};

export const BUTTON_SIZE = 36;

/**
 * Keeps the button in the subtree where it can actually be seen: its card normally, the floating
 * layer while the card's own subtree would clip it.
 */
const keepButtonVisible = (
  button: HTMLButtonElement,
  host: Element,
  floating: boolean
) => {
  if (floating) {
    const layer = floatingLayer();

    if (button.parentElement !== layer) {
      button.classList.add(FLOATING_BUTTON_CLASS);
      layer.append(button);
    }
    return;
  }

  if (button.parentElement !== host) {
    button.classList.remove(FLOATING_BUTTON_CLASS);
    host.append(button);
  }
};

/**
 * Where a `position: fixed` box's 0,0 lands on screen.
 *
 * A fixed box is placed against the viewport - unless one of its ancestors has a `transform`,
 * `filter`, `perspective`, `contain` or `will-change`, in which case *that* ancestor becomes its
 * containing block instead. The site's horizontal shelves do exactly this: an identity
 * `matrix(1, 0, 0, 1, 0, 0)` on the scrolling wrapper, which is enough, and which moved the button
 * of a hovered shelf card onto the card next to it ("the button does not appear" - it was 256 px
 * to the right). Measured, not guessed: listing which ancestors count gets half a fix.
 */
const fixedOrigin = (button: HTMLButtonElement): { x: number; y: number } => {
  const saved = {
    bottom: button.style.bottom,
    left: button.style.left,
    right: button.style.right,
    top: button.style.top,
  };

  button.style.left = "0px";
  button.style.top = "0px";
  button.style.right = "";
  button.style.bottom = "";
  const rect = button.getBoundingClientRect();

  Object.assign(button.style, saved);
  return { x: rect.left, y: rect.top };
};

/**
 * Places the button at the bottom-right of the video box.
 *
 * While the card is marked - the pointer is on its video box - the button is placed `fixed` in the
 * viewport instead. The site's inline preview is a fixed overlay that paints over the card, so a
 * button inside the card ends up underneath it; making the *card* win instead would put the card
 * over the preview and hide the very thing the user is looking at (which is what happened first
 * time round). A fixed button lives in the page's top layer on its own: above that overlay, below
 * the site's own layers (masthead 2020), and the card keeps painting exactly where it was.
 */
export const alignButton = (button: HTMLButtonElement, host: Element) => {
  // Which subtree the button belongs in does not depend on being able to measure the video box.
  // This used to run after the measurement, so a card that had been removed from the page (or was
  // not laid out yet) left its button in the floating layer - under `<body>`, above everything, on
  // every page, for the rest of the session.
  const floating = host.classList.contains(MEDIA_HOVER_CLASS);
  keepButtonVisible(button, host, floating);

  const media = mediaBoxOf(host);
  if (!media) {
    return;
  }

  const { box } = media;

  if (floating) {
    const origin = fixedOrigin(button);
    button.style.left = `${Math.round(box.right - origin.x) - 8 - BUTTON_SIZE}px`;
    button.style.top = `${Math.round(box.bottom - origin.y) - BUTTON_LIFT - BUTTON_SIZE}px`;
    button.style.right = "";
    button.style.bottom = "";
    return;
  }

  const hostRect = host.getBoundingClientRect();
  button.style.left = "";
  button.style.top = "";
  button.style.right = `${Math.max(4, Math.round(hostRect.right - box.right) + 8)}px`;
  button.style.bottom = `${Math.max(4, Math.round(hostRect.bottom - box.bottom) + BUTTON_LIFT)}px`;
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

/**
 * Which of the button's states wins.
 *
 * A change the server refused is shown over everything else: a button that quietly returns to "not
 * saved" reads as "nothing happened" - which is how a save that never landed went unnoticed. A
 * change still in flight is shown over what the last known state was.
 */
export const buttonStateOf = (flags: {
  refused: boolean;
  pending: boolean;
  saved: boolean;
}): ButtonState => {
  if (flags.refused) {
    return "error";
  }
  if (flags.pending) {
    return "pending";
  }
  return flags.saved ? "saved" : "unsaved";
};

/** What each button was last painted with, so a repaint that changes nothing can be skipped. */
const painted = new WeakMap<
  HTMLButtonElement,
  { label: string; state: ButtonState }
>();

export const paintButton = (
  button: HTMLButtonElement,
  state: ButtonState,
  labels: { failed: string; remove: string; save: string }
) => {
  let label = labels.save;
  if (state === "saved") {
    label = labels.remove;
  } else if (state === "error") {
    // A refusal has to be readable, not just red: the button is the only place that knows which
    // video it was for, and "Save to Watch Later" on a button that just failed says nothing.
    label = labels.failed;
  }
  const last = painted.get(button);
  // Painting runs for every card on every scan. Rewriting the icon replaces the SVG, which is a
  // child-list mutation, which is what tells this plugin to scan again - so a paint that would
  // change nothing has to stay out of the document.
  if (last?.state === state && last.label === label) {
    return;
  }
  painted.set(button, { label, state });
  button.dataset.state = state;
  button.innerHTML =
    ICONS[state === "error" ? "unsaved" : state] ?? ICONS.unsaved;
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

/**
 * The key that toggles the video under the pointer, and the cases where it must be left alone.
 *
 * "The hovered video" is the marked card - the same thing the floating button belongs to - so the
 * shortcut and the button can never disagree about which video they mean. Ctrl, Cmd and Alt are
 * refused (Ctrl+W closes a window, and the site's own shortcuts live in that space); a keypress
 * that belongs to a text field, a contenteditable or the site's search box is the user typing.
 */
export const TOGGLE_SHORTCUT_KEY = "w";

export const isToggleShortcut = (event: KeyboardEvent): boolean => {
  if (event.key.toLowerCase() !== TOGGLE_SHORTCUT_KEY) {
    return false;
  }
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return false;
  }

  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return !(
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.closest("[contenteditable=''], [contenteditable='true']") !== null
  );
};

export const isThumbnailHost = (element: Element): boolean =>
  element.matches(THUMBNAIL_HOST_SELECTOR);
