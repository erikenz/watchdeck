/**
 * The Watch Later list is the internal playlist `WL`. The official Data API cannot
 * read it (Google closed `WL` to third parties in 2016), so this speaks InnerTube -
 * the private API the website itself uses - with the session cookies the app already
 * has. Everything here is pure: payloads in, raw JSON parsed, so the paging logic
 * above it is testable without a network.
 *
 * Two generations of item payload are in the wild: the classic
 * `playlistVideoRenderer` and the newer `lockupViewModel`. Both are handled, because
 * YouTube serves whichever it feels like per surface and per account.
 */

export const WATCH_LATER_PLAYLIST_ID = "WL";

export interface WatchLaterPageItem {
  videoId: string;
  setVideoId?: string;
  title: string;
  channelId?: string;
  channelTitle?: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
  isLive?: boolean;
  /** YouTube's own resume indicator, whole percent, when the item has one. */
  ytPercentWatched?: number;
  /** The "Watched" badge YouTube renders on fully watched items. */
  watchedBadge?: boolean;
}

export interface WatchLaterPage {
  items: WatchLaterPageItem[];
  continuation?: string;
  totalItems?: number;
}

export interface VideoDetails {
  description?: string;
  tags?: string[];
  channelId?: string;
  isLive?: boolean;
  raw?: unknown;
}

export const browsePayload = (continuation?: string) =>
  continuation
    ? { continuation }
    : { browseId: `VL${WATCH_LATER_PLAYLIST_ID}` };

export const addVideoPayload = (videoId: string) => ({
  actions: [{ action: "ACTION_ADD_VIDEO", addedVideoId: videoId }],
  playlistId: WATCH_LATER_PLAYLIST_ID,
});

export const removeVideoPayload = (setVideoId: string) => ({
  actions: [{ action: "ACTION_REMOVE_VIDEO", setVideoId }],
  playlistId: WATCH_LATER_PLAYLIST_ID,
});

export const playerPayload = (videoId: string) => ({ videoId });

// --- generic walkers over raw JSON (no `any`, no deep child paths) ----------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const child = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined;

const children = (value: unknown, key: string): unknown[] => {
  const found = child(value, key);
  return Array.isArray(found) ? found : [];
};

/** Breadth-first search for the first object found under `key`. */
export const firstOfType = (input: unknown, key: string): unknown => {
  const queue: unknown[] = [input];
  while (queue.length > 0) {
    const node = queue.shift();
    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }
    if (!isRecord(node)) {
      continue;
    }
    if (key in node) {
      return node[key];
    }
    queue.push(...Object.values(node));
  }
  return undefined;
};

const textOf = (input: unknown): string | undefined => {
  if (typeof input === "string") {
    return input;
  }
  if (Array.isArray(input)) {
    for (const entry of input) {
      const text = textOf(entry);
      if (text) {
        return text;
      }
    }
    return undefined;
  }
  if (!isRecord(input)) {
    return undefined;
  }
  for (const key of ["simpleText", "content", "text", "label", "title"]) {
    const value = child(input, key);
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  const runs = child(input, "runs");
  if (Array.isArray(runs)) {
    const joined = runs
      .map((run) =>
        typeof run === "string" ? run : textOf(child(run, "text"))
      )
      .filter((part): part is string => typeof part === "string")
      .join("");
    return joined.length > 0 ? joined : undefined;
  }
  return undefined;
};

const lastUrl = (input: unknown): string | undefined => {
  const queues: unknown[] = [input];
  while (queues.length > 0) {
    const node = queues.shift();
    if (Array.isArray(node)) {
      const withUrl = node.filter(
        (entry) => typeof child(entry, "url") === "string"
      );
      if (withUrl.length > 0) {
        return child(withUrl.at(-1), "url") as string;
      }
      queues.push(...node);
      continue;
    }
    if (!isRecord(node)) {
      continue;
    }
    queues.push(...Object.values(node));
  }
  return undefined;
};

const secondsFromText = (text: string | undefined): number | undefined => {
  if (!text) {
    return undefined;
  }
  const parts = text.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => !Number.isFinite(part))) {
    return undefined;
  }
  return parts.reduce((total, part) => total * 60 + part, 0);
};

/** YouTube formats counts as "1,487 videos"; only the number matters. */
export const countFromText = (text: string | undefined): number | undefined => {
  if (!text) {
    return undefined;
  }
  const digits = text.replaceAll(/[^\d]/g, "");
  if (digits.length === 0) {
    return undefined;
  }
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

interface ItemOverlays {
  percent?: number;
  watchedBadge: boolean;
}

/** Resume percentage and the "Watched" badge, wherever the surface puts them. */
export const parseItemOverlays = (item: unknown): ItemOverlays => {
  let percent: number | undefined;
  let watchedBadge = false;
  const queue: unknown[] = [item];

  while (queue.length > 0) {
    const node = queue.shift();
    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }
    if (!isRecord(node)) {
      continue;
    }
    const resume = child(node, "thumbnailOverlayResumePlaybackRenderer");
    const value = child(resume, "percentDurationWatched");
    if (typeof value === "number") {
      percent = value;
    }
    if ("thumbnailOverlayPlaybackStatusRenderer" in node) {
      watchedBadge = true;
    }
    queue.push(...Object.values(node));
  }

  return { percent, watchedBadge };
};

const collectItemNodes = (input: unknown): unknown[] => {
  const found: unknown[] = [];
  // Breadth-first with an index cursor: it keeps the items in the order the page
  // listed them (a stack walked them backwards, which reordered the whole list).
  const queue: unknown[] = [input];

  // The playlist page nests items inside renderer wrappers; walking the whole
  // response and picking the two known shapes is more robust than a deep path.
  // `for...of` keeps reading the array as it grows, which is exactly what a
  // work queue needs here.
  for (const node of queue) {
    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }
    if (!isRecord(node)) {
      continue;
    }
    if ("playlistVideoRenderer" in node || "lockupViewModel" in node) {
      found.push(node);
      continue;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value) || isRecord(value)) {
        queue.push(value);
      }
    }
  }

  return found;
};

const parseLegacyItem = (
  renderer: Record<string, unknown>
): WatchLaterPageItem | undefined => {
  const videoId = child(renderer, "videoId");
  if (typeof videoId !== "string") {
    return undefined;
  }

  const byline = children(renderer, "shortBylineText")[0];
  const bylineRun = children(child(renderer, "shortBylineText"), "runs")[0];
  const badgedLive = children(renderer, "badges").some((badge) => {
    const label = textOf(child(badge, "metadataBadgeRenderer")) ?? "";
    return label.toUpperCase().includes("LIVE");
  });
  const overlays = parseItemOverlays(renderer);
  const lengthText =
    textOf(child(renderer, "lengthText")) ??
    textOf(
      child(firstOfType(renderer, "thumbnailOverlayTimeStatusRenderer"), "text")
    );

  return {
    channelId:
      typeof child(child(bylineRun, "navigationEndpoint"), "browseEndpoint") ===
      "object"
        ? textOf(
            child(
              child(child(bylineRun, "navigationEndpoint"), "browseEndpoint"),
              "browseId"
            )
          )
        : undefined,
    channelTitle: textOf(child(byline, "runs")) ?? textOf(byline),
    durationSeconds: secondsFromText(lengthText),
    isLive: badgedLive || undefined,
    setVideoId:
      typeof child(renderer, "setVideoId") === "string"
        ? (child(renderer, "setVideoId") as string)
        : undefined,
    thumbnailUrl: lastUrl(child(renderer, "thumbnail")),
    title: textOf(child(renderer, "title")) ?? "",
    videoId,
    watchedBadge: overlays.watchedBadge || undefined,
    ytPercentWatched: overlays.percent,
  };
};

const parseLockupItem = (
  lockup: Record<string, unknown>
): WatchLaterPageItem | undefined => {
  const videoId = child(lockup, "contentId");
  if (typeof videoId !== "string") {
    return undefined;
  }
  const metadataViewModel = child(lockup, "metadata");
  const metadataParts = firstOfType(metadataViewModel, "metadataParts");
  const overlays = parseItemOverlays(lockup);
  const badgeText =
    textOf(firstOfType(lockup, "thumbnailOverlayBadgeViewModel")) ?? "";
  const parts = Array.isArray(metadataParts)
    ? metadataParts.map((part) => textOf(part)).filter(Boolean)
    : [];

  return {
    channelTitle: parts.length > 1 ? parts.at(-1) : undefined,
    durationSeconds: secondsFromText(
      textOf(firstOfType(lockup, "thumbnailOverlayTimeStatusRenderer"))
    ),
    isLive: badgeText.toUpperCase().includes("LIVE") || undefined,
    thumbnailUrl: lastUrl(firstOfType(lockup, "thumbnailViewModel")),
    title:
      textOf(firstOfType(metadataViewModel, "lockupMetadataViewModel")) ?? "",
    videoId,
    watchedBadge: overlays.watchedBadge || undefined,
    ytPercentWatched: overlays.percent,
  };
};

export const parseWatchLaterPage = (data: unknown): WatchLaterPage => {
  const items: WatchLaterPageItem[] = [];

  for (const node of collectItemNodes(data)) {
    const renderer = child(node, "playlistVideoRenderer");
    const lockup = child(node, "lockupViewModel");
    const item = isRecord(renderer)
      ? parseLegacyItem(renderer)
      : isRecord(lockup)
        ? parseLockupItem(lockup)
        : undefined;
    if (item) {
      items.push(item);
    }
  }

  const command = firstOfType(data, "continuationCommand");
  const token = child(command, "token");

  return {
    continuation: typeof token === "string" ? token : undefined,
    items,
    totalItems: countFromText(
      textOf(firstOfType(data, "numVideosText")) ??
        textOf(firstOfType(data, "stats"))
    ),
  };
};

export const parseVideoDetails = (data: unknown): VideoDetails => {
  const details = firstOfType(data, "videoDetails");
  if (!isRecord(details)) {
    return { raw: data };
  }
  const keywords = child(details, "keywords");

  return {
    channelId:
      typeof child(details, "channelId") === "string"
        ? (child(details, "channelId") as string)
        : undefined,
    description:
      typeof child(details, "shortDescription") === "string"
        ? (child(details, "shortDescription") as string)
        : undefined,
    isLive: child(details, "isLiveContent") === true,
    raw: data,
    tags: Array.isArray(keywords)
      ? keywords.filter((tag): tag is string => typeof tag === "string")
      : undefined,
  };
};

/** `edit_playlist` answers with an empty body on success, an error object when not. */
export const parseMutationResponse = (
  statusCode: number,
  data: unknown
): { ok: boolean; error?: string } => {
  const code = child(child(data, "error"), "code");
  if (statusCode >= 200 && statusCode < 300 && typeof code !== "string") {
    return { ok: true };
  }
  return {
    error:
      typeof code === "string" ? code : `request failed with ${statusCode}`,
    ok: false,
  };
};
