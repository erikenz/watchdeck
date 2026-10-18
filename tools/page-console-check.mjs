/**
 * The page's console, on demand (docs/PRD.md §R5, `do-not-track`).
 *
 * Launches the built app with a scratch config, records what the page's console says and every
 * script the app injects into it, and reports a verdict:
 *
 *   RED   the page logged `Maximum call stack size exceeded` n times
 *   GREEN it did not
 *
 * Written to diagnose one bug and kept because that bug is easy to reintroduce: the filter lists
 * `do-not-track` loads ship **scriptlets** - third-party JavaScript, injected into the page by
 * `@ghostery/adblocker-electron` - and one of them recursed in uBO's `proxyApplyFn` helper, three
 * `RangeError`s per page load. `src/plugins/do-not-track/blocker.ts` answers those requests without
 * the scriptlets; this tool is how that is checked, and how it would be caught again.
 *
 *   WD_PLUGINS='{"do-not-track":{"enabled":true,"blocker":"With blocklists"}}' \\
 *     node tools/page-console-check.mjs
 *
 * It needs the network (the blocklists are fetched and cached in the scratch userData) and about
 * ninety seconds, which is why it is not part of `pnpm test`. Two environment facts it depends on,
 * both in TODO.md: the page only runs when its window renders, so the GPU must be left on
 * (`WD_FLAGS` overrides the flags, and `--disable-gpu` makes this loop green for the wrong
 * reason), and the app refuses to start while another instance holds the single-instance lock.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import process from "node:process";

import { _electron as electron } from "@playwright/test";

/**
 * @typedef {import("@playwright/test").ElectronApplication} ElectronApp
 * @typedef {{ level: string, message: string }} ConsoleEntry
 */

const appPath = process.cwd();
const configHome = "/tmp/wd-recursion";
/** @type {Record<string, unknown>} */
const pluginConfig = /** @type {Record<string, unknown>} */ (
  JSON.parse(process.env.WD_PLUGINS ?? "{}")
);

/** Records the full stack of every uncaught error, which the console message truncates. */
const WATCH_SCRIPT = `(() => {
  if (window.__stackWatch) return;
  window.__stackWatch = [];
  window.addEventListener("error", (event) => {
    window.__stackWatch.push(String((event.error && event.error.stack) || event.message));
  });
})()`;

if (!process.env.WD_KEEP_CONFIG) {
  rmSync(configHome, { force: true, recursive: true });
}

mkdirSync(`${configHome}/watchdeck`, { recursive: true });
writeFileSync(
  `${configHome}/watchdeck/config.json`,
  JSON.stringify({ plugins: pluginConfig })
);

const app = await electron.launch({
  args: [
    appPath,
    ...(
      process.env.WD_FLAGS ??
      "--no-sandbox --disable-gpu --disable-dev-shm-usage"
    ).split(" "),
  ],
  cwd: appPath,
  env: { ...process.env, XDG_CONFIG_HOME: configHome },
});

const lines = /** @type {string[]} */ ([]);
app.process().stdout?.on("data", (chunk) => lines.push(String(chunk)));
app.process().stderr?.on("data", (chunk) => lines.push(String(chunk)));

await app.evaluate(({ app: electronApp, BrowserWindow }) => {
  globalThis.__console = [];
  globalThis.__scripts = [];

  // Every script injected into a page, which is where the recursion happened: the adblocker
  // injects its scriptlets with `event.sender.executeJavaScript(script, true)`, so recording them
  // here names the rule that recurses. Patched per instance - at this point the window does not
  // exist yet, and an own property on the contents is what `event.sender` resolves to.
  /**
   * @param {import("electron").WebContents} contents The page to watch and patch.
   */
  const patch = (contents) => {
    const entries = /** @type {ConsoleEntry[]} */ (globalThis.__console);
    const injected = /** @type {string[]} */ (globalThis.__scripts);

    contents.on("console-message", (_event, level, message) => {
      entries.push({ level, message });
    });

    // An error listener inside the page, installed as soon as the document is there, so the full
    // stack of whatever recurses is captured as text - the console message truncates it.
    contents.on("dom-ready", () => {
      void contents
        .executeJavaScript(WATCH_SCRIPT)
        .then(() => undefined)
        .catch(() => undefined);
    });

    const original = contents.executeJavaScript.bind(contents);

    contents.executeJavaScript = (source, ...rest) => {
      const text = String(source);
      if (text.length < 20_000 && !text.includes("__stackWatch")) {
        injected.push(text);
      }

      return original(source, ...rest);
    };
  };

  for (const win of BrowserWindow.getAllWindows()) {
    patch(win.webContents);
  }

  electronApp.on("web-contents-created", (_event, contents) => patch(contents));
});

/** What the page's console has said. */
const readConsole = () =>
  app.evaluate(() => /** @type {ConsoleEntry[]} */ (globalThis.__console));

/** Every script the app has injected into the page. */
const readScripts = () =>
  app.evaluate(() => /** @type {string[]} */ (globalThis.__scripts));

/**
 * Runs JavaScript in the app's page.
 *
 * @param {string} code The source to evaluate.
 * @returns {Promise<string>} What it answered.
 */
const inPage = (code) =>
  app.evaluate(({ BrowserWindow }, source) => {
    const [win] = BrowserWindow.getAllWindows();
    return win?.webContents.executeJavaScript(String(source));
  }, code);

/**
 * Waits for a condition, and answers whether it ever held.
 *
 * @param {string} what Description for the report.
 * @param {() => Promise<boolean>} check Condition to poll.
 * @param {number} timeout How long to wait, in ms.
 * @returns {Promise<boolean>} Whether the condition held.
 */
const waitFor = async (what, check, timeout = 60_000) => {
  const started = Date.now();
  for (;;) {
    if (await check()) return true;
    if (Date.now() - started > timeout) return false;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

/**
 * Waits for the app's window to have YouTube loaded.
 *
 * @param {string} what Description for the report.
 * @param {number} timeout How long to wait, in ms.
 * @returns {Promise<{ loading: boolean, url: string }>} The state it settled on.
 */
const waitForLoad = async (what, timeout = 60_000) => {
  const started = Date.now();
  for (;;) {
    const state = await app.evaluate(({ BrowserWindow }) => {
      const [win] = BrowserWindow.getAllWindows();
      return win
        ? {
            loading: win.webContents.isLoading(),
            url: win.webContents.getURL(),
          }
        : null;
    });

    if (state && !state.loading && state.url.includes("youtube.com")) {
      return state;
    }

    if (Date.now() - started > timeout) {
      throw new Error(
        `timed out: ${what} (last state: ${JSON.stringify(state)})`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

try {
  const first = await waitForLoad("the first load");

  // The engine builds once (and is cached in the userData dir afterwards), then injects its
  // scriptlets on each cosmetic pass. There is no cheap "is it blocking" signal from out here -
  // YouTube's blocked telemetry only fires during playback - so this waits for the page to have
  // settled and for at least one injected script to have been seen.
  await waitFor(
    "an injected script",
    async () => (await readScripts()).length > 0,
    60_000
  );
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // The first load is where the owner saw it, so it is counted on its own - a reload does not
  // necessarily reproduce everything a fresh session does.
  const firstLoadMessages = await readConsole();

  /** @param {ConsoleEntry[]} messages How many of these logged the RangeError. */
  const count = (messages) =>
    messages.filter((entry) =>
      entry.message.includes("Maximum call stack size exceeded")
    ).length;

  await app.evaluate(() => {
    globalThis.__console = [];
    globalThis.__scripts = [];
  });
  await inPage("location.reload()");
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const second = await waitForLoad("the reload");
  await new Promise((resolve) => setTimeout(resolve, 8000));

  const messages = await readConsole();
  const errors = messages.filter(
    (entry) =>
      entry.level === "error" || /RangeError|stack size/.test(entry.message)
  );
  const scripts = await readScripts();
  const suspects = scripts
    .map((source) => ({ length: source.length, source }))
    .filter(({ source }) => source.includes("apply"))
    .sort((a, b) => b.length - a.length);

  const onFirstLoad = count(firstLoadMessages);
  const onReload = count(messages);

  // Whether the page is doing anything at all: without frames, YouTube's own rendering path never
  // runs, and that is why a run can come back green for the wrong reason.
  const render = await inPage(
    `(async () => {
      const frames = await new Promise((resolve) => {
        let seen = 0;
        const started = performance.now();
        const tick = () => {
          seen += 1;
          if (performance.now() - started < 1000) requestAnimationFrame(tick);
          else resolve(seen);
        };
        requestAnimationFrame(tick);
      });
      return JSON.stringify({
        frames,
        cards: document.querySelectorAll("ytd-rich-item-renderer").length,
        hasFocus: document.hasFocus(),
      });
    })()`
  );

  console.log(`first load: ${first.url}`);
  console.log(`reload:     ${second.url}`);
  console.log(`render:     ${render}`);
  console.log(
    `\nRangeErrors - first load: ${onFirstLoad}, after a reload: ${onReload}`
  );
  console.log(`VERDICT: ${onFirstLoad + onReload > 0 ? "RED" : "GREEN"}`);

  console.log(`\nconsole errors after the reload (${errors.length}):`);
  for (const entry of errors) {
    console.log(`  [${entry.level}] ${entry.message.slice(0, 140)}`);
  }

  console.log(`\ninjected scripts recorded: ${scripts.length}`);
  for (const { length, source } of suspects.slice(0, 2)) {
    const at = source.indexOf("apply");
    console.log(
      `  len=${length} apply@${at}: ${JSON.stringify(source.slice(Math.max(0, at - 150), at + 250))}`
    );
  }

  const stacks = await inPage("JSON.stringify(window.__stackWatch || [])");
  console.log(`\nfull stacks captured in the page: ${stacks}`);
} catch (error) {
  console.log(
    `\nLOOP FAILED: ${error instanceof Error ? error.message : String(error)}`
  );
} finally {
  await app.close();
}

const appLog = lines.join("");
console.log(`\napp log lines of interest:`);
for (const line of appLog.split("\n")) {
  if (/do-not-track|blocklist|engine|blocked/.test(line)) {
    console.log(`  ${line.trim().slice(0, 160)}`);
  }
}
