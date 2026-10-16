/**
 * Everything that touches the page's DOM lives here: the hosts the button attaches
 * to, how a video id is read off a thumbnail, and the button element itself. The
 * host list follows what the site actually serves - the classic `ytd-thumbnail`
 * cards and the newer view-model cards, which appear on different surfaces and
 * sometimes both at once.
 */

export const THUMBNAIL_HOST_SELECTOR = [
  "ytd-thumbnail",
  "yt-thumbnail-view-model",
  "ytThumbnailViewModelHost",
  "a.ytLockupViewModelContentImage",
  "a.yt-lockup-view-model__content-image",
].join(",");

export const BUTTON_CLASS = "wd-wl-save";
export const HOST_CLASS = "wd-wl-anchor";

const VIDEO_PATH = "/watch";
const VIDEO_ID_PATTERN = /(?:^|\/)(?:shorts|embed|live)\/([\w-]{11})/;

/** Reads the video id from the card's own link instead of a deep child path. */
export const videoIdFromHost = (host: Element): string | undefined => {
  const link =
    host.matches('a[href*="watch"]') || host.matches("a[href*='/shorts/']")
      ? host
      : (host.querySelector('a[href*="watch"]') ??
        host.querySelector("a[href*='/shorts/']") ??
        host.closest('a[href*="watch"]'));

  const href = link?.getAttribute("href");
  if (!href) {
    return undefined;
  }

  try {
    const url = new URL(href, window.location.origin);
    if (url.pathname === VIDEO_PATH) {
      return url.searchParams.get("v") ?? undefined;
    }
    return VIDEO_ID_PATTERN.exec(url.pathname)?.[1];
  } catch {
    return undefined;
  }
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
