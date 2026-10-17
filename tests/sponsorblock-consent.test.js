import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { expect, test, _electron as electron } from "@playwright/test";

/**
 * The consent step in front of SponsorBlock's download (docs/PRD.md §5.1, R2).
 *
 * What this pins is the gate, not the download: with the plugin enabled and no agreement recorded,
 * the app asks before anything is fetched, and declining leaves the plugin off and the disk
 * untouched. The download itself needs the network, so it is not part of the suite.
 *
 * A native message box cannot be clicked from a test harness, so the app's own
 * `dialog.showMessageBox` is replaced inside the main process; everything around the click is the
 * real thing, including the config store and the extension loader.
 */
const appPath = path.resolve(import.meta.dirname, "..");
const installDir = "sponsorblock-extension-wd1";

const launchWith = async (pluginConfig, answer) => {
  // Same reasoning as the smoke test: a scratch `XDG_CONFIG_HOME` is the app's `userData`, so this
  // neither reads nor writes the config, the Watch Later database or an extension install that
  // belongs to whoever runs the tests.
  const configHome = mkdtempSync(path.join(tmpdir(), "watchdeck-consent-"));
  const userData = path.join(configHome, "watchdeck");
  mkdirSync(userData, { recursive: true });
  writeFileSync(
    path.join(userData, "config.json"),
    JSON.stringify({ plugins: { sponsorblock: pluginConfig } })
  );

  const app = await electron.launch({
    args: [appPath, "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    cwd: appPath,
    env: { ...process.env, XDG_CONFIG_HOME: configHome },
  });

  await app.evaluate(({ dialog }, response) => {
    globalThis.__asked = [];
    dialog.showMessageBox = async (...args) => {
      globalThis.__asked.push(args.at(-1));
      return { checkboxChecked: false, response };
    };
  }, answer);

  return { app, userData };
};

const dialogs = (app) => app.evaluate(() => globalThis.__asked);

const storedPluginConfig = (userData) =>
  JSON.parse(readFileSync(path.join(userData, "config.json"), "utf-8")).plugins
    .sponsorblock;

test("SponsorBlock is not downloaded until the user agrees to it", async () => {
  const { app, userData } = await launchWith(
    { consentGiven: false, enabled: true, mode: "extension" },
    2 // "Not now"
  );

  try {
    await expect
      .poll(async () => (await dialogs(app)).length, { timeout: 30_000 })
      .toBe(1);

    const [consent] = await dialogs(app);
    expect(consent.title).toBe("Enable SponsorBlock?");
    expect(consent.buttons).toEqual([
      "Download and enable",
      "Open the release page",
      "Not now",
    ]);
    expect(consent.detail).toContain("releases/tag/6.1.7");

    // Declining switches the plugin off, and nothing reached the disk.
    await expect
      .poll(() => storedPluginConfig(userData).enabled, { timeout: 10_000 })
      .toBe(false);
    expect(existsSync(path.join(userData, installDir))).toBe(false);
    expect(
      await app.evaluate(
        ({ session }) =>
          session.defaultSession.extensions.getAllExtensions().length
      )
    ).toBe(0);
  } finally {
    await app.close();
  }
});
