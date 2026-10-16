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
 * The toolbar goes above the site's own "Date added (newest)" select: before the sort
 * header when there is one, and above the first row otherwise.
 */
/**
 * Where the toolbar goes: as the first thing after the playlist header, which is above the
 * site's own "Date added (newest)" chip and above the rows. The list renderer is the last
 * resort, for the surfaces that render no header.
 */
export const toolbarInsertionPoint = ():
  | { before: Element | null; parent: Element }
  | undefined => {
  const header = document.querySelector("ytd-playlist-header-renderer");
  if (header?.parentElement) {
    return { before: header.nextElementSibling, parent: header.parentElement };
  }
  const chip = document.querySelector("yt-sort-filter-sub-menu-renderer");
  if (chip?.parentElement) {
    return { before: chip, parent: chip.parentElement };
  }
  const list = document.querySelector("ytd-playlist-video-list-renderer");
  if (list) {
    return { before: list.firstElementChild, parent: list };
  }
  return undefined;
};
