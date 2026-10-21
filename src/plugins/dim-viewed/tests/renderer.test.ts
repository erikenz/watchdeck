/**
 * The dimming lives in the page's DOM, out of reach of the node tests: these run the real
 * `renderer.ts` against markup shaped like the site's, in a plain browser - the same fixture shape
 * the watch-later renderer tests use.
 *
 * What they pin is the rule the owner asked for: the site's own percentage is put through the same
 * thresholds the Watch Later plugin buckets its list with (the app's options, stubbed here the way
 * the preload exposes them), and only cards that count as viewed fade.
 */
import path from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { build } from "vite";

interface DimApi {
  applyConfig: (config: { enabled: boolean; opacity: number }) => void;
  start: (config: { enabled: boolean; opacity: number }) => void;
  stop: () => void;
  VIEWED_CLASS: string;
}

const CONFIG = { enabled: true, opacity: 0.45 };

/**
 * One card per case, in the markup the live site serves (measured on the history page): the bar's
 * segment carries the watched percentage as a width. `extra` adds the badge, or a bar with no
 * width at all.
 */
const CARD = (id: string, width: string | null, extra = "") => `
  <ytd-rich-item-renderer id="${id}">
    ${
      width === null
        ? ""
        : `<yt-thumbnail-overlay-progress-bar-view-model class="ytThumbnailOverlayProgressBarHost">
             <div class="ytThumbnailOverlayProgressBarHostWatchedProgressBar">
               <div class="ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment" style="width: ${width}"></div>
             </div>
           </yt-thumbnail-overlay-progress-bar-view-model>`
    }
    ${extra}
  </ytd-rich-item-renderer>`;

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

const script = await bundle("../renderer.ts", "__dim");

const openFixture = async (page: Page) => {
  await page.goto("about:blank");
  await page.addScriptTag({ content: script });
};

test("the site's percentage decides, with the app's thresholds", async ({
  page,
}) => {
  await openFixture(page);

  const seen = await page.evaluate(
    ({ config, cards }) => {
      const { __dim: dim } = window as unknown as { __dim: DimApi };
      // The preload's bridge, as the page sees it: a stored config written before the thresholds
      // existed hands back an `options` object *without* them - measured live as `{}` - so the
      // plugin has to apply the shipped defaults itself. `watch` hands back a way to stop
      // listening.
      (window as unknown as { mainConfig: unknown }).mainConfig = {
        get: (key: string) =>
          key === "options.watched" ? {} : { min: { percent: 5 } },
        watch: () => () => undefined,
      };
      document.body.innerHTML = cards;

      dim.start(config);

      const dimmed = (id: string) =>
        document.querySelector(`#${id}`)?.classList.contains(dim.VIEWED_CLASS);
      return {
        barelyStarted: dimmed("barely"),
        badge: dimmed("badge"),
        fresh: dimmed("fresh"),
        inProgress: dimmed("middle"),
        opacity: document.documentElement.style
          .getPropertyValue("--wd-dv-opacity")
          .trim(),
        unmeasurable: dimmed("nowidth"),
        watched: dimmed("done"),
      };
    },
    {
      cards:
        CARD("done", "95%") +
        CARD("middle", "30%") +
        CARD("barely", "1%") +
        CARD("fresh", null) +
        CARD("nowidth", "") +
        CARD(
          "badge",
          null,
          "<ytd-thumbnail-overlay-playback-status-renderer></ytd-thumbnail-overlay-playback-status-renderer>"
        ),
      config: CONFIG,
    }
  );

  // 95% is watched and 30% is in progress (both above the 5% minimum), 1% is not, a card the site
  // does not mark is not, a bar with no readable width counts as started, and the watched badge
  // counts outright.
  expect(seen).toEqual({
    barelyStarted: false,
    badge: true,
    fresh: false,
    inProgress: true,
    opacity: "0.45",
    unmeasurable: true,
    watched: true,
  });
});

test("a threshold change re-reads the cards, and stop leaves nothing", async ({
  page,
}) => {
  await openFixture(page);

  const seen = await page.evaluate(
    ({ config, cards }) => {
      const { __dim: dim } = window as unknown as { __dim: DimApi };
      const thresholds = {
        inProgress: { max: { percent: 90 }, min: { percent: 5 } },
        watched: { percent: 90 },
      };
      const watchers: (() => void)[] = [];
      (window as unknown as { mainConfig: unknown }).mainConfig = {
        get: (key: string) =>
          key === "options.watched"
            ? thresholds.watched
            : thresholds.inProgress,
        watch: (listener: () => void) => {
          watchers.push(listener);
          return () => watchers.splice(watchers.indexOf(listener), 1);
        },
      };
      document.body.innerHTML = cards;
      dim.start(config);

      const card = document.querySelector("#middle") as Element;
      const before = card.classList.contains(dim.VIEWED_CLASS);

      // The owner raises "continue watching from" to 50% in the Options menu: 30% is not viewed
      // any more, and the answer is re-read without a reload.
      thresholds.inProgress.min.percent = 50;
      for (const watcher of watchers) {
        watcher();
      }
      const after = card.classList.contains(dim.VIEWED_CLASS);

      dim.stop();
      return {
        after,
        afterStop: card.classList.contains(dim.VIEWED_CLASS),
        before,
        listeners: watchers.length,
        variable:
          document.documentElement.style.getPropertyValue("--wd-dv-opacity"),
      };
    },
    { cards: CARD("middle", "30%"), config: CONFIG }
  );

  expect(seen.before).toBe(true);
  expect(seen.after).toBe(false);
  expect(seen.afterStop).toBe(false);
  expect(seen.variable).toBe("");
  // `stop` lets go of the options listener as well, so a disabled plugin is not still waking up.
  expect(seen.listeners).toBe(0);
});
