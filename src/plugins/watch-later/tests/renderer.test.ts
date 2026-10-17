import path from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { build } from "vite";

/**
 * The in-page half of the plugin lives in the DOM, out of reach of the node tests. These tests run
 * the real modules - `dom.ts` and `rows.ts`, which the toolbar, the hover button and the row lines
 * are built from - against markup shaped like the site's, in a plain browser: no Electron, no
 * signed-in page, no hover. Every one of them took a live session to find the first time (a toolbar
 * mounted inside a hidden container, a button that jumped when the preview started, a repaint that
 * kept the plugin scanning itself, a click cancelled by re-inserting the toolbar); here they are
 * assertions.
 */
interface DomApi {
  alignButton: (button: HTMLButtonElement, host: Element) => void;
  createSaveButton: (
    videoId: string,
    onToggle: (button: HTMLButtonElement) => void
  ) => HTMLButtonElement;
  cardUnderPoint: (x: number, y: number) => Element | null;
  mediaBoxOf: (card: Element) => { box: DOMRect; element: Element } | undefined;
  MEDIA_HOVER_CLASS: string;
  paintButton: (
    button: HTMLButtonElement,
    state: string,
    labels: { remove: string; save: string }
  ) => void;
}

interface RowsApi {
  toolbarInsertionPoint: () =>
    | { before: Element | null; parent: Element }
    | undefined;
  toolbarNeedsMoving: (
    host: Element,
    point: { before: Element | null; parent: Element }
  ) => boolean;
}

/**
 * Bundles a module the way the app does - the fixture `t` stands in for `@/i18n` - and returns the
 * IIFE that assigns it to its global name.
 */
const bundle = async (entry: string, name: "__dom" | "__rows") => {
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
    resolve: { alias: { "@/i18n": path.join(here, "fixture-i18n.ts") } },
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

const domScript = await bundle("../renderer/dom.ts", "__dom");
const rowsScript = await bundle("../renderer/ui/rows.ts", "__rows");

/** A blank page with the real modules installed as `__dom` and `__rows`. */
const openFixture = async (page: Page) => {
  await page.goto("about:blank");
  await page.addScriptTag({ content: domScript });
  await page.addScriptTag({ content: rowsScript });
};

test("the toolbar goes above the sort control the page is really showing", async ({
  page,
}) => {
  await openFixture(page);

  const points = await page.evaluate(() => {
    const { __rows: rows } = window as unknown as {
      __dom: DomApi;
      __rows: RowsApi;
    };
    // The markup measured on the live page: a visible chip in the section header, and the list
    // renderer's own sort menu sitting inside it at `display: none`.
    document.body.innerHTML = `
      <ytd-item-section-renderer style="display:block;width:1272px">
        <div id="header" style="display:block;height:32px">
          <chip-view-model style="display:block;width:169px;height:32px">Date added (newest)</chip-view-model>
        </div>
        <div id="contents" style="display:block">
          <ytd-playlist-video-list-renderer style="display:flex;flex-direction:column">
            <div id="sort-filter-menu" style="display:none">
              <yt-sort-filter-sub-menu-renderer style="display:inline-block"></yt-sort-filter-sub-menu-renderer>
            </div>
            <div id="rows" style="display:block"><div style="height:600px">row</div></div>
          </ytd-playlist-video-list-renderer>
        </div>
      </ytd-item-section-renderer>`;

    const describe = (
      point: { before: Element | null; parent: Element } | undefined
    ) =>
      point
        ? {
            before: point.before
              ? point.before.tagName +
                (point.before.id ? `#${point.before.id}` : "")
              : null,
            parent:
              point.parent.tagName +
              (point.parent.id ? `#${point.parent.id}` : ""),
          }
        : null;

    const seen: Record<string, unknown> = {};
    seen.headerChip = describe(rows.toolbarInsertionPoint());

    // The older markup: the header is gone and the list renderer's own menu is the visible one.
    document.querySelector("#header")?.remove();
    const menu = document.querySelector("#sort-filter-menu") as HTMLElement;
    menu.style.display = "block";
    seen.oldChip = describe(rows.toolbarInsertionPoint());

    // No sort control at all, first with a list that stacks its children, then with one that
    // lays them in a row.
    menu.style.display = "none";
    seen.noChipColumn = describe(rows.toolbarInsertionPoint());
    const list = document.querySelector<HTMLElement>(
      "ytd-playlist-video-list-renderer"
    )!;
    list.style.flexDirection = "row";
    seen.noChipRow = describe(rows.toolbarInsertionPoint());
    return seen;
  });

  expect(points.headerChip).toEqual({
    before: "DIV#header",
    parent: "YTD-ITEM-SECTION-RENDERER",
  });
  expect(points.oldChip).toEqual({
    before: "DIV#sort-filter-menu",
    parent: "YTD-PLAYLIST-VIDEO-LIST-RENDERER",
  });
  expect(points.noChipColumn).toEqual({
    before: "DIV#sort-filter-menu",
    parent: "YTD-PLAYLIST-VIDEO-LIST-RENDERER",
  });
  expect(points.noChipRow).toEqual({
    before: "YTD-PLAYLIST-VIDEO-LIST-RENDERER",
    parent: "DIV#contents",
  });
});

test("a toolbar that is already against its anchor is not moved again", async ({
  page,
}) => {
  await openFixture(page);

  const decided = await page.evaluate(() => {
    const { __rows: rows } = window as unknown as {
      __dom: DomApi;
      __rows: RowsApi;
    };
    document.body.innerHTML = `
      <ytd-item-section-renderer style="display:block">
        <div class="wd-wl-toolbar-host"></div>
        <div id="header" style="display:block"></div>
      </ytd-item-section-renderer>`;
    const host = document.querySelector(".wd-wl-toolbar-host") as Element;
    const header = document.querySelector("#header") as Element;
    const section = document.querySelector(
      "ytd-item-section-renderer"
    ) as Element;

    // Where it belongs, it stays: moving it would be a mutation, and a node swapped between
    // mousedown and mouseup never sees the click.
    const inPlace = rows.toolbarNeedsMoving(host, {
      before: header,
      parent: section,
    });
    // The check that used to run compared the toolbar's *previous* sibling against the anchor it
    // is inserted before, which is the toolbar's next sibling - never equal, so every scan cut the
    // toolbar out and put it back.
    const previousSiblingInsteadOfTheAnchor = rows.toolbarNeedsMoving(host, {
      before: host.previousElementSibling,
      parent: section,
    });

    section.append(host);
    const movedOutOfPlace = rows.toolbarNeedsMoving(host, {
      before: header,
      parent: section,
    });
    return { inPlace, movedOutOfPlace, previousSiblingInsteadOfTheAnchor };
  });

  expect(decided.inPlace).toBe(false);
  expect(decided.previousSiblingInsteadOfTheAnchor).toBe(true);
  expect(decided.movedOutOfPlace).toBe(true);
});

test("the button sits on the video box, at one offset in both states", async ({
  page,
}) => {
  await openFixture(page);

  const measured = await page.evaluate(async () => {
    const { __dom: dom } = window as unknown as {
      __dom: DomApi;
      __rows: RowsApi;
    };
    // A card shaped like the site's, with the avatar *before* the video box in document order.
    document.body.innerHTML = `
      <div id="card" style="position:relative;width:527px;height:352px">
        <img id="avatar" style="position:absolute;left:0;top:310px;width:36px;height:36px">
        <yt-thumbnail-view-model id="video" style="position:absolute;left:0;top:0;width:527px;height:296px"></yt-thumbnail-view-model>
      </div>`;
    const card = document.querySelector("#card") as Element;
    const video = document.querySelector("#video") as Element;
    const labels = { remove: "Remove", save: "Save" };
    const button = dom.createSaveButton("vid00000000", () => undefined);
    card.append(button);

    const countMutations = (run: () => void) =>
      new Promise<number>((resolve) => {
        let records = 0;
        const observer = new MutationObserver((list) => {
          records += list.length;
        });
        observer.observe(button, {
          attributes: true,
          childList: true,
          subtree: true,
        });
        run();
        setTimeout(() => {
          observer.disconnect();
          resolve(records);
        }, 0);
      });

    const first = await countMutations(() =>
      dom.paintButton(button, "unsaved", labels)
    );
    const repaints = await countMutations(() => {
      for (let index = 0; index < 5; index += 1) {
        dom.paintButton(button, "unsaved", labels);
      }
    });
    const changed = await countMutations(() =>
      dom.paintButton(button, "saved", labels)
    );

    dom.alignButton(button, card);
    const placed = { bottom: button.style.bottom, right: button.style.right };
    const realigns = await countMutations(() => {
      for (let index = 0; index < 5; index += 1) {
        dom.alignButton(button, card);
      }
    });
    card.classList.add(dom.MEDIA_HOVER_CLASS);
    dom.alignButton(button, card);
    const whileCovered = {
      bottom: button.style.bottom,
      right: button.style.right,
    };

    const picked = dom.mediaBoxOf(card);
    return {
      changed,
      first,
      pickedBox: picked ? [picked.box.width, picked.box.height] : null,
      pickedIsVideo: picked?.element === video,
      placed,
      realigns,
      repaints,
      whileCovered,
    };
  });

  // The first paint writes the state, the icon and the labels; repeating the same state must not
  // touch the document, which is what kept this plugin's own observer scanning.
  expect(measured.first).toBeGreaterThan(0);
  expect(measured.repaints).toBe(0);
  expect(measured.changed).toBeGreaterThan(0);
  // 36 px above the video's bottom edge, and the same offset while the preview covers the card.
  expect(measured.placed).toEqual({ bottom: "92px", right: "8px" });
  expect(measured.whileCovered).toEqual(measured.placed);
  expect(measured.realigns).toBe(0);
  // The avatar is skipped: aligning to it parks the button in the metadata row.
  expect(measured.pickedIsVideo).toBe(true);
  expect(measured.pickedBox).toEqual([527, 296]);
});

test("the card under the pointer is the one whose video box holds it", async ({
  page,
}) => {
  await openFixture(page);

  const seen = await page.evaluate(() => {
    const { __dom: dom } = window as unknown as {
      __dom: DomApi;
      __rows: RowsApi;
    };
    // Two cards side by side, one of them with an avatar before its video box. The site's inline
    // preview is a fixed overlay at `z-index: auto` painted over the card it plays on, and it takes
    // the pointer - so the mark has to be decided by where the pointer is, not by what it hits.
    document.body.innerHTML = `
      <div id="one" class="${dom.MEDIA_HOVER_CLASS}-host">
        <img style="position:absolute;left:0;top:310px;width:36px;height:36px">
        <yt-thumbnail-view-model style="position:absolute;left:0;top:0;width:320px;height:180px"></yt-thumbnail-view-model>
      </div>
      <div id="two">
        <yt-thumbnail-view-model style="position:absolute;left:400px;top:0;width:320px;height:180px"></yt-thumbnail-view-model>
      </div>
      <div id="overlay" style="position:fixed;left:0;top:0;width:320px;height:180px"></div>`;
    const one = document.querySelector("#one") as Element;
    const two = document.querySelector("#two") as Element;
    for (const card of [one, two]) {
      card.classList.add("wd-wl-anchor");
    }

    return {
      avatar: dom.cardUnderPoint(10, 330)?.id ?? null,
      firstVideo: dom.cardUnderPoint(100, 60)?.id ?? null,
      gap: dom.cardUnderPoint(360, 60)?.id ?? null,
      secondVideo: dom.cardUnderPoint(500, 60)?.id ?? null,
      outside: dom.cardUnderPoint(10, 700)?.id ?? null,
    };
  });

  // Only our own cards are considered, and only their video boxes: the avatar in `one` is not a
  // video, and the gap between the two cards belongs to neither.
  expect(seen.firstVideo).toBe("one");
  expect(seen.secondVideo).toBe("two");
  expect(seen.avatar).toBeNull();
  expect(seen.gap).toBeNull();
  expect(seen.outside).toBeNull();
});
