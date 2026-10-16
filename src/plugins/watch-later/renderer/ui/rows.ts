import { t } from "@/i18n";

import type { WatchLaterEntry } from "../../types";

/** The site's own rows on the Watch Later page, both generations of markup. */
export const ROW_SELECTOR = [
  "ytd-playlist-video-renderer",
  "ytd-playlist-panel-video-renderer",
  "yt-lockup-view-model",
].join(",");

export const ROW_META_CLASS = "wd-wl-row-meta";
export const ROW_HIDDEN_CLASS = "wd-wl-row-hidden";
export const TOOLBAR_HOST_CLASS = "wd-wl-toolbar-host";

const videoIdFromRow = (row: Element): string | undefined => {
  const link =
    row.querySelector('a[href*="/watch?v="]') ??
    row.querySelector('a[href*="/shorts/"]');
  const href = link?.getAttribute("href");
  if (!href) {
    return undefined;
  }
  try {
    const parsed = new URL(href, window.location.origin);
    return parsed.searchParams.get("v") ?? parsed.pathname.split("/").at(-1);
  } catch {
    return undefined;
  }
};

/** Where our line goes: beside the title metadata, whatever wrapper this generation uses. */
const metaHost = (row: Element): Element =>
  row.querySelector("#meta") ??
  row.querySelector("#details") ??
  row.querySelector("#content") ??
  row;

/** The owner asked for this format rather than the ISO one the store keeps. */
export const formatDate = (iso: string) => {
  const [date] = iso.split("T");
  const [year, month, day] = date.split("-");
  return year && month && day ? `${year}/${month}/${day}` : date;
};

const bucketText = (entry: WatchLaterEntry) =>
  entry.bucket === "in-progress"
    ? t("plugins.watch-later.row.in-progress")
    : entry.bucket === "watched"
      ? t("plugins.watch-later.row.watched")
      : t("plugins.watch-later.row.unwatched");

/**
 * Adds what the site does not show for a Watch Later item: how far it has been watched,
 * where that number comes from, and which bucket the filters put it in. Idempotent - the
 * row keeps its element and only its text changes.
 */
export const enhanceRow = (
  row: Element,
  entry: WatchLaterEntry | undefined
) => {
  if (!entry) {
    return;
  }
  const host = metaHost(row);
  let meta = row.querySelector<HTMLElement>(`.${ROW_META_CLASS}`);
  if (!meta) {
    meta = document.createElement("div");
    meta.className = ROW_META_CLASS;
    meta.innerHTML =
      '<span class="wd-wl-dot"></span><span class="wd-wl-meta-text"></span>';
    host.append(meta);
  }

  const percent = Math.round(entry.ratio * 100);
  const parts = [bucketText(entry)];
  if (percent > 0) {
    parts.push(t("plugins.watch-later.row.percent", { percent }));
  }
  if (entry.savedAt) {
    parts.push(
      t("plugins.watch-later.row.saved", { date: formatDate(entry.savedAt) })
    );
  }

  meta.dataset.bucket = entry.bucket;
  meta.title = t("plugins.watch-later.row.title");
  const text = meta.querySelector(".wd-wl-meta-text");
  if (text && text.textContent !== parts.join(" · ")) {
    text.textContent = parts.join(" · ");
  }
};

/** Shows or hides a native row according to the active filter (`null` = no filter). */
export const applyRowVisibility = (
  row: Element,
  visible: Set<string> | null
) => {
  const videoId = videoIdFromRow(row);
  const shown =
    visible === null || (videoId !== undefined && visible.has(videoId));
  row.classList.toggle(ROW_HIDDEN_CLASS, !shown);
  return shown;
};

export const rowVideoId = videoIdFromRow;

/**
 * The site's own sort control: a chip in the section header on the current markup, a chip inside
 * the list renderer on older ones. The list renderer keeps a `#sort-filter-menu` that stays
 * `display: none` whenever the visible control lives in the header, so candidates are measured:
 * anchoring the toolbar to a hidden copy mounts it where it can never be seen.
 */
const SORT_CONTROL_SELECTOR = [
  "yt-sort-filter-sub-menu-renderer",
  "ytd-sort-filter-sub-menu-renderer",
  "#sort-filter-menu",
  "chip-view-model",
].join(",");

const visibleSortControl = (): Element | undefined => {
  for (const candidate of document.querySelectorAll(SORT_CONTROL_SELECTOR)) {
    const box = candidate.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) {
      return candidate;
    }
  }
  return undefined;
};

/**
 * Where the toolbar goes: above the site's own sort control, in the container that already holds
 * it, so the page keeps deciding the column's layout. The section header is preferred over the
 * chip itself - the chip shares its row with whatever else the header carries, while the header
 * is a block container in the primary column, where a sibling lands above the whole row.
 */
export const toolbarInsertionPoint = ():
  | { before: Element | null; parent: Element }
  | undefined => {
  const chip = visibleSortControl();
  const header = chip?.closest("#header");
  if (header?.parentElement) {
    return { before: header, parent: header.parentElement };
  }
  if (chip?.parentElement) {
    return { before: chip, parent: chip.parentElement };
  }
  const list = document.querySelector("ytd-playlist-video-list-renderer");
  if (!list) {
    return undefined;
  }
  // No sort control at all: the toolbar sits above the rows. That only works inside the list
  // renderer while it stacks its children; a list that lays them in a row would put the toolbar
  // beside the rows instead of above them.
  return getComputedStyle(list).flexDirection.startsWith("column")
    ? { before: list.firstElementChild, parent: list }
    : { before: list, parent: list.parentElement ?? list };
};
