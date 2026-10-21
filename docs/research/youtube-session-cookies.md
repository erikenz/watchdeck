# Which cookies authenticate a Watch Later request

## The question

The app's Watch Later reads and writes are InnerTube calls made from the main process with the
window's cookies
([`src/plugins/watch-later/backend/session.ts`](../../src/plugins/watch-later/backend/session.ts)).
Which cookies does that string have to carry, and from which origin?

## What was measured

Against the live account on 2026-10-21, one `/browse` of the Watch Later list per row, with the
same client library the app uses:

| cookie string | answer |
| --- | --- |
| the `.youtube.com` set as the jar holds it - `__Secure-3PSID`, `__Secure-3PAPISID`, `__Secure-1PSIDTS`, `__Secure-3PSIDTS`, `LOGIN_INFO`, `PREF`, … and **no** plain `SAPISID`, no `SID` | `"loggedOut":true`, empty list; a write answers `STATUS_FAILED` |
| the same set with `SAPISID` = the site's `__Secure-3PAPISID` | signed in: the real list, 101 items on the first page |
| that working string plus `.google.com`'s `__Secure-1PSID` | `"loggedOut":true` |
| that working string plus `.google.com`'s `__Secure-3PSIDTS` | `"loggedOut":true` |
| that working string plus any other single `.google.com` cookie (`SID`, `HSID`, `SSID`, `APISID`, `SAPISID`, `__Secure-3PSID`, …) | still signed in |
| the site's set merged with the whole `.google.com` set, the site winning a name clash | `"loggedOut":true` - the merge carries `.google.com`'s `__Secure-1PSID` |
| the `.google.com` set alone | `"loggedOut":true` - it has no binding tokens |

Independently: the page's own `/youtubei/v1/*` requests carry **only** the site's cookies, and an
`Authorization: SAPISIDHASH <ts>_<hash>_u SAPISID3PHASH <ts>_<hash>_u` header. The secret behind
that hash is the site's `__Secure-3PAPISID` (the value is in `document.cookie` on the page; the
`.google.com` copy of `SAPISID` has the same value here).

## What it means

* `youtubei.js` builds `SAPISIDHASH` from the cookie literally named `SAPISID`. With no cookie by
  that name it sends no `Authorization` header at all, and the server answers `loggedOut` even
  though every session cookie is present and valid. That is the whole failure: a page that works
  and an API call that says nobody is signed in.
* YouTube no longer sets a plain `SAPISID` on `.youtube.com` (it still sets one on
  `.google.com`), so a request built from the site's cookies has nothing to hash. The site's own
  `__Secure-3PAPISID` is the equivalent secret, and the page hashes exactly that.
* The `.google.com` cookies are a second, differently-rotated copy of the same session, and this
  request is not going to `google.com`. Adding the account's `__Secure-1PSID` from there - or a
  `__Secure-3PSIDTS` that disagrees with the site's - turns a signed-in answer back into
  `loggedOut`. Merging origins is worse than not merging.
* The rule that follows: read `https://www.youtube.com`, and let `__Secure-3PAPISID` answer for
  `SAPISID` when the site has no `SAPISID` of its own. Implemented as `siteCookieString` and
  `readSessionCookies` in
  [`src/plugins/watch-later/backend/session.ts`](../../src/plugins/watch-later/backend/session.ts).

## Re-measuring it

Build a client on a cookie string, then look at the answer:

```js
const yt = await Innertube.create({
  cookie,
  generate_session_locally: true,
  retrieve_innertube_config: false,
  retrieve_player: false,
});
yt.session.account_index = 1;
const response = await yt.actions.execute("/browse", { browseId: "VLWL" });
const json = JSON.stringify(response.data);
console.log(/"loggedOut":true/.test(json), (json.match(/lockupViewModel/g) ?? []).length);
```

A signed-in answer has `false` and a non-zero count. `VLWL` is the Watch Later list; the same
client's `/browse/edit_playlist` with `ACTION_ADD_VIDEO` answers `STATUS_SUCCEEDED` or
`STATUS_FAILED` and says the same thing about the session.

## Related

* The reference extension this app was measured against has the same failure mode in its issue
  tracker: [youtube-watch-later#201](https://github.com/dnwjn/youtube-watch-later/issues/201),
  "SAPISID cookie not found" - its request helper reads a SAPISID-family cookie out of the page and
  has nothing to read when the site stops setting one
  (see [`watch-later-button.md`](./watch-later-button.md), finding 5).
