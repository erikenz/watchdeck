import { createHash } from "node:crypto";
/**
 * The shared loader has to work with and without a network, and both have to end in the same
 * place: the installed copy loaded. Written against a temp directory, never the real userData.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32 } from "node:zlib";

import { expect, test } from "@playwright/test";

import { ensureInstalled, extensionDir, isInstalled } from "../web-extension";
import type { WebExtensionSpec } from "../web-extension";

const spec: WebExtensionSpec = {
  assetName: "ChromeExtension.zip",
  installName: "test-extension",
  releaseUrl: "https://api.github.com/repos/owner/repo/releases/latest",
  shim: "globalThis.__watchdeckTestShim = true;",
  shimVersion: 2,
  userAgent: "WatchdeckTest",
};

const RELEASE = {
  assets: [
    {
      browser_download_url: "https://example.invalid/ChromeExtension.zip",
      name: "ChromeExtension.zip",
    },
  ],
  tag_name: "v9.9.9",
};

const extensionFiles: Record<string, string> = {
  "js/background.js": "console.log('background')",
  "js/content.js": "console.log('content')",
  "manifest.json": JSON.stringify({
    background: { service_worker: "./js/background.js" },
    content_scripts: [{ js: ["./js/content.js"] }],
    manifest_version: 3,
    name: "Test extension",
    version: "1.0.0",
  }),
};

/** A userData directory holding the extension the way an installed one looks. */
const installCopy = (userDataDir: string, version = "v1.0.0") => {
  const dir = extensionDir(userDataDir, spec);

  for (const [relative, contents] of Object.entries(extensionFiles)) {
    const file = path.join(dir, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }

  writeFileSync(path.join(dir, "version.txt"), version);

  return dir;
};

const userDataDir = () => mkdtempSync(path.join(tmpdir(), "watchdeck-ext-"));

/** No network at all: what `fetch` does when the machine is offline. */
const offline = () => {
  const original = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = () => {
    calls += 1;
    return Promise.reject(new Error("offline"));
  };

  return {
    calls: () => calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
};

test("the install directory carries the shim version", () => {
  expect(path.basename(extensionDir("/tmp", spec))).toBe("test-extension-wd2");
  expect(
    path.basename(extensionDir("/tmp", { ...spec, shimVersion: undefined }))
  ).toBe("test-extension-wd1");
});

test("offline, an installed copy is used and left in place", async () => {
  const dir = userDataDir();
  const installed = installCopy(dir, "v1.0.0");
  const network = offline();

  try {
    await expect(ensureInstalled(dir, spec)).resolves.toEqual({ ok: true });
    expect(network.calls()).toBeGreaterThan(0);
    expect(readFileSync(path.join(installed, "version.txt"), "utf-8")).toBe(
      "v1.0.0"
    );
  } finally {
    network.restore();
  }
});

test("offline with nothing installed installs nothing and says so", async () => {
  const dir = userDataDir();
  const network = offline();

  try {
    await expect(ensureInstalled(dir, spec)).resolves.toEqual({
      failure: "download",
      ok: false,
    });
    expect(isInstalled(extensionDir(dir, spec))).toBe(false);
  } finally {
    network.restore();
  }
});

test("an installed copy of the pinned version is patched, once, without the network", async () => {
  const dir = userDataDir();
  // The copy on disk *is* the pinned release, so there is nothing to check up on.
  const installed = installCopy(dir, "v2.0.0");
  const pinned = { ...spec, pinnedTag: "v2.0.0" };
  const network = offline();

  try {
    await ensureInstalled(dir, pinned);
    // The pinned version is already installed: the network is not even asked
    expect(network.calls()).toBe(0);

    for (const source of [
      readFileSync(path.join(installed, "js/background.js"), "utf-8"),
      readFileSync(path.join(installed, "js/content.js"), "utf-8"),
    ]) {
      expect(source.startsWith("/* WATCHDECK_SHIM_START v2 */")).toBe(true);
      expect(source).toContain(spec.shim);
      expect(source).toContain("WATCHDECK_SHIM_END */");
    }

    await ensureInstalled(dir, pinned);

    // A second pass must not stack a second shim - the script would declare it twice
    for (const file of ["js/background.js", "js/content.js"]) {
      const source = readFileSync(path.join(installed, file), "utf-8");
      expect(source.split("WATCHDECK_SHIM_START")).toHaveLength(2);
    }
  } finally {
    network.restore();
  }
});

test("an install left by an older shim version is removed", async () => {
  const dir = userDataDir();
  const stale = path.join(dir, "test-extension-wd1");
  const namedLegacy = path.join(dir, "old-extension-name");
  for (const gone of [stale, namedLegacy]) {
    mkdirSync(gone, { recursive: true });
    writeFileSync(path.join(gone, "manifest.json"), "{}");
  }
  installCopy(dir);
  const network = offline();

  try {
    await ensureInstalled(dir, {
      ...spec,
      legacyNames: ["old-extension-name"],
    });
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(namedLegacy)).toBe(false);
    expect(isInstalled(extensionDir(dir, spec))).toBe(true);
  } finally {
    network.restore();
  }
});

test("a published release is downloaded when the versions differ", async () => {
  const dir = userDataDir();
  installCopy(dir, "v1.0.0");
  const original = globalThis.fetch;
  const zip = zipStore({ "manifest.json": '{"name":"Test extension"}' });

  globalThis.fetch = ((url: string) =>
    Promise.resolve(
      String(url).includes("api.github.com")
        ? Response.json(RELEASE)
        : new Response(new Uint8Array(zip), { status: 200 })
    )) as typeof fetch;

  try {
    await expect(ensureInstalled(dir, spec)).resolves.toEqual({ ok: true });
    const installed = extensionDir(dir, spec);
    expect(readFileSync(path.join(installed, "version.txt"), "utf-8")).toBe(
      "v9.9.9"
    );
    expect(
      readFileSync(path.join(installed, "manifest.json"), "utf-8")
    ).toContain("Test extension");
  } finally {
    globalThis.fetch = original;
  }
});

test("a release that does not match the pinned hash is refused", async () => {
  const dir = userDataDir();
  const original = globalThis.fetch;
  const zip = zipStore({ "manifest.json": '{"name":"Test extension"}' });

  globalThis.fetch = ((url: string) =>
    Promise.resolve(
      String(url).includes("api.github.com")
        ? Response.json(RELEASE)
        : new Response(new Uint8Array(zip), { status: 200 })
    )) as typeof fetch;

  try {
    // Nothing is written on a mismatch: not the extension, not the version file.
    const wrongHash = { ...spec, sha256: "0".repeat(64) };
    await expect(ensureInstalled(dir, wrongHash)).resolves.toEqual({
      failure: "hash",
      ok: false,
    });
    expect(isInstalled(extensionDir(dir, spec))).toBe(false);

    // And the same bytes install once the hash is the one the app trusts.
    const rightHash = {
      ...spec,
      sha256: createHash("sha256").update(zip).digest("hex"),
    };
    await expect(ensureInstalled(dir, rightHash)).resolves.toEqual({
      ok: true,
    });
    expect(isInstalled(extensionDir(dir, spec))).toBe(true);
  } finally {
    globalThis.fetch = original;
  }
});

/**
 * A zip holding one stored (uncompressed) file per entry - everything `readZip` reads, written
 * here so the repository does not carry a binary fixture for it.
 */
function zipStore(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const [name, contents] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, "utf-8");
    const data = Buffer.from(contents, "utf-8");
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04_03_4b_50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02_01_4b_50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }

  const centralSize = centrals.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06_05_4b_50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, ...centrals, end]);
}
