import { expect, test } from "@playwright/test";

import {
  isTrackFor,
  mappingFromPrompt,
  shortcutsToRegister,
  trackIdFor,
} from "../shortcuts";

/**
 * The decisions the shortcuts plugin makes before an Electron process is involved: what a config
 * asks to be registered, what a keybind prompt answered, and which MPRIS track a seek belongs to.
 *
 * The prompt one is a regression test with a history: the inherited version built the new mapping
 * and then saved the old one, so no keybind ever stuck.
 */
test("only the shortcuts a mapping binds are registered", () => {
  expect(
    shortcutsToRegister({ next: "", playPause: "Ctrl+Alt+P", previous: "" })
  ).toEqual([{ accelerator: "Ctrl+Alt+P", action: "playPause" }]);

  expect(
    shortcutsToRegister({
      next: "Ctrl+Alt+N",
      playPause: "",
      previous: "Ctrl+Alt+B",
    })
  ).toEqual([
    { accelerator: "Ctrl+Alt+B", action: "previous" },
    { accelerator: "Ctrl+Alt+N", action: "next" },
  ]);
});

test("a keybind prompt's answers are the mapping that gets saved", () => {
  const current = {
    next: "Ctrl+Alt+N",
    playPause: "Ctrl+Alt+P",
    previous: "",
  };

  expect(
    mappingFromPrompt(
      [
        { accelerator: "Ctrl+Shift+B", value: "previous" },
        { accelerator: "Ctrl+Shift+P", value: "playPause" },
        // Cleared in the prompt: the way to unbind one.
        { accelerator: "", value: "next" },
      ],
      current
    )
  ).toEqual({
    next: "",
    playPause: "Ctrl+Shift+P",
    previous: "Ctrl+Shift+B",
  });

  // An answer for something that is not an action leaves the mapping alone.
  expect(
    mappingFromPrompt(
      [{ accelerator: "Ctrl+Alt+X", value: "shuffle" }],
      current
    )
  ).toEqual(current);
});

test("an MPRIS seek is served for the announced track, and no other", () => {
  const videoId = "aqz-KE-bpKQ";

  // A D-Bus object path cannot carry a `-`, and the site's ids do.
  expect(trackIdFor(videoId)).toBe("aqz_MINUS_KE_MINUS_bpKQ");

  // What a client reads out of the metadata and sends back in `SetPosition`.
  expect(
    isTrackFor(
      `/org/node/mediaplayer/watchdeck/Track/${trackIdFor(videoId)}`,
      videoId
    )
  ).toBe(true);
  expect(
    isTrackFor(
      "/org/node/mediaplayer/watchdeck/Track/another_MINUS_video",
      videoId
    )
  ).toBe(false);
});
