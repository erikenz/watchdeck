/**
 * The dimming lives in the page's DOM, out of reach of the node tests: these run the real
 * `renderer.ts` against markup shaped like the site's, in a plain browser - the same fixture shape
 * the watch-later renderer tests use. What they pin is the rule: the site's own marks decide which
 * cards fade, a card that loses its mark fades back in, and disabling the plugin leaves nothing.
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

const CONFIG = { enabled: true, opacity: 0.45 };

test("the cards the site marks as viewed fade, and only those", async ({
  page,
}) => {
  await openFixture(page);

  const seen = await page.evaluate((config) => {
    const { __dim: dim } = window as unknown as { __dim: DimApi };
    document.body.innerHTML = `
      <ytd-rich-item-renderer id="watched">
        <ytw-thumbnail-overlay-resume-playback-renderer>
          <div class="ytThumbnailOverlayResumePlaybackRendererThumbnailOverlayResumePlaybackProgress" style="width: 42%"></div>
        </ytw-thumbnail-overlay-resume-playback-renderer>
      </ytd-rich-item-renderer>
      <ytd-rich-item-renderer id="fresh"><yt-thumbnail-view-model></yt-thumbnail-view-model></ytd-rich-item-renderer>
      <yt-lockup-view-model id="badge"><ytd-thumbnail-overlay-playback-status-renderer></ytd-thumbnail-overlay-playback-status-renderer></yt-lockup-view-model>`;

    dim.start(config);

    return {
      badge: document
        .querySelector("#badge")
        ?.classList.contains(dim.VIEWED_CLASS),
      fresh: document
        .querySelector("#fresh")
        ?.classList.contains(dim.VIEWED_CLASS),
      opacity: document.documentElement.style
        .getPropertyValue("--wd-dv-opacity")
        .trim(),
      watched: document
        .querySelector("#watched")
        ?.classList.contains(dim.VIEWED_CLASS),
    };
  }, CONFIG);

  // A partially watched card (the resume bar) and a finished one (the watched badge) fade; a card
  // the site has not marked does not. The level is the plugin's own setting, on the root element.
  expect(seen).toEqual({
    badge: true,
    fresh: false,
    opacity: "0.45",
    watched: true,
  });
});

test("a card that stops being marked fades back in, and stop leaves nothing", async ({
  page,
}) => {
  await openFixture(page);

  const seen = await page.evaluate(async (config) => {
    const { __dim: dim } = window as unknown as { __dim: DimApi };
    document.body.innerHTML = `
      <ytd-video-renderer id="card"><ytw-thumbnail-overlay-resume-playback-renderer></ytw-thumbnail-overlay-resume-playback-renderer></ytd-video-renderer>`;
    dim.start(config);

    const card = document.querySelector("#card") as Element;
    const marked = card.classList.contains(dim.VIEWED_CLASS);

    // The site re-renders the item without its resume bar, and the next frame puts the card back.
    card
      .querySelector("ytw-thumbnail-overlay-resume-playback-renderer")
      ?.remove();
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
    const afterRerender = card.classList.contains(dim.VIEWED_CLASS);

    dim.applyConfig({ ...config, opacity: 0.25 });
    const level = document.documentElement.style
      .getPropertyValue("--wd-dv-opacity")
      .trim();

    dim.stop();
    return {
      afterRerender,
      afterStop: card.classList.contains(dim.VIEWED_CLASS),
      level,
      marked,
      variable:
        document.documentElement.style.getPropertyValue("--wd-dv-opacity"),
    };
  }, CONFIG);

  expect(seen.marked).toBe(true);
  expect(seen.afterRerender).toBe(false);
  // A new level lands without a reload, and disabling the plugin leaves no class and no variable.
  expect(seen.level).toBe("0.25");
  expect(seen.afterStop).toBe(false);
  expect(seen.variable).toBe("");
});
