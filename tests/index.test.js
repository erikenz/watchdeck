import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { test, expect, _electron as electron } from "@playwright/test";

/**
 * Deliberately *not* `NODE_ENV=test`: that switch turns on `webPreferences.sandbox`, and
 * with it the window never leaves `loading: true` - an empty URL for as long as you watch
 * it, measured here and in CI's shape of the same session - while the configuration the app
 * ships (`sandbox: false`, docs/PRD.md §3.3) loads the site at once. A smoke test that
 * runs a configuration which cannot load a page cannot smoke-test anything.
 */
const appPath = path.resolve(import.meta.dirname, "..");

/**
 * Every launch gets its own config directory. That is `XDG_CONFIG_HOME`: the app sets its own
 * `userData` to `$XDG_CONFIG_HOME/watchdeck` on purpose (`src/app-identity.ts`), so
 * `--user-data-dir` is overridden, while this is the path the identity is derived from.
 *
 * Two reasons, both learned the hard way: the app refuses a second instance while one holds the
 * lock on the real directory, which showed up as a window that never loaded a URL; and a test has
 * no business writing to the config, the Watch Later database or an extension's storage that
 * belongs to whoever runs it.
 */
const launchApp = () =>
  electron.launch({
    args: [
      appPath,
      "--no-sandbox",
      "--disable-gpu",
      "--whitelisted-ips=",
      "--disable-dev-shm-usage",
    ],
    cwd: appPath,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: mkdtempSync(path.join(tmpdir(), "watchdeck-smoke-")),
    },
  });

test("Watchdeck App - launches, with a window titled after the app", async () => {
  const app = await launchApp();

  // Asking the main process is the only reliable way to see the window: the page is
  // attached separately and may never come up in a session without a window manager.
  // The window appears after the plugins load, so poll instead of sampling once.
  const readWindows = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((win) => ({
        title: win.getTitle(),
        url: win.webContents.getURL(),
      }))
    );

  await expect
    .poll(async () => (await readWindows()).length, {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);

  // The site renames every window after its own <title> ("YouTube"); the app has to
  // win that fight or the task bar and window list say "YouTube".
  const [window] = await readWindows();
  expect(window.title).toBe("Watchdeck");

  await app.close();
});

/**
 * The smoke test for the page itself. It asks the main process to run the checks inside
 * the window, because attaching to the page with Playwright needs a session that can
 * hand a renderer to a window (a desktop, or xvfb in CI) - `firstWindow()` never
 * resolves on a bare X display, while `webContents.executeJavaScript` always does.
 *
 * What it catches, in order of how bad it is: the app falling back to its error page, the
 * preload not exposing the bridge, and the injected page bundle not running - the last two
 * mean no playback bridge, no plugins and no hover button.
 */
test("the launched window shows the site, with the app's page half running", async () => {
  const app = await launchApp();

  const inPage = async (source) =>
    await app.evaluate(async ({ BrowserWindow }, code) => {
      const [window] = BrowserWindow.getAllWindows();
      return await window?.webContents.executeJavaScript(String(code));
    }, source);

  const readUrl = async () =>
    (
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((win) => win.webContents.getURL())
      )
    )[0] ?? "";

  await expect
    .poll(readUrl, { timeout: 30_000 })
    .toContain("://www.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com");

  // A consent wall is the one page that is not the site and not a failure
  await inPage(
    "document.querySelector(\"form[action*='consent.'] button\")?.click()"
  );

  await expect
    .poll(
      async () =>
        await inPage(
          '[typeof window.mainConfig, typeof customElements.get("wd-trans")].join(",")'
        ),
      { timeout: 30_000 }
    )
    .toBe("object,function");

  await app.close();
});
