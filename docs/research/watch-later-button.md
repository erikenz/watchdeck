# What `youtube-watch-later` can teach Watchdeck

## The question

Where does the open-source [YouTube Watch Later](https://github.com/dnwjn/youtube-watch-later) extension put its button, how does it keep the button aligned through YouTube's hover previews and re-renders, how does it determine Watch Later state, and how does it perform writes? The primary source reviewed here is the repository at commit `37093c7ffa94ab1485909f7877b271df795f071d` (the current checkout when this note was written). The code is a browser extension, so conclusions about the extension's DOM and browser APIs are not automatically conclusions about Watchdeck's Electron renderer.

The extension's own README claims that it adds an “Add to Watch Later” button to videos on various pages and in the notification drawer ([`README.md`, lines 5–11](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/README.md#L5-L11)).

## Findings

### 1. Where the button goes

There are two related but important paths:

* **Thumbnail cards use an overlay anchor, not YouTube's own thumbnail overlay controls.** The candidate card selectors include `ytd-rich-item-renderer`, `ytd-playlist-video-renderer`, `ytd-notification-renderer`, search-result cards, endscreen tiles, sidebar view-model cards, and mobile media-item menus ([`src/contents/button.tsx`, lines 60–80](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/contents/button.tsx#L60-L80)). Thumbnail candidates are deliberately excluded from the inline-anchor path because they are mounted through Plasmo's overlay API “above YouTube's global hover-preview player” ([`src/contents/button.tsx`, lines 82–103](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/contents/button.tsx#L82-L103)).
* **For ordinary inline mounts, it injects at the card anchor, before the card's first child**, not into the three-dots/mute/CC/settings control container ([`src/contents/button.tsx`, lines 150–174](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/contents/button.tsx#L150-L174)). For thumbnail cards specifically, it inserts into `ytd-thumbnail` or `yt-thumbnail-view-model`, falling back to the card if that thumbnail wrapper is absent. The source comment gives the reason: positioning should be relative to the thumbnail rather than the card's title/channel area ([`src/contents/button.tsx`, lines 163–171](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/contents/button.tsx#L163-L171)).
* **For overlay mounts, the shadow host is appended to `document.body` (or `document.documentElement`)** ([`src/contents/button.tsx`, lines 157–161](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/contents/button.tsx#L157-L161)). `getOverlayAnchorElements()` finds visible top-level card anchors from the selector list, removes nested duplicates, requires a video, and skips cards already containing `.watch-later-btn` ([`src/helpers/overlay.ts`, lines 9–22 and 47–54](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/helpers/overlay.ts#L9-L22)).
* **If the container does not exist yet**, the anchor list simply does not include it on that pass. The Plasmo watch/interval machinery is expected to discover it later. If an overlay scan returns zero, the extension waits one animation frame and scans again before treating the result as empty; this avoids tearing down every button during YouTube's brief preview-player detach/reattach ([`src/contents/button.tsx`, lines 106–119](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/contents/button.tsx#L106-L119)).

**Interpretation:** the extension does not append to the overlay that carries YouTube's own mute/CC/settings controls. It either mounts in the thumbnail wrapper/card or uses a page-level overlay host whose anchor is a card. The “overlay” in this code means the extension's positioning layer, not YouTube's control overlay.

### 2. Positioning, scrolling, and the inline hover preview

For normal thumbnails, the button is `position: absolute`; the extension makes the thumbnail wrapper `position: relative` and uses top/left or bottom/right offsets ([`src/contents/button.styles.ts`, lines 11–14 and 20–66](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/contents/button.styles.ts#L11-L14)). This is site-layout-relative, not a viewport-fixed coordinate. It naturally scrolls with the thumbnail.

For the overlay path, the host is absolutely positioned at the page root, and its child container/button is positioned from the measured anchor. The button's coordinates are derived from the card and its `ytd-thumbnail`/`yt-thumbnail-view-model` rectangle, with a small fixed inset ([`src/helpers/overlay.ts`, lines 143–178](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/helpers/overlay.ts#L143-L178)). The overlay host has `pointer-events: none`, while the button itself opts back into pointer events; its z-index is intentionally above thumbnails/preview content but below YouTube panels/menus ([`src/contents/button.styles.ts`, lines 268–300](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/contents/button.styles.ts#L268-L300)).

The overlay anchor is tracked with a short requestAnimationFrame burst followed by a 250 ms interval ([`src/contents/button.tsx`, lines 125–147](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/contents/button.tsx#L125-L147)). An alignment guard checks every frame that the positioned container is aligned with a non-zero anchor rectangle; it keeps a newly mounted/misaligned button hidden, with a roughly one-second safety fallback ([`src/hooks/useOverlayAlignmentGuard.ts`, lines 19–64](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/hooks/useOverlayAlignmentGuard.ts#L19-L64)).

The extension also observes YouTube's global `#video-preview-container` with a polling setup: it checks every 500 ms, up to ten attempts, and marks the preview hovered on `mouseenter`/`mouseleave` ([`src/hooks/useVideoPreviewListener.ts`, lines 10–31](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/hooks/useVideoPreviewListener.ts#L10-L31)). That state permits the button to remain visible for the relevant card when visibility is configured as hover-only ([`src/contents/button.tsx`, lines 359–376](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/contents/button.tsx#L359-L376)).

### 3. Re-renders, navigation, and recycled/virtualized cards

The overlay path uses a `MutationObserver` on `document.documentElement`, but it does not rescan the entire page for every mutation. It first checks whether added or removed nodes match or contain one of the overlay-anchor selectors ([`src/helpers/overlay.ts`, lines 56–66 and 118–124](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/helpers/overlay.ts#L56-L66)). Matching mutations are debounced by 200 ms; the host is evicted only when the computed anchor set differs from the prior set ([`src/helpers/overlay.ts`, lines 68–115](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/helpers/overlay.ts#L68-L115)).

It also listens for capture-phase `scroll`, because nested YouTube grids scroll without a bubbling window scroll event, and evicts the overlay host on the extension's delayed `ytwl-yt-nav-finish` event ([`src/helpers/overlay.ts`, lines 126–140](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/helpers/overlay.ts#L126-L140)). The page-side bridge listens to YouTube's `yt-navigate-start` and `yt-navigate-finish`; finish is delayed by 100 ms and coalesced ([`src/contents/yt.ts`, lines 43–61](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/contents/yt.ts#L43-L61)).

The code explicitly addresses virtualization: a card can remain in the DOM while its on-screen visibility changes, so scroll must trigger an anchor-set check, not just mutations ([`src/helpers/overlay.ts`, lines 76–82](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/helpers/overlay.ts#L76-L82)). This is the extension's answer to recycled/virtualized cards: recompute visible anchors and rebuild the overlay host when the set changes. It is not a per-card permanent attachment strategy.

There is also an important performance choice: after mounting, `mountShadowHost` disconnects Plasmo's full-page mutation observer, because the author considers a full-page anchor scan on every YouTube mutation too expensive; the remaining Plasmo interval plus the targeted eviction watcher do the work ([`src/contents/button.tsx`, lines 176–181](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/contents/button.tsx#L176-L181)).

### 4. How it knows whether a video is already in Watch Later

The reviewed code does **not** read Watch Later membership from YouTube's DOM, maintain a local database, or issue a membership lookup request. It extracts a video ID from the card's video URL ([`src/helpers/extracting.ts`, lines 8–18](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/helpers/extracting.ts#L8-L18)) and keeps only in-memory sets for IDs that this extension has marked pending, successfully added, or errored ([`src/store.ts`, lines 5–23 and 40–75](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/store.ts#L5-L23)). A successful write turns that button green/success; it is not evidence that an independently fetched Watch Later list was checked.

It hides the button on Watch Later and playlist pages based on URL state, rather than proving per-video membership ([`src/contents/button.tsx`, lines 493–500](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/contents/button.tsx#L493-L500)). The README describes an “Add to Watch Later” button and does not claim a membership-aware toggle ([`README.md`, lines 5–11](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/README.md#L5-L11)).

### 5. How it saves/removes, and failures/retries/rate limits

The save is a **direct InnerTube request**, not a synthetic click on YouTube's three-dots menu. `addToWatchLater` sends `ACTION_ADD_VIDEO` to playlist `WL` through `browse/edit_playlist?prettyPrint=false` ([`src/helpers/api.ts`, lines 105–123](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/helpers/api.ts#L105-L123)). The common request helper posts JSON to `https://<current-youtube-host>/youtubei/v1/<path>` with YouTube page-derived client data and a SAPISID-family authorization header ([`src/helpers/api.ts`, lines 64–102](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/helpers/api.ts#L64-L102); the SAPISID hash construction is at lines 16–56).

A response is accepted only when HTTP `response.ok` and the parsed body says `status === 'STATUS_SUCCEEDED'`; anything else is logged and rejected ([`src/helpers/api.ts`, lines 119–137](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/helpers/api.ts#L119-L137)). The button disables itself while pending, marks success on resolution, and on failure marks an error, shows it for two seconds, then returns to the default state ([`src/contents/button.tsx`, lines 403–430](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/contents/button.tsx#L403-L430)).

No remove path, `ACTION_REMOVE_VIDEO`, retry loop, exponential backoff, or explicit rate-limit handling appears in the reviewed source. Therefore this is an add-only action with one request attempt and transient UI feedback. The public issue tracker corroborates that auth/request failures are a real operational concern: issue [#201](https://github.com/dnwjn/youtube-watch-later/issues/201) records a stuck loading state and “SAPISID cookie not found,” and issue [#236](https://github.com/dnwjn/youtube-watch-later/issues/236) discusses failed `edit_playlist` responses. Those reports are supplemental evidence about failure modes, not a substitute for the source-code behavior above.

### 6. Other lessons about interaction and UI ownership

* The button is a real `<button>`, prevents the click from navigating the card, and disables itself outside the default state ([`src/contents/button.tsx`, lines 565–573](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/contents/button.tsx#L565-L573)).
* Its SVG does not take pointer events, while the button does; thumbnail buttons have explicit z-index, hover background, opacity, loading animation, and success/error colors ([`src/contents/button.styles.ts`, lines 20–31 and 216–266](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/contents/button.styles.ts#L20-L31)). This reduces accidental competition between the icon and the card's hover behavior.
* The extension supports “always” or “hover” visibility and per-location placement/opacity settings, according to its README ([`README.md`, lines 35–78](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/README.md#L35-L78)). The source's preview-hover state is specifically used to make hover-only behavior workable while YouTube moves the preview outside the thumbnail.
* The selectors are centralized and include both older `ytd-*` elements and newer view-model hosts. The source comment notes a newer class-name replacement, which is a concrete reminder that selector churn is expected ([`src/contents/button.tsx`, lines 60–80](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/contents/button.tsx#L60-L80)).

### 7. How it authenticates the request (and what it confirms about this app)

The extension's write path is one `POST` per action, and everything the request needs is read from the page or
the cookie jar at call time:

* **It only ever sees the site's own cookies.** `chrome.cookies.get({ url: 'https://www.youtube.com', name })`
is asked for `SAPISID`, `__Secure-1PAPISID` and `__Secure-3PAPISID` ([`src/background/messages/visitor-cookie.ts`, lines 9–23](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/background/messages/visitor-cookie.ts#L9-L23)).
A `.google.com` cookie is not sent to `youtube.com`, so that query cannot return it — the extension never has
the `google.com` copies in hand, whatever the jar holds. That is the same conclusion this app reached by
measurement, by a different route
([`docs/research/youtube-session-cookies.md`](./youtube-session-cookies.md)).
* **The `__Secure-3PAPISID` fallback is written out in a comment** ([`src/helpers/api.ts`, lines 41–53](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/helpers/api.ts#L41-L53)):
`cookies.sapisid ?? cookies.sapisid3p` builds `SAPISIDHASH`, with “Some browsers/accounts no longer set the
plain SAPISID cookie. YouTube accepts __Secure-3PAPISID's value as a SAPISIDHASH fallback in that case (a
SAPISID3PHASH alone is not enough to authorize mutating requests).” It sends `SAPISIDHASH`,
`SAPISID1PHASH` and `SAPISID3PHASH` together, each from its own cookie. This is the alias this app now
applies, arrived at independently — and the “3PHASH alone is not enough” half is what the app measured as
`loggedOut` with an empty list.
* **The client is the page's, not a hard-coded one.** `SESSION_INDEX` → `X-Goog-Authuser`,
`DELEGATED_SESSION_ID` → `X-Goog-PageId`, `VISITOR_DATA` → `X-Goog-Visitor-Id`, `INNERTUBE_CLIENT_VERSION` →
both `context.client.clientVersion` and `X-Youtube-Client-Version`, plus `X-Origin`,
`X-Youtube-Client-Name: 1` and `X-Youtube-Bootstrap-Logged-In: true`
([`src/contents/yt.ts`, lines 18–26](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/contents/yt.ts#L18-L26),
[`src/helpers/api.ts`, lines 85–100](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/helpers/api.ts#L85-L100)).
* **`LOGGED_IN` from `ytcfg` is a pre-flight.** The button's render guard is
`enabled && (isInNotification || !isWatchLaterItem)` ([`src/contents/button.tsx`, line 499](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/contents/button.tsx#L499)),
and `enabled` is set from `ytData.loggedIn` on every navigation
([line 216](https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/src/contents/button.tsx#L216)).
On a signed-out page there is no button at all — it does not offer a save it knows will fail. It is still not
a *label*: nothing on screen says “signed out”.
* The failure mode of its issue tracker follows from the same code: `'SAPISID cookie not found'` is thrown when
all three APISID cookies are missing for `youtube.com`, which is what the fallback exists to survive.

## What this app should take from it

Watchdeck should keep the button owned by its **card renderer**, not inject it into YouTube's mute/CC/settings overlay and not attach it to the thumbnail link that YouTube can replace during an inline preview. That matches the app's own decision record: use a card anchor, and when the preview covers the card, move only the button into a page-level floating layer ([`docs/PRD.md`, lines 671–694](../PRD.md#L671-L694)).

The practical recommendation is:

1. Keep one button-to-card mapping and derive its video ID from the card model/URL.
2. Render the normal button in the card's video-box container, above the duration badge at the app's chosen stable offset.
3. During the site's inline preview, portal **only the button** to a body-level layer and position it from measured card/video-box rectangles. Do not raise the whole card: the extension's source and Watchdeck's PRD both identify that as a way to paint the preview underneath the thumbnail ([`docs/PRD.md`, lines 682–707](../PRD.md#L682-L707)).
4. Use Watchdeck's database/sync as the source of truth for saved state. Unlike this extension, Watchdeck should implement a real save/remove state machine, accept success only after the service/list confirms the mutation, and expose a retryable error rather than treating one HTTP response as membership proof.
5. Preserve keyboard focus, `aria-label`/pressed state, click propagation guards, and a pending/error visual state. Keep selector/DOM integration in one renderer module, and use targeted mutation/scroll/resize observation rather than a whole-page scan on every mutation.

The main thing **not** to copy is the extension's in-memory “added” set as membership truth and its direct browser-cookie/SAPISID plumbing. In a desktop client those concerns belong behind the renderer's IPC boundary and the app's account-aware database/sync service; the renderer should receive a state snapshot and mutation result rather than read browser cookies or own the network authorization flow.

Three things in finding 7 are worth more than they cost, though none is done yet:

* **Do not offer a save that cannot work.** The app's open TODO item “nothing in the UI says signed out” is the
  half of this the extension gets right by accident: it reads `LOGGED_IN` off the page before deciding whether to
  draw a button. **Built in 0.1.6** — the renderer reports `LOGGED_IN` next to `SESSION_INDEX`, the backend turns
  it into `needsAuth`, and every hover button is painted disabled with the reason (see PRD §4.2 note 9). One
  deliberate difference: this app keeps the button and labels it rather than removing it. On a card page the
  button is the only surface that can explain itself — a missing button explains nothing, and a signed-out Watch
  Later page has no list for the toolbar to sit above, so the toolbar's own line is not a surface the user sees.
* **`X-Goog-PageId` for a delegated (brand) session.** The app's session never sends it: `youtubei.js` sets the
  header only when `session.context.user.onBehalfOfUser` is set, which nothing here sets, and the app has no
  equivalent of `DELEGATED_SESSION_ID`. A brand account is therefore acted on as the personal one, or refused.
  Not urgent (the PRD's assumption is the first account of the session), but it is the difference between “works
  for the accounts I have” and “works for the accounts YouTube lets people have”.
* **Send the page's client version and visitor data rather than a synthesized pair.** The extension takes
  `INNERTUBE_CLIENT_VERSION` and `VISITOR_DATA` off the page, where this app lets the library invent both. A
  client version baked into a dependency goes stale without anything failing until YouTube stops accepting it;
  the page's copy cannot.

## Sources

* Extension repository and reviewed revision: <https://github.com/dnwjn/youtube-watch-later/tree/37093c7ffa94ab1485909f7877b271df795f071d>
* README: <https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/README.md>
* Store listing: <https://github.com/dnwjn/youtube-watch-later/blob/37093c7ffa94ab1485909f7877b271df795f071d/docs/store-listing.md>
* Primary source paths: `src/contents/button.tsx`, `src/helpers/overlay.ts`, `src/hooks/useVideoPreviewListener.ts`, `src/hooks/useOverlayAlignmentGuard.ts`, `src/helpers/api.ts`, `src/store.ts`, `src/contents/button.styles.ts`, `src/contents/yt.ts`, `src/helpers/matching.ts`, and `src/helpers/extracting.ts`.
* Supplemental author/user issue discussions: <https://github.com/dnwjn/youtube-watch-later/issues/201>, <https://github.com/dnwjn/youtube-watch-later/issues/236>
* Watchdeck design record used for the desktop-client recommendation: [`docs/PRD.md`](../PRD.md), especially §R4.
