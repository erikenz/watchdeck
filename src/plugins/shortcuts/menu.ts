import prompt from "custom-electron-prompt";
import type { KeybindOptions } from "custom-electron-prompt";
import type { BrowserWindow } from "electron";

import { t } from "@/i18n";
import type { MenuTemplate } from "@/menu";
import promptOptions from "@/providers/prompt-options";
import type { MenuContext } from "@/types/contexts";

import type { ShortcutsPluginConfig } from "./index";

export const onMenu = async ({
  window,
  getConfig,
  setConfig,
}: MenuContext<ShortcutsPluginConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();

  /**
   * Helper function for keybind prompt
   */
  const kb = (
    label_: string,
    value_: string,
    default_?: string
  ): KeybindOptions => ({ default: default_, label: label_, value: value_ });

  async function promptKeybind(
    config: ShortcutsPluginConfig,
    win: BrowserWindow
  ) {
    const output = await prompt(
      {
        height: 270,
        keybindOptions: [
          // If default=undefined then no default is used
          kb(
            t("plugins.shortcuts.prompt.keybind.keybind-options.previous"),
            "previous",
            config.global?.previous
          ),
          kb(
            t("plugins.shortcuts.prompt.keybind.keybind-options.play-pause"),
            "playPause",
            config.global?.playPause
          ),
          kb(
            t("plugins.shortcuts.prompt.keybind.keybind-options.next"),
            "next",
            config.global?.next
          ),
        ],
        label: t("plugins.shortcuts.prompt.keybind.label"),
        title: t("plugins.shortcuts.prompt.keybind.title"),
        type: "keybind",
        ...promptOptions(),
      },
      win
    );

    if (output) {
      const newConfig = { ...config };

      for (const { value, accelerator } of output) {
        newConfig.global[value as keyof ShortcutsPluginConfig["global"]] =
          accelerator;
      }

      setConfig(config);
    }
    // Else -> pressed cancel
  }

  return [
    {
      click: async () => promptKeybind(config, window),
      label: t("plugins.shortcuts.menu.set-keybinds"),
    },
    {
      checked: config.overrideMediaKeys,
      click: (item) => setConfig({ overrideMediaKeys: item.checked }),
      label: t("plugins.shortcuts.menu.override-media-keys"),
      type: "checkbox",
    },
  ];
};
