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

/**
 * The removal that does not need the per-entry id. `ACTION_REMOVE_VIDEO` keys on the
 * `setVideoId` the list carries, which an entry added from the app does not have until a walk
 * reads it - and a walk of a long list may never reach it. YouTube's own menu removes a video
 * from Watch Later without knowing that id either, and this is what it sends.
 */
export const removeVideoByIdPayload = (videoId: string) => ({
  actions: [
    { action: "ACTION_REMOVE_VIDEO_BY_VIDEO_ID", removedVideoId: videoId },
  ],
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
  const overlays = child(item, "thumbnailOverlays");
  const queue: unknown[] = Array.isArray(overlays) ? [...overlays] : [];

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
    // Only the badge overlay, and only when it says so: the item subtree contains other
    // nodes that mention playback status, and matching those marked plain videos watched.
    const status = child(node, "thumbnailOverlayPlaybackStatusRenderer");
    if (
      status !== undefined &&
      (textOf(child(status, "text")) ?? textOf(status) ?? "")
        .toLowerCase()
        .includes("watched")
    ) {
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

  // The byline is `shortBylineText.runs[0]`: the run carries the channel name, and its
  // navigationEndpoint the channel id. (`children()` only walks arrays, so it cannot be
  // used for the byline object itself - reaching for it is what dropped every channel.)
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
    channelId: textOf(
      child(
        child(child(bylineRun, "navigationEndpoint"), "browseEndpoint"),
        "browseId"
      )
    ),
    channelTitle: textOf(bylineRun),
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
  const overlays = parseItemOverlays(
    firstOfType(lockup, "thumbnailOverlays") === undefined ? lockup : lockup
  );
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
  const countText =
    textOf(firstOfType(data, "numVideosText")) ??
    textOf(firstOfType(data, "stats"));

  return {
    continuation: typeof token === "string" ? token : undefined,
    items,
    // A header that carries no number is not a header that could not be read: an empty list says
    // "No videos", which is the site stating a count of zero - and the sync needs to tell that
    // apart from a page whose count it never got.
    totalItems:
      countText === undefined ? undefined : (countFromText(countText) ?? 0),
  };
};

export interface SessionIdentity {
  handle?: string;
  name: string;
  /** Subscriber/membership line YouTube shows under the name, when it sends one. */
  byline?: string;
  photoUrl?: string;
  selected?: boolean;
}

/**
 * The account switcher's response, reduced to the identity it describes.
 *
 * `account/accounts_list` answers with the identity the request acted as, which is what
 * makes it the probe for "who is `X-Goog-Authuser: n`": the list has no index of its own,
 * and the array order of a multi-account list does *not* match the header.
 */
export const parseIdentity = (data: unknown): SessionIdentity | undefined => {
  const stack: unknown[] = [data];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (!isRecord(node)) {
      continue;
    }
    const handle = textOf(child(node, "channelHandle"));
    const name = textOf(child(node, "accountName"));
    if (handle || name) {
      return {
        byline: textOf(child(node, "accountByline")),
        handle,
        name: name ?? handle ?? "",
        photoUrl: lastUrl(child(node, "accountPhoto")),
        selected: child(node, "isSelected") === true,
      };
    }
    stack.push(...Object.values(node));
  }
  return undefined;
};

/**
 * Walks the candidate indices and keeps the ones that answer.
 *
 * `X-Goog-Authuser` is the only way to ask "who is index n", so the indices are probed -
 * bounded, and stopping once two in a row come back empty (a session with one account
 * answers at 0, one with four answers at 0..3).
 */
export const probeAccounts = async (
  identityAt: (index: number) => Promise<SessionIdentity | undefined>,
  maxIndex = 5
): Promise<{ index: number; identity: SessionIdentity }[]> => {
  const found: { index: number; identity: SessionIdentity }[] = [];
  let misses = 0;

  for (let index = 0; index <= maxIndex && misses < 2; index += 1) {
    const identity = await identityAt(index);
    if (!identity) {
      misses += 1;
      continue;
    }
    misses = 0;
    found.push({ identity, index });
  }

  return found;
};

export const accountsListPayload = () => ({
  callCircumstance: "SWITCHING_USERS_FULL",
  requestType: "ACCOUNTS_LIST_REQUEST_TYPE_CHANNEL_SWITCHER",
});

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
