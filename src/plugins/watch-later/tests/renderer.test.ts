import { readFileSync } from "node:fs";
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
  buttonStateOf: (flags: {
    refused: boolean;
    pending: boolean;
    saved: boolean;
  }) => string;
  videoIdFromHost: (host: Element) => string | undefined;
  createSaveButton: (
    videoId: string,
    onToggle: (button: HTMLButtonElement) => void
  ) => HTMLButtonElement;
  cardUnderPoint: (x: number, y: number) => Element | null;
  BUTTON_CLASS: string;
  isToggleShortcut: (event: KeyboardEvent) => boolean;
  FLOATING_LAYER_CLASS: string;
  mediaBoxOf: (card: Element) => { box: DOMRect; element: Element } | undefined;
  MEDIA_HOVER_CLASS: string;
  paintButton: (
    button: HTMLButtonElement,
    state: string,
    labels: { failed: string; remove: string; save: string }
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
    resolve: {
      // `@/i18n` first: the alias list is matched in order, and the fixture has to win over the
      // app's own i18n. `@` then resolves the rest of the source tree (`@/plugins/utils/...`,
      // which `dom.ts` shares with the dimming plugins).
      alias: {
        "@/i18n": path.join(here, "fixture-i18n.ts"),
        "@": path.join(here, "../../.."),
      },
    },
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

/**
 * The plugin's own stylesheet. The placement tests need it: whether the button is where it looks
 * like it is depends on the cascade (`position: fixed` while the card is marked, `:hover`
 * otherwise), and a test that only reads back the inline values it just wrote proves nothing
 * about the screen.
 */
const pluginStyles = readFileSync(
  path.join(import.meta.dirname, "../renderer/style.css"),
  "utf-8"
);

/** A blank page with the real modules installed as `__dom` and `__rows`. */
const openFixture = async (page: Page) => {
  await page.goto("about:blank");
  await page.addScriptTag({ content: domScript });
  await page.addScriptTag({ content: rowsScript });
};

/**
 * The same fixture on the site's own origin: reading a video id off a card resolves the card's
 * *relative* links against `location.origin`, which `about:blank` does not have.
 */
const openSiteFixture = async (page: Page) => {
  await page.route("https://www.youtube.com/**", (route) =>
    route.fulfill({
      body: "<!doctype html><title>fixture</title>",
      contentType: "text/html",
    })
  );
  await page.goto("https://www.youtube.com/");
  await page.addScriptTag({ content: domScript });
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
  await page.addStyleTag({ content: pluginStyles });

  const measured = await page.evaluate(async () => {
    const { __dom: dom } = window as unknown as {
      __dom: DomApi;
      __rows: RowsApi;
    };
    // A card shaped like the site's, with the avatar *before* the video box in document order.
    document.body.innerHTML = `
      <div id="card" class="wd-wl-anchor" style="position:relative;width:527px;height:352px">
        <img id="avatar" style="position:absolute;left:0;top:310px;width:36px;height:36px">
        <yt-thumbnail-view-model id="video" style="position:absolute;left:0;top:0;width:527px;height:296px"></yt-thumbnail-view-model>
      </div>`;
    const card = document.querySelector("#card") as Element;
    const video = document.querySelector("#video") as Element;
    const labels = { failed: "Could not save", remove: "Remove", save: "Save" };
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
    const mediaRect = video.getBoundingClientRect();
    const placed = { bottom: button.style.bottom, right: button.style.right };
    const realigns = await countMutations(() => {
      for (let index = 0; index < 5; index += 1) {
        dom.alignButton(button, card);
      }
    });
    // Where that puts the button *on screen*, which is the only thing the user sees.
    const hovered = button.getBoundingClientRect();

    card.classList.add(dom.MEDIA_HOVER_CLASS);
    dom.alignButton(button, card);
    const marked = button.getBoundingClientRect();
    const whileMarked = { left: button.style.left, top: button.style.top };

    const picked = dom.mediaBoxOf(card);
    return {
      changed,
      cornerWhileHovered: { x: hovered.right, y: hovered.bottom },
      cornerWhileMarked: { x: marked.right, y: marked.bottom },
      first,
      mediaEdge: { right: mediaRect.right, bottom: mediaRect.bottom },
      pickedBox: picked ? [picked.box.width, picked.box.height] : null,
      pickedIsVideo: picked?.element === video,
      placed,
      realigns,
      repaints,
      whileMarkedClearedAbsolute:
        button.style.right === "" && button.style.bottom === "",
      whileMarkedSet: whileMarked,
    };
  });

  // The first paint writes the state, the icon and the labels; repeating the same state must not
  // touch the document, which is what kept this plugin's own observer scanning.
  expect(measured.first).toBeGreaterThan(0);
  expect(measured.repaints).toBe(0);
  expect(measured.changed).toBeGreaterThan(0);
  // 36 px above the video's bottom edge and 8 px inside its right edge, hovered...
  expect(measured.placed).toEqual({ bottom: "92px", right: "8px" });
  expect(measured.cornerWhileHovered.x).toBeCloseTo(
    measured.mediaEdge.right - 8,
    0
  );
  expect(measured.cornerWhileHovered.y).toBeCloseTo(
    measured.mediaEdge.bottom - 36,
    0
  );
  // ...and the same corner while the card is marked, where the button is placed `fixed` so it can
  // sit above the site's preview overlay without raising the card.
  expect(measured.whileMarkedClearedAbsolute).toBe(true);
  expect(measured.cornerWhileMarked.x).toBeCloseTo(
    measured.cornerWhileHovered.x,
    0
  );
  expect(measured.cornerWhileMarked.y).toBeCloseTo(
    measured.cornerWhileHovered.y,
    0
  );
  expect(measured.realigns).toBe(0);
  // The avatar is skipped: aligning to it parks the button in the metadata row.
  expect(measured.pickedIsVideo).toBe(true);
  expect(measured.pickedBox).toEqual([527, 296]);
});

/**
 * The site's horizontal shelves wrap their cards in a scrolling element with an *identity*
 * transform **and** `overflow: clip`. Any transform makes that element the containing block for
 * `position: fixed` descendants, and `clip` then cuts them off - which is how the button of a
 * hovered shelf card ended up half outside the wrapper, and then gone entirely once the preview
 * moved the video box. Measured on the page, so it is in here.
 */
test("the button stays visible inside a transformed, clipping shelf", async ({
  page,
}) => {
  await openFixture(page);
  await page.addStyleTag({ content: pluginStyles });

  const measured = await page.evaluate(() => {
    const { __dom: dom } = window as unknown as { __dom: DomApi };
    document.body.innerHTML = `
      <div id="shelf" style="position:static;transform:translateX(543px);overflow:clip;width:300px;height:400px">
        <div id="card" class="wd-wl-anchor" style="position:relative;width:527px;height:352px">
          <yt-thumbnail-view-model id="video" style="position:absolute;left:0;top:0;width:527px;height:296px"></yt-thumbnail-view-model>
        </div>
      </div>`;
    const card = document.querySelector("#card") as Element;
    const video = document.querySelector("#video") as Element;
    const button = dom.createSaveButton("vid00000001", () => undefined);
    card.append(button);
    dom.alignButton(button, card);
    const hovered = button.getBoundingClientRect();

    card.classList.add(dom.MEDIA_HOVER_CLASS);
    dom.alignButton(button, card);
    const marked = button.getBoundingClientRect();
    const media = video.getBoundingClientRect();

    // What is painted where the button is. Inside the circle, not at the corners of its bounding
    // box: the button is round, and a round element is not hit at its corners.
    const probe = (dx: number, dy: number) => {
      const el = document.elementFromPoint(
        Math.round(marked.left + dx),
        Math.round(marked.top + dy)
      );
      return el?.closest(`.${dom.BUTTON_CLASS}`)
        ? "button"
        : (el?.tagName ?? "none");
    };

    return {
      cornerWhileHovered: { x: hovered.right, y: hovered.bottom },
      cornerWhileMarked: { x: marked.right, y: marked.bottom },
      mediaEdge: { right: media.right, bottom: media.bottom },
      probes: [probe(18, 3), probe(18, 33), probe(3, 18), probe(33, 18)],
      parent: (button.parentElement?.className ?? "").slice(0, 40),
      wrapperOverflow: getComputedStyle(document.querySelector("#shelf")!)
        .overflow,
      wrapperTransform: getComputedStyle(document.querySelector("#shelf")!)
        .transform,
    };
  });

  // The wrapper really is shifted and clipping; without either this test would pass on the bug it
  // is here to catch.
  expect(measured.wrapperTransform).toBe("matrix(1, 0, 0, 1, 543, 0)");
  expect(measured.wrapperOverflow).toBe("clip");
  // The card is wider than the wrapper, so a `fixed` button left inside that subtree is clipped
  // away by it - which is what happened on the page.
  expect(measured.parent).toContain("wd-wl-floating-layer");
  expect(measured.probes).toEqual(["button", "button", "button", "button"]);
  expect(measured.cornerWhileMarked.x).toBeCloseTo(
    measured.mediaEdge.right - 8,
    0
  );
  expect(measured.cornerWhileMarked.y).toBeCloseTo(
    measured.mediaEdge.bottom - 36,
    0
  );
  expect(measured.cornerWhileMarked.x).toBeCloseTo(
    measured.cornerWhileHovered.x,
    0
  );
  expect(measured.cornerWhileMarked.y).toBeCloseTo(
    measured.cornerWhileHovered.y,
    0
  );
});

test("a button whose card is gone comes back to the card, not the floating layer", async ({
  page,
}) => {
  await openFixture(page);

  const seen = await page.evaluate(() => {
    const { __dom: dom } = window as unknown as { __dom: DomApi };
    document.body.innerHTML = `
      <div id="card"><yt-thumbnail-view-model id="video" style="position:absolute;left:0;top:0;width:320px;height:180px"></yt-thumbnail-view-model></div>`;
    const card = document.querySelector("#card") as Element;
    const button = dom.createSaveButton("vid00000000", () => undefined);
    card.append(button);

    // The pointer is on the card's video box, so the button floats.
    card.classList.add(dom.MEDIA_HOVER_CLASS);
    dom.alignButton(button, card);
    const floated = {
      floating: button.classList.contains("wd-wl-floating"),
      inLayer: button.parentElement !== card,
    };

    // The site re-renders and the card leaves the page while the mark is still on it. Nothing can
    // be measured on a detached card, and the button used to stay in the layer - under `<body>`,
    // over everything, on every page, for the rest of the session.
    card.remove();
    card.classList.remove(dom.MEDIA_HOVER_CLASS);
    dom.alignButton(button, card);

    return {
      backInCard: button.parentElement === card,
      floated,
      stillFloating: button.classList.contains("wd-wl-floating"),
    };
  });

  expect(seen.floated).toEqual({ floating: true, inLayer: true });
  expect(seen.backInCard).toBe(true);
  expect(seen.stillFloating).toBe(false);
});

test("the shortcut takes `w` on a card and leaves typing alone", async ({
  page,
}) => {
  await openFixture(page);

  const decided = await page.evaluate(() => {
    const { __dom: dom } = window as unknown as { __dom: DomApi };
    document.body.innerHTML = `
      <div id="card" class="wd-wl-anchor"><input id="search" type="search"><div id="edit" contenteditable="true"></div></div>`;
    const input = document.querySelector("#search") as HTMLElement;
    const edit = document.querySelector("#edit") as HTMLElement;
    const card = document.querySelector("#card") as HTMLElement;
    const press = (target: EventTarget, init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        key: "w",
        ...init,
      });
      Object.defineProperty(event, "target", { value: target });
      return dom.isToggleShortcut(event);
    };

    return {
      onCard: press(card, {}),
      capital: press(card, { shiftKey: true }),
      inInput: press(input, {}),
      inContentEditable: press(edit, {}),
      otherKey: press(card, { key: "k" }),
      withCtrl: press(card, { ctrlKey: true }),
    };
  });

  expect(decided.onCard).toBe(true);
  // Everything else is somebody else's keypress.
  expect(decided.capital).toBe(true); // Shift is fine: `key` is "w" only when it is typed lower-case
  expect(decided.inInput).toBe(false);
  expect(decided.inContentEditable).toBe(false);
  expect(decided.otherKey).toBe(false);
  expect(decided.withCtrl).toBe(false);
});

test("a refused change is painted as a failure, and says so on the button", async ({
  page,
}) => {
  await openFixture(page);

  const painted = await page.evaluate(() => {
    const { __dom: dom } = window as unknown as { __dom: DomApi };
    const button = dom.createSaveButton("vid00000000", () => undefined);
    document.body.append(button);
    const labels = {
      failed: "Could not save to Watch Later - try again",
      remove: "Remove from Watch Later",
      save: "Save to Watch Later",
    };

    dom.paintButton(button, "error", labels);
    const refused = {
      aria: button.getAttribute("aria-label"),
      state: button.dataset.state,
      title: button.title,
    };
    dom.paintButton(button, "unsaved", labels);

    return {
      afterRepaint: button.title,
      pressed: button.getAttribute("aria-pressed"),
      refused,
    };
  });

  // A refusal has to be readable, not just red: "Save to Watch Later" on a button that just failed
  // says nothing about what happened.
  expect(painted.refused).toEqual({
    aria: "Could not save to Watch Later - try again",
    state: "error",
    title: "Could not save to Watch Later - try again",
  });
  expect(painted.afterRepaint).toBe("Save to Watch Later");
  expect(painted.pressed).toBe("false");
});

test("a card's video id is read off its own link", async ({ page }) => {
  await openSiteFixture(page);

  const read = await page.evaluate(() => {
    const { __dom: dom } = window as unknown as { __dom: DomApi };
    document.body.innerHTML = `
      <div id="watch"><a href="/watch?v=vid00000000&amp;list=WL"><yt-thumbnail></yt-thumbnail></a></div>
      <div id="shorts"><a href="/shorts/shrt0000001"></a></div>
      <div id="none"><a href="/feed/subscriptions"></a></div>`;
    const none = document.querySelector("#none") as Element;
    const shorts = document.querySelector("#shorts") as Element;
    const watch = document.querySelector("#watch") as Element;
    return {
      none: dom.videoIdFromHost(none),
      shorts: dom.videoIdFromHost(shorts),
      watch: dom.videoIdFromHost(watch),
    };
  });

  // The dimming plugins ask the same reader which video a card is, so what it answers for the two
  // link shapes the site serves is part of their contract too.
  expect(read).toEqual({
    none: undefined,
    shorts: "shrt0000001",
    watch: "vid00000000",
  });
});

test("a refusal outranks everything else on the button", async ({ page }) => {
  await openFixture(page);

  const states = await page.evaluate(() => {
    const { __dom: dom } = window as unknown as { __dom: DomApi };
    return {
      pending: dom.buttonStateOf({
        pending: true,
        refused: false,
        saved: false,
      }),
      refused: dom.buttonStateOf({
        pending: false,
        refused: true,
        saved: true,
      }),
      refusedWhilePending: dom.buttonStateOf({
        pending: true,
        refused: true,
        saved: false,
      }),
      saved: dom.buttonStateOf({ pending: false, refused: false, saved: true }),
      unsaved: dom.buttonStateOf({
        pending: false,
        refused: false,
        saved: false,
      }),
    };
  });

  // A change the server refused has to be visible: a button that goes back to "not saved" on its own
  // reads as "nothing happened", which is how a save that never landed was missed.
  expect(states).toEqual({
    pending: "pending",
    refused: "error",
    refusedWhilePending: "error",
    saved: "saved",
    unsaved: "unsaved",
  });
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
