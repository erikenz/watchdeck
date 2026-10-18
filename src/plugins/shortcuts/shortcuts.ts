/**
 * The parts of the shortcuts plugin that are only data: what to register for a config, what a
 * keybind prompt answered, and how an MPRIS track id relates to a video id.
 *
 * Kept out of `main.ts` and `mpris.ts` on purpose - those import `electron`, and this module is
 * what the tests can reach without an Electron process.
 */
import type { ShortcutMappingType } from "./index";

/** The three things a shortcut can do, in the order a prompt asks for them. */
export const SHORTCUT_ACTIONS = ["previous", "playPause", "next"] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

/** One shortcut, as the main process registers it. */
export interface ShortcutRegistration {
  accelerator: string;
  action: ShortcutAction;
}

/** What a keybind prompt answers: one entry per action, `accelerator` empty when it was cleared. */
export interface KeybindAnswer {
  accelerator: string;
  value: string;
}

/**
 * The shortcuts a mapping asks for. An action nobody bound is left out rather than registered as an
 * empty accelerator, which Electron refuses.
 */
export const shortcutsToRegister = (
  mapping: ShortcutMappingType
): ShortcutRegistration[] =>
  SHORTCUT_ACTIONS.flatMap((action) => {
    const accelerator = mapping[action];

    return accelerator ? [{ accelerator, action }] : [];
  });

/**
 * The mapping a keybind prompt answered, on top of the one it was opened with. Actions the prompt
 * did not mention keep what they had; a cleared keybind arrives as an empty accelerator, which is
 * how one is unbound.
 */
export const mappingFromPrompt = (
  answers: KeybindAnswer[],
  current: ShortcutMappingType
): ShortcutMappingType => {
  const mapping = { ...current };

  for (const { accelerator, value } of answers) {
    if (SHORTCUT_ACTIONS.includes(value as ShortcutAction)) {
      mapping[value as ShortcutAction] = accelerator ?? "";
    }
  }

  return mapping;
};

/**
 * The MPRIS track id for a video. D-Bus object paths cannot carry a `-` and the site's ids do, so
 * the same escaping has to be used on both sides of the comparison.
 */
export const trackIdFor = (videoId: string) =>
  videoId.replaceAll("-", "_MINUS_");

/** Whether an MPRIS track id is the one this video's metadata announced. */
export const isTrackFor = (trackId: string, videoId: string) =>
  trackId.endsWith(trackIdFor(videoId));
