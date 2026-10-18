import fs, { promises } from "node:fs";
import path from "node:path";

import { ElectronBlocker } from "@ghostery/adblocker-electron";
import { app, net } from "electron";
import * as z from "zod";

let blocker: ElectronBlocker | undefined;

const LOG_PREFIX = "[Watchdeck]";

const TbSourcesSchema = z.object({
  tb: z.array(z.string()),
});

export const loadTrackerBlockerEngine = async (
  session?: Electron.Session,
  cache: boolean = true,
  additionalBlockLists: string[] = [],
  disableDefaultLists: boolean | unknown[] = false
) => {
  // Only use cache if no additional blocklists are passed
  const cacheDirectory = path.join(app.getPath("userData"), "tb_cache");
  if (!fs.existsSync(cacheDirectory)) {
    fs.mkdirSync(cacheDirectory);
  }
  const cachingOptions =
    cache && additionalBlockLists.length === 0
      ? {
          path: path.join(cacheDirectory, "tb-engine.bin"),
          read: promises.readFile,
          write: promises.writeFile,
        }
      : undefined;
  const tbSources = TbSourcesSchema.safeParse(
    await (
      await net.fetch(
        "https://raw.githubusercontent.com/organization/tb-list/refs/heads/main/tb.json"
      )
    ).json()
  );
  const lists = [
    ...((disableDefaultLists && !Array.isArray(disableDefaultLists)) ||
    (Array.isArray(disableDefaultLists) && disableDefaultLists.length > 0)
      ? []
      : tbSources.success
        ? tbSources.data.tb
        : []),
    ...additionalBlockLists,
  ];

  // Nothing about this plugin was observable: it loaded lists from a fixed URL, built an engine and
  // said nothing, so "it does not seem to block anything" could mean an empty list set, an engine
  // that never saw the request, or a request nothing matched. These lines answer that.
  if (!tbSources.success) {
    console.error(
      `${LOG_PREFIX} do-not-track: the default blocklist index could not be read`
    );
  }
  console.log(
    `${LOG_PREFIX} do-not-track: loading ${lists.length} blocklist(s)`
  );

  try {
    blocker = await ElectronBlocker.fromLists(
      async (url: string) => net.fetch(url),
      lists,
      {
        enableCompression: true,
        // When generating the engine for caching, do not load network filters
        // So that enhancing the session works as expected
        // Allowing to define multiple webRequest listeners
        loadNetworkFilters: session !== undefined,
      },
      cachingOptions
    );
    if (session) {
      // Scriptlets (`##+js(...)` in the filter lists) are third-party JavaScript, injected into the
      // page by this library. Measured on youtube.com: one of them recurses - three
      // `RangeError: Maximum call stack size exceeded` per page load, an `apply` trap inside uBO's
      // `proxyApplyFn` helper - and there is no engine flag that turns them off
      // (`loadPreprocessors` gates `#if` directives, not scriptlets; the Electron wrapper asks for
      // injection rules on every first cosmetic pass). So the request is answered without them.
      // What is left is what this app actually wants: requests blocked, and CSS hiding, neither of
      // which runs code from a third-party list inside the page.
      const cosmetics = blocker.getCosmeticsFilters.bind(blocker);
      blocker.getCosmeticsFilters = (options) =>
        cosmetics({ ...options, getInjectionRules: false });

      blocker.enableBlockingInSession(session);
    }
    console.log(
      `${LOG_PREFIX} do-not-track: engine ready, blocking ${
        session && blocker.isBlockingEnabled(session) ? "on" : "off"
      }`
    );

    // The first few blocks, with the host, so a run can be checked without a debugger attached.
    let seen = 0;
    blocker.on("request-blocked", (request) => {
      seen += 1;
      if (seen <= 3) {
        console.log(
          `${LOG_PREFIX} do-not-track: blocked ${request.url.slice(0, 90)}`
        );
      }
    });
  } catch (error) {
    console.error("Error loading blocker engine", error);
  }
};

export const unloadTrackerBlockerEngine = (session: Electron.Session) => {
  if (blocker) {
    blocker.disableBlockingInSession(session);
  }
};

export const isBlockerEnabled = (session: Electron.Session) =>
  blocker !== undefined && blocker.isBlockingEnabled(session);
