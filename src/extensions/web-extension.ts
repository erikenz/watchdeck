/**
 * Loading a published web extension into one of the app's sessions (docs/PRD.md §5.1).
 *
 * Nothing of an extension's code is bundled with the app: its release is fetched at runtime into
 * the user's `userData` directory and unpacked there, so it stays a separate program that the
 * user's machine downloads. Electron implements most of the extension API; the gaps an extension
 * actually hits are bridged by whatever shim its spec carries, which is prepended to the scripts
 * its manifest lists.
 *
 * Two rules hold for this file, both paid for by SponsorBlock:
 *
 * 1. Nothing runs at module scope. A plugin's `index.ts` is shared by every bundle the plugin
 *    loader builds - the backend, the preload, and the script injected into the page - and the
 *    transform strips a context, not the module-level code around it.
 * 2. Nothing here imports `electron` (the caller passes the session and the `userData`
 *    directory). `node:*` imports are tree-shaken out of the page bundle; `electron` is not, and
 *    its pre-bundled copy reads `__dirname`, which does not exist in a page - the injected script
 *    died before it defined anything, in dev only, which is the sort of thing that costs a day.
 */
import { createHash } from "node:crypto";
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

const VERSION_FILE = "version.txt";
const DEFAULT_USER_AGENT = "Watchdeck";
const LOG_PREFIX = "[Watchdeck]";

/** What a plugin has to say about the extension it wants loaded. */
export interface WebExtensionSpec {
  /** Directory under `userData` holding the unpacked release; part of the extension's identity. */
  installName: string;
  /** Directory names earlier versions used, which nothing loads any more. */
  legacyNames?: string[];
  /** The GitHub release API endpoint for the extension's releases. */
  releaseUrl: string;
  /**
   * The release tag this app trusts, instead of "whatever is latest". Third-party code runs inside
   * the app, and a release published later - by a compromised maintainer account, or one that
   * simply broke something - would otherwise arrive on its own. Bumping this (and the hash) is a
   * code change, reviewed like any other.
   */
  pinnedTag?: string;
  /** SHA-256 of the release asset, hex. A download that does not match is refused. */
  sha256?: string;
  /** The asset inside a release holding the browser build. */
  assetName: string;
  /** Prepended to every script the manifest lists. Its markers are added for you. */
  shim?: string;
  /**
   * Part of the install directory's name on purpose. Electron derives an unpacked extension's id
   * from its path and Chromium caches the service-worker script against that id, so a new
   * directory name is the only reliable way to get a re-patched script loaded instead of a
   * cached copy. Bump it with every change to `shim`.
   */
  shimVersion?: number;
  userAgent?: string;
}

/** A manifest as far as script patching needs to read one. */
interface ExtensionManifest {
  background?: { scripts?: string[]; service_worker?: string };
  content_scripts?: { js?: string[] }[];
}

const SHIM_END = "/* WATCHDECK_SHIM_END */";
const SHIM_START_PATTERN = /\/\* WATCHDECK_SHIM_START v\d+ \*\//u;

const markedShim = (spec: WebExtensionSpec): string | null =>
  spec.shim
    ? `/* WATCHDECK_SHIM_START v${spec.shimVersion ?? 1} */\n${spec.shim}\n${SHIM_END}`
    : null;

/** Where the unpacked release lives. */
export const extensionDir = (
  userDataDir: string,
  spec: WebExtensionSpec
): string =>
  path.join(userDataDir, `${spec.installName}-wd${spec.shimVersion ?? 1}`);

export const isInstalled = (dir: string): boolean =>
  existsSync(path.join(dir, "manifest.json"));

const readInstalledVersion = (dir: string): string | null => {
  try {
    return readFileSync(path.join(dir, VERSION_FILE), "utf-8").trim();
  } catch {
    return null;
  }
};

const fetchRelease = async (
  spec: WebExtensionSpec
): Promise<{ digest?: string; url: string; version: string } | null> => {
  try {
    const endpoint = spec.pinnedTag
      ? `${spec.releaseUrl.replace(/\/latest$/u, "")}/tags/${spec.pinnedTag}`
      : spec.releaseUrl;
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": spec.userAgent ?? DEFAULT_USER_AGENT,
      },
    });

    if (!response.ok) {
      return null;
    }

    const parsed = z
      .object({
        assets: z.array(
          z.object({
            browser_download_url: z.string(),
            digest: z.string().nullish(),
            name: z.string(),
          })
        ),
        tag_name: z.string(),
      })
      .safeParse(await response.json());

    if (!parsed.success) {
      return null;
    }

    const asset = parsed.data.assets.find(
      (item) => item.name === spec.assetName
    );

    return asset
      ? {
          digest: asset.digest ?? undefined,
          url: asset.browser_download_url,
          version: parsed.data.tag_name,
        }
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
  spec: WebExtensionSpec,
  release: { digest?: string; url: string; version: string }
): Promise<boolean> => {
  try {
    const response = await fetch(release.url, {
      headers: { "User-Agent": spec.userAgent ?? DEFAULT_USER_AGENT },
    });

    if (!response.ok) {
      return false;
    }

    const bytes = new Uint8Array(await response.arrayBuffer());

    if (!verifyAsset(bytes, spec, release.digest)) {
      return false;
    }

    const files = readZip(bytes);
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

    writeFileSync(path.join(root, VERSION_FILE), release.version, "utf-8");

    return isInstalled(root);
  } catch {
    return false;
  }
};

/**
 * The bytes are the extension's code, and nothing else checks them: refuse anything whose SHA-256
 * is not the one the app ships with, and refuse it before a single file is written. GitHub's own
 * `digest` field is compared too when the API offers one - it is computed on their side, so a
 * disagreement means the bytes changed in transit.
 */
const verifyAsset = (
  bytes: Uint8Array,
  spec: WebExtensionSpec,
  digest?: string
): boolean => {
  const expected = spec.sha256?.toLowerCase();

  if (!expected) {
    return true;
  }

  const actual = createHash("sha256").update(bytes).digest("hex");

  if (actual !== expected) {
    console.error(
      `${LOG_PREFIX} the ${spec.installName} release does not match the hash this app trusts ` +
        `(expected ${expected}, got ${actual}); refusing to install it`
    );
    return false;
  }

  if (digest && digest.toLowerCase() !== `sha256:${expected}`) {
    console.error(
      `${LOG_PREFIX} the release API reports a different hash than this app trusts ` +
        `(${digest}); refusing to install it`
    );
    return false;
  }

  return true;
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

const patchScript = (dir: string, spec: WebExtensionSpec, relative: string) => {
  const shim = markedShim(spec);

  if (!shim) {
    return;
  }

  try {
    const file = path.join(dir, relative);
    const source = readFileSync(file, "utf-8");

    if (SHIM_START_PATTERN.test(source)) {
      return;
    }

    writeFileSync(file, `${shim}\n${stripShim(source)}`, "utf-8");
  } catch {
    // A script the manifest lists but the release does not ship is not worth failing over
  }
};

const patchInstalledExtension = (dir: string, spec: WebExtensionSpec) => {
  if (!(spec.shim && isInstalled(dir))) {
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
      patchScript(dir, spec, relative);
    }
  } catch {
    // A broken manifest is a broken install; `ensureInstalled` re-downloads it
  }
};

/** Installs left by an earlier shim version, which nothing will load any more. */
const removeStaleInstalls = (userDataDir: string, spec: WebExtensionSpec) => {
  const current = path.basename(extensionDir(userDataDir, spec));
  const named = (name: string) =>
    name === spec.installName || name.startsWith(`${spec.installName}-wd`);

  try {
    for (const name of readdirSync(userDataDir)) {
      const isOurs =
        named(name) ||
        (spec.legacyNames ?? []).some((legacy) => legacy === name);

      if (isOurs && name !== current) {
        rmSync(path.join(userDataDir, name), { force: true, recursive: true });
      }
    }
  } catch {
    // Best effort: an old directory is not worth failing a plugin over
  }
};

/**
 * Makes sure a usable extension is on disk and patched, without needing the network when one is
 * already there - a cold start offline has to keep working (docs/PRD.md §5.1).
 *
 * With a pinned tag there is nothing to check up on: the copy on disk is either the pinned version
 * or it is replaced by it, and a newer release upstream changes nothing until the pin moves.
 */
export const ensureInstalled = async (
  userDataDir: string,
  spec: WebExtensionSpec
): Promise<boolean> => {
  removeStaleInstalls(userDataDir, spec);

  const dir = extensionDir(userDataDir, spec);
  const installed = isInstalled(dir);

  if (
    installed &&
    spec.pinnedTag &&
    readInstalledVersion(dir) === spec.pinnedTag
  ) {
    patchInstalledExtension(dir, spec);
    return true;
  }

  const release = await fetchRelease(spec);

  if (!release) {
    // No network, or GitHub is having a day: an installed copy still works
    patchInstalledExtension(dir, spec);
    return installed;
  }

  if (installed && readInstalledVersion(dir) === release.version) {
    patchInstalledExtension(dir, spec);
    return true;
  }

  const extracted = await downloadAndExtract(dir, spec, release);
  patchInstalledExtension(dir, spec);

  return extracted;
};

/** Puts the extension into a session, downloading it first when it is not there yet. */
export const loadInto = async (
  session: Electron.Session,
  userDataDir: string,
  spec: WebExtensionSpec
): Promise<string | null> => {
  const available = await ensureInstalled(userDataDir, spec);

  if (!available) {
    return null;
  }

  try {
    const extension = await session.extensions.loadExtension(
      extensionDir(userDataDir, spec),
      // No `allowFileAccess`: the extension is third-party code the app downloaded, and
      // `file://` access would hand it the user's disk. Nothing it does needs that - its own
      // resources are served from `chrome-extension://`.
      { allowFileAccess: false }
    );

    return extension.id;
  } catch {
    return null;
  }
};

/** Answers whether something was actually loaded, so the caller knows a reload is due. */
export const unloadFrom = (
  session: Electron.Session,
  extensionId: string
): boolean => {
  try {
    session.extensions.removeExtension(extensionId);
    return true;
  } catch {
    return false;
  }
};
