/**
 * `ensureExtension` has to work with and without a network, and the two have to end in the same
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

import {
  ensureExtension,
  getExtensionDir,
  isExtensionInstalled,
} from "../extension";

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
    name: "SponsorBlock",
    version: "1.0.0",
  }),
};

/** A userData directory holding the extension the way an installed one looks. */
const installCopy = (userDataDir: string, version = "v1.0.0") => {
  const dir = getExtensionDir(userDataDir);

  for (const [relative, contents] of Object.entries(extensionFiles)) {
    const file = path.join(dir, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }

  writeFileSync(path.join(dir, "version.txt"), version);

  return dir;
};

const userDataDir = () => mkdtempSync(path.join(tmpdir(), "watchdeck-sb-"));

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

test("offline, an installed copy is used and left in place", async () => {
  const dir = userDataDir();
  const extensionDir = installCopy(dir, "v1.0.0");
  const network = offline();

  try {
    await expect(ensureExtension(dir, { autoUpdate: true })).resolves.toBe(
      true
    );
    expect(network.calls()).toBeGreaterThan(0);
    expect(readFileSync(path.join(extensionDir, "version.txt"), "utf-8")).toBe(
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
    await expect(ensureExtension(dir, { autoUpdate: true })).resolves.toBe(
      false
    );
    expect(isExtensionInstalled(getExtensionDir(dir))).toBe(false);
  } finally {
    network.restore();
  }
});

test("an installed copy is patched, once, without the network", async () => {
  const dir = userDataDir();
  const extensionDir = installCopy(dir);
  const network = offline();

  try {
    await ensureExtension(dir, { autoUpdate: false });
    // autoUpdate off: the release check is not even attempted
    expect(network.calls()).toBe(0);

    const patched = [
      readFileSync(path.join(extensionDir, "js/background.js"), "utf-8"),
      readFileSync(path.join(extensionDir, "js/content.js"), "utf-8"),
    ];

    for (const source of patched) {
      expect(source.startsWith("/* WATCHDECK_SHIM_START")).toBe(true);
      expect(source).toContain("WATCHDECK_SHIM_END */");
    }

    await ensureExtension(dir, { autoUpdate: false });

    // A second pass must not stack a second shim - the scripts would declare it twice
    for (const file of ["js/background.js", "js/content.js"]) {
      const source = readFileSync(path.join(extensionDir, file), "utf-8");
      expect(source.split("WATCHDECK_SHIM_START")).toHaveLength(2);
    }
  } finally {
    network.restore();
  }
});

test("a copy left by an older shim version is removed", async () => {
  const dir = userDataDir();
  const stale = path.join(dir, "sponsorblock-extension");
  mkdirSync(stale, { recursive: true });
  writeFileSync(path.join(stale, "manifest.json"), "{}");
  installCopy(dir);
  const network = offline();

  try {
    await ensureExtension(dir, { autoUpdate: false });
    expect(existsSync(stale)).toBe(false);
    expect(isExtensionInstalled(getExtensionDir(dir))).toBe(true);
  } finally {
    network.restore();
  }
});

test("a published release is downloaded when the versions differ", async () => {
  const dir = userDataDir();
  installCopy(dir, "v1.0.0");
  const original = globalThis.fetch;
  const zip = zipStore({ "manifest.json": '{"name":"SponsorBlock"}' });

  globalThis.fetch = ((url: string) =>
    Promise.resolve(
      String(url).includes("api.github.com")
        ? Response.json(RELEASE)
        : new Response(new Uint8Array(zip), { status: 200 })
    )) as typeof fetch;

  try {
    await expect(ensureExtension(dir, { autoUpdate: true })).resolves.toBe(
      true
    );
    expect(
      readFileSync(path.join(getExtensionDir(dir), "version.txt"), "utf-8")
    ).toBe("v9.9.9");
    expect(
      readFileSync(path.join(getExtensionDir(dir), "manifest.json"), "utf-8")
    ).toContain("SponsorBlock");
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
