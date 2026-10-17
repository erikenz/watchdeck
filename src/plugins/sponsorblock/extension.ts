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

/** `wd1` is the shim version, and part of the installed directory's name on purpose. */
export const sponsorBlockExtension: WebExtensionSpec = {
  assetName: "ChromeExtension.zip",
  installName: "sponsorblock-extension",
  releaseUrl:
    "https://api.github.com/repos/ajayyy/SponsorBlock/releases/latest",
  shim: SHIM,
  shimVersion: 1,
  userAgent: "Watchdeck",
};

/** Puts the official release into a session; answers the extension's id, or null. */
export const mountSponsorBlockExtension = async (
  session: Electron.Session,
  userDataDir: string,
  options: { autoUpdate: boolean }
): Promise<string | null> =>
  await loadInto(session, userDataDir, sponsorBlockExtension, options);

/** Answers whether it was actually removed, so the caller knows a page reload is due. */
export const unmountSponsorBlockExtension = (
  session: Electron.Session,
  extensionId: string
): boolean => unloadFrom(session, extensionId);
