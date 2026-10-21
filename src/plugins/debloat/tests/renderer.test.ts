/**
 * The plugin lives in the page's DOM, out of reach of the node tests: this runs the real
 * `renderer.ts` against markup shaped like the site's, in a plain browser. What it pins is the
 * contract the owner asked for: the shelves the site marks as Shorts are the ones that go, nothing
 * of the site's is deleted, and disabling the plugin puts the page back.
 */
import path from "node:path";

import { expect, test } from "@playwright/test";
import { build } from "vite";

interface DebloatApi {
  applyConfig: (config: { enabled: boolean; hideShortsShelf: boolean }) => void;
  HIDDEN_CLASS: string;
  start: (config: { enabled: boolean; hideShortsShelf: boolean }) => void;
  stop: () => void;
}

const ON = { enabled: true, hideShortsShelf: true };

/** Bundles the plugin's renderer the way the app does, and hands back its IIFE. */
const bundle = async (entry: string, name: string) => {
  const here = import.meta.dirname;
  const result = await build({
    build: {
      emptyOutDir: false,
      lib: {
        entry: path.join(here, entry),
        fileName: () => `${name}.js`,
        formats: ["iife"],
        name,
      },
      minify: false,
      write: false,
    },
    configFile: false,
    logLevel: "silent",
    resolve: { alias: { "@": path.join(here, "../../..") } },
  });
  const [output] = Array.isArray(result) ? result : [result];
  if (!("output" in output)) {
    throw new Error("expected a build result, not a watcher");
  }
  const chunk = output.output.find((item) => item.type === "chunk");
  if (!chunk?.code) {
    throw new Error("the fixture bundle produced no code");
  }
  return chunk.code;
};

const script = await bundle("../renderer.ts", "__debloat");

/**
 * The subscriptions feed as the live site serves it (measured 2026-10-21): the Shorts shelf is a
 * `ytd-rich-shelf-renderer` with `is-shorts` and `ytm-shorts-lockup-view-model` items, and a normal
 * shelf sits above it.
 */
const FEED = `
  <ytd-rich-shelf-renderer id="videos">
    <ytd-rich-item-renderer></ytd-rich-item-renderer>
  </ytd-rich-shelf-renderer>
  <ytd-rich-shelf-renderer id="shorts" is-shorts>
    <ytm-shorts-lockup-view-model></ytm-shorts-lockup-view-model>
    <ytm-shorts-lockup-view-model></ytm-shorts-lockup-view-model>
  </ytd-rich-shelf-renderer>
  <ytd-rich-shelf-renderer id="unmarked">
    <ytm-shorts-lockup-view-model></ytm-shorts-lockup-view-model>
  </ytd-rich-shelf-renderer>`;

test("the Shorts shelves go, the rest of the feed stays", async ({ page }) => {
  await page.goto("about:blank");
  await page.addScriptTag({ content: script });

  const seen = await page.evaluate(
    ({ config, feed }) => {
      const { __debloat: debloat } = window as unknown as {
        __debloat: DebloatApi;
      };
      document.body.innerHTML = feed;
      debloat.start(config);

      const hidden = (id: string) =>
        document
          .querySelector(`#${id}`)
          ?.classList.contains(debloat.HIDDEN_CLASS);
      const before = {
        shorts: hidden("shorts"),
        unmarked: hidden("unmarked"),
        videos: hidden("videos"),
      };

      // Turning the option off (and then the plugin itself) puts the page back: nothing of the
      // site's was removed, only a class.
      debloat.applyConfig({ ...config, hideShortsShelf: false });
      const afterOption = hidden("shorts");

      debloat.applyConfig(config);
      debloat.stop();
      return {
        afterOption,
        afterStop: document.querySelectorAll(`.${debloat.HIDDEN_CLASS}`).length,
        before,
      };
    },
    { config: ON, feed: FEED }
  );

  // The shelf the site marks as Shorts, and the one that only shows Shorts items, are hidden; a
  // shelf of videos is not touched.
  expect(seen.before).toEqual({
    shorts: true,
    unmarked: true,
    videos: false,
  });
  expect(seen.afterOption).toBe(false);
  expect(seen.afterStop).toBe(0);
});
