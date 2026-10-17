/**
 * SponsorBlock's official Chrome release, described for the shared extension loader
 * (`src/extensions/web-extension.ts`), which does the downloading, unpacking and patching.
 *
 * Two Electron gaps have to be bridged for it, hence the shim:
 *
 * 1. Its background runs as an MV3 service worker, where the `window` global is absent -
 *    maze-utils' config reads use `window.location.href`.
 * 2. Electron ships `chrome.storage.local` but no usable `chrome.storage.sync`. SponsorBlock's
 *    config layer calls `sync.get(null, cb)` and watches `sync.onChanged` while waiting for
 *    `Config.isReady()`, so a missing `sync` both throws and leaves the config unready for ever.
 *    `sync` is aliased onto `storage.local` instead of being deleted, so those calls resolve.
 *
 * Nothing here may run at module scope: a plugin's `index.ts` is shared by every bundle, the page
 * included (see the loader's own note).
 */
import type { WebExtensionSpec } from "@/extensions/web-extension";
import { loadInto, unloadFrom } from "@/extensions/web-extension";

const SHIM = `(() => {
  try {
    const g = globalThis;
    if (typeof g.window === "undefined") {
      g.window = g;
    }
    const c = g.chrome;
    const storage = c ? c.storage : null;
    if (!(storage && storage.local) || storage.sync === storage.local) {
      return;
    }
    try {
      Object.defineProperty(storage, "sync", {
        configurable: true,
        get: () => storage.local,
      });
    } catch (error) {
      void error;
    }
  } catch (error) {
    void error;
  }
})();`;

/**
 * `wd1` is the shim version, and part of the installed directory's name on purpose.
 *
 * **The release is pinned on purpose too.** Third-party code runs inside this app's page, and
 * `latest` would hand it whatever upstream published that morning - including a release from a
 * compromised maintainer account, or one that broke the shim. Bumping `pinnedTag` and `sha256` is
 * a code change, reviewed like any other: download the asset from the release page, run
 * `sha256sum` on it, and compare it with the `digest` the GitHub API reports for that asset.
 */
export const sponsorBlockExtension: WebExtensionSpec = {
  assetName: "ChromeExtension.zip",
  installName: "sponsorblock-extension",
  pinnedTag: "6.1.7",
  releaseUrl:
    "https://api.github.com/repos/ajayyy/SponsorBlock/releases/latest",
  sha256: "7c8e3dc8b5e560b480ae8efdf28f4f1101fce0cc32434562a336a89e4962eda3",
  shim: SHIM,
  shimVersion: 1,
  userAgent: "Watchdeck",
};

/** Puts the pinned official release into a session; answers the extension's id, or null. */
export const mountSponsorBlockExtension = async (
  session: Electron.Session,
  userDataDir: string
): Promise<string | null> =>
  await loadInto(session, userDataDir, sponsorBlockExtension);

/** Answers whether it was actually removed, so the caller knows a page reload is due. */
export const unmountSponsorBlockExtension = (
  session: Electron.Session,
  extensionId: string
): boolean => unloadFrom(session, extensionId);
