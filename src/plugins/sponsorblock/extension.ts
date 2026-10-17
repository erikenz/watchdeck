/**
 * SponsorBlock as the official Chrome release (docs/PRD.md §5.1, P3).
 *
 * Nothing of SponsorBlock's GPL-3.0 code is bundled with the app: its release is fetched at
 * runtime into the user's `userData` directory and unpacked there, so it stays a separate
 * program that the user's machine downloads. Electron implements most of the extension API;
 * the gaps SponsorBlock actually needs are bridged by the shim below, which is prepended to
 * the scripts its manifest lists.
 *
 * Nothing here may run at module scope. The plugin loader strips the backend out of the bundles
 * a page gets, but module-level code stays in all of them, and the page has no `require` - which
 * is exactly how a schema built at the top of this file took the whole injected script down.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { z } from "zod";

import { readZip } from "./unzip";

const RELEASES_URL =
  "https://api.github.com/repos/ajayyy/SponsorBlock/releases/latest";
const CHROME_ASSET_NAME = "ChromeExtension.zip";
const VERSION_FILE = "version.txt";
const USER_AGENT = "Watchdeck";

/**
 * Bump this when the shim changes - it is part of the directory name on purpose.
 *
 * Electron derives an unpacked extension's id from its path, and Chromium caches the
 * service-worker script against that id. A new directory name means a new id, which is the
 * only reliable way to get the freshly patched script loaded instead of a cached copy.
 */
const SHIM_VERSION = 1;
const EXTENSION_DIR_NAME = `sponsorblock-extension-wd${SHIM_VERSION}`;
const LEGACY_DIR_NAME = "sponsorblock-extension";

const SHIM_START = `/* WATCHDECK_SHIM_START v${SHIM_VERSION} */`;
const SHIM_END = "/* WATCHDECK_SHIM_END */";
const SHIM_START_PATTERN = /\/\* WATCHDECK_SHIM_START v\d+ \*\//u;

/** What the two schemas below describe. A type, so nothing is built at module scope. */
interface ExtensionManifest {
  background?: { scripts?: string[]; service_worker?: string };
  content_scripts?: { js?: string[] }[];
}

/**
 * Prepended to SponsorBlock's own scripts, bridging the two gaps it hits in Electron:
 *
 * 1. Its background runs as an MV3 service worker, where the `window` global is absent -
 *    maze-utils' config reads use `window.location.href`.
 * 2. Electron ships `chrome.storage.local` but no usable `chrome.storage.sync`. SponsorBlock's
 *    config layer calls `sync.get(null, cb)` and watches `sync.onChanged` while waiting for
 *    `Config.isReady()`, so a missing `sync` both throws and leaves the config unready for
 *    ever. `sync` is aliased onto `storage.local` instead of being deleted, so those calls
 *    resolve.
 */
const COMPAT_SHIM = `${SHIM_START}
(() => {
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
})();
${SHIM_END}`;

/** Where the unpacked release lives. */
export const getExtensionDir = (userDataDir: string): string =>
  path.join(userDataDir, EXTENSION_DIR_NAME);

export const isExtensionInstalled = (dir: string): boolean =>
  existsSync(path.join(dir, "manifest.json"));

const readInstalledVersion = (dir: string): string | null => {
  try {
    return readFileSync(path.join(dir, VERSION_FILE), "utf-8").trim();
  } catch {
    return null;
  }
};

const fetchLatestRelease = async (): Promise<{
  url: string;
  version: string;
} | null> => {
  try {
    const response = await fetch(RELEASES_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": USER_AGENT,
      },
    });

    if (!response.ok) {
      return null;
    }

    const parsed = z
      .object({
        assets: z.array(
          z.object({ browser_download_url: z.string(), name: z.string() })
        ),
        tag_name: z.string(),
      })
      .safeParse(await response.json());

    if (!parsed.success) {
      return null;
    }

    const asset = parsed.data.assets.find(
      (item) => item.name === CHROME_ASSET_NAME
    );

    return asset
      ? { url: asset.browser_download_url, version: parsed.data.tag_name }
      : null;
  } catch {
    return null;
  }
};

/** Removes a shim of ours from a script, so a re-patch cannot stack two of them. */
const stripShim = (source: string): string => {
  const start = source.search(SHIM_START_PATTERN);

  if (start === -1) {
    return source;
  }

  const end = source.indexOf(SHIM_END, start);

  if (end === -1) {
    return source;
  }

  return source.slice(end + SHIM_END.length).replace(/^\r?\n/u, "");
};

const downloadAndExtract = async (
  dir: string,
  url: string,
  version: string
): Promise<boolean> => {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });

    if (!response.ok) {
      return false;
    }

    const files = readZip(new Uint8Array(await response.arrayBuffer()));
    const root = path.resolve(dir);
    rmSync(root, { force: true, recursive: true });
    mkdirSync(root, { recursive: true });

    for (const { data, name } of files) {
      const target = path.resolve(root, name);

      // Zip-slip guard: only write what lands inside the extension directory
      if (target.startsWith(`${root}${path.sep}`)) {
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, data);
      }
    }

    writeFileSync(path.join(root, VERSION_FILE), version, "utf-8");

    return isExtensionInstalled(root);
  } catch {
    return false;
  }
};

/** The scripts the manifest loads, which are the ones that need the shim. */
const scriptsOfManifest = (manifest: ExtensionManifest) => {
  const files = new Set<string>();
  const background =
    manifest.background?.service_worker ?? manifest.background?.scripts?.[0];

  if (background) {
    files.add(background);
  }

  for (const contentScript of manifest.content_scripts ?? []) {
    for (const script of contentScript.js ?? []) {
      files.add(script);
    }
  }

  return [...files];
};

const patchScript = (dir: string, relative: string): boolean => {
  try {
    const file = path.join(dir, relative);
    const source = readFileSync(file, "utf-8");

    if (SHIM_START_PATTERN.test(source)) {
      return false;
    }

    writeFileSync(file, `${COMPAT_SHIM}${stripShim(source)}`, "utf-8");

    return true;
  } catch {
    return false;
  }
};

const patchInstalledExtension = (dir: string) => {
  if (!isExtensionInstalled(dir)) {
    return;
  }

  try {
    const manifest = z
      .object({
        background: z
          .object({
            scripts: z.array(z.string()).optional(),
            service_worker: z.string().optional(),
          })
          .optional(),
        content_scripts: z
          .array(z.object({ js: z.array(z.string()).optional() }))
          .optional(),
      })
      .safeParse(
        JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf-8"))
      );

    if (!manifest.success) {
      return;
    }

    for (const relative of scriptsOfManifest(manifest.data)) {
      patchScript(dir, relative);
    }
  } catch {
    // A broken manifest is a broken install; `ensureExtension` re-downloads it
  }
};

/** Installs left by an earlier shim version, which nothing will load any more. */
const removeStaleInstalls = (userDataDir: string) => {
  try {
    for (const name of readdirSync(userDataDir)) {
      const isOurs =
        name === LEGACY_DIR_NAME || name.startsWith(`${LEGACY_DIR_NAME}-wd`);

      if (isOurs && name !== EXTENSION_DIR_NAME) {
        rmSync(path.join(userDataDir, name), { force: true, recursive: true });
      }
    }
  } catch {
    // Best effort: an old directory is not worth failing the plugin over
  }
};

/**
 * Makes sure a usable extension is on disk and patched, without needing the network when one
 * is already there - a cold start offline has to keep working (docs/PRD.md §5.1).
 */
export const ensureExtension = async (
  userDataDir: string,
  options: { autoUpdate: boolean }
): Promise<boolean> => {
  removeStaleInstalls(userDataDir);

  const dir = getExtensionDir(userDataDir);
  const installed = isExtensionInstalled(dir);

  if (installed && !options.autoUpdate) {
    patchInstalledExtension(dir);
    return true;
  }

  const latest = await fetchLatestRelease();

  if (!latest) {
    // No network, or GitHub is having a day: an installed copy still works
    patchInstalledExtension(dir);
    return installed;
  }

  if (installed && readInstalledVersion(dir) === latest.version) {
    patchInstalledExtension(dir);
    return true;
  }

  const extracted = await downloadAndExtract(dir, latest.url, latest.version);
  patchInstalledExtension(dir);

  return extracted;
};
