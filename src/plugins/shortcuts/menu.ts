import prompt from "custom-electron-prompt";
import type { KeybindOptions } from "custom-electron-prompt";
import type { BrowserWindow } from "electron";

import { t } from "@/i18n";
import type { MenuTemplate } from "@/menu";
import promptOptions from "@/providers/prompt-options";
import type { MenuContext } from "@/types/contexts";

import type { ShortcutMappingType, ShortcutsPluginConfig } from "./index";
import { mappingFromPrompt } from "./shortcuts";

/**
 * Asks for one set of keybinds and answers the mapping the answers produce - or `null` when the
 * prompt was cancelled, which must leave the config alone.
 *
 * All three actions are always asked for together, so clearing one (the prompt's own way of
 * unbinding) arrives as an empty accelerator instead of silently keeping the old one. The inherited
 * version built the new mapping and then saved the old one, which is why no keybind ever stuck.
 */
const promptMapping = async (
  win: BrowserWindow,
  title: string,
  label: string,
  current: ShortcutMappingType
): Promise<ShortcutMappingType | null> => {
  const kb = (
    label_: string,
    value: string,
    default_?: string
  ): KeybindOptions => ({
    default: default_ || undefined,
    label: label_,
    value,
  });

  const output = await prompt(
    {
      height: 270,
      keybindOptions: [
        kb(
          t("plugins.shortcuts.prompt.keybind.keybind-options.previous"),
          "previous",
          current.previous
        ),
        kb(
          t("plugins.shortcuts.prompt.keybind.keybind-options.play-pause"),
          "playPause",
          current.playPause
        ),
        kb(
          t("plugins.shortcuts.prompt.keybind.keybind-options.next"),
          "next",
          current.next
        ),
      ],
      label,
      title,
      type: "keybind",
      ...promptOptions(),
    },
    win
  );

  return output ? mappingFromPrompt(output, current) : null;
};

export const onMenu = async ({
  getConfig,
  setConfig,
  window,
}: MenuContext<ShortcutsPluginConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();

  return [
    {
      click: async () => {
        const mapping = await promptMapping(
          window,
          t("plugins.shortcuts.prompt.global.title"),
          t("plugins.shortcuts.prompt.global.label"),
          config.global
        );

        if (mapping) {
          setConfig({ global: mapping });
        }
      },
      label: t("plugins.shortcuts.menu.set-global-keybinds"),
    },
    {
      click: async () => {
        const mapping = await promptMapping(
          window,
          t("plugins.shortcuts.prompt.local.title"),
          t("plugins.shortcuts.prompt.local.label"),
          config.local
        );

        if (mapping) {
          setConfig({ local: mapping });
        }
      },
      label: t("plugins.shortcuts.menu.set-local-keybinds"),
    },
    {
      checked: config.overrideMediaKeys,
      click: (item) => setConfig({ overrideMediaKeys: item.checked }),
      label: t("plugins.shortcuts.menu.override-media-keys"),
      type: "checkbox",
    },
  ];
};
