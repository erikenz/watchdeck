import prompt from "custom-electron-prompt";
import { app, clipboard, dialog, Menu, shell } from "electron";
import type { BrowserWindow, MenuItem } from "electron";
import is from "electron-is";
import { satisfies } from "semver";
import { languageResources } from "virtual:i18n";
import { allPlugins } from "virtual:plugins";

import { APPLICATION_NAME, setLanguage, t } from "@/i18n";

import packageJson from "../package.json";
import * as config from "./config";
import { getAllMenuTemplate, loadAllMenuPlugins } from "./loader/menu";
import { SPONSOR_BLOCK_REPOSITORY } from "./plugins/sponsorblock/links";
import { restart } from "./providers/app-controls";
import promptOptions from "./providers/prompt-options";
import { START_PAGES } from "./providers/start-pages";
import { getVideoControls } from "./providers/video-controls";

export type MenuTemplate = Electron.MenuItemConstructorOptions[];

/** How far the Playback menu's seek items move, in seconds. */
const SEEK_STEP_SECONDS = 10;

/** The project's own page, derived from `package.json` so the two cannot drift apart. */
const PROJECT_URL = `https://github.com/${packageJson.repository}`;

/**
 * Our own about box. Electron's `role: "about"` panel shows the version and nothing else, and this
 * app owes credits that belong in front of the user: the MIT portions it was built from, and
 * SponsorBlock - GPL-3.0, never bundled, and downloaded only after the user agrees to it.
 */
const showAboutDialog = async (win: Electron.BrowserWindow) => {
  const { response } = await dialog.showMessageBox(win, {
    buttons: [
      t("main.dialog.about.buttons.project-page"),
      t("main.dialog.about.buttons.sponsorblock"),
      t("main.dialog.about.buttons.close"),
    ],
    cancelId: 2,
    defaultId: 2,
    detail: t("main.dialog.about.detail"),
    message: t("main.dialog.about.message", { version: app.getVersion() }),
    title: t("main.dialog.about.title"),
    type: "info",
  });

  if (response === 0) {
    void shell.openExternal(PROJECT_URL);
  } else if (response === 1) {
    void shell.openExternal(SPONSOR_BLOCK_REPOSITORY);
  }
};

const pluginEnabledMenu = async (
  plugin: string,
  label = "",
  description?: string,
  isNew = false,
  hasSubmenu = false,
  refreshMenu?: () => void
): Promise<Electron.MenuItemConstructorOptions> => ({
  checked: await config.plugins.isEnabled(plugin),
  click(item: Electron.MenuItem) {
    if (item.checked) {
      config.plugins.enable(plugin);
    } else {
      config.plugins.disable(plugin);
    }

    if (hasSubmenu) {
      refreshMenu?.();
    }
  },
  label: label || plugin,
  sublabel: isNew ? t("main.menu.plugins.new") : undefined,
  toolTip: description,
  type: "checkbox",
});

export const mainMenuTemplate = async (
  win: BrowserWindow
): Promise<MenuTemplate> => {
  const innerRefreshMenu = async () => setApplicationMenu(win);
  const { navigationHistory } = win.webContents;
  const controls = getVideoControls(win);
  await loadAllMenuPlugins(win);

  const allPluginsStubs = await allPlugins();

  const menuResult = await Promise.all(
    Object.entries(getAllMenuTemplate()).map(async ([id, template]) => {
      const plugin = allPluginsStubs[id];
      const pluginLabel = plugin?.name?.() ?? id;
      const pluginDescription = plugin?.description?.() ?? undefined;
      const isNew = plugin?.addedVersion
        ? satisfies(packageJson.version, plugin.addedVersion)
        : false;

      if (!(await config.plugins.isEnabled(id))) {
        return [
          id,
          await pluginEnabledMenu(
            id,
            pluginLabel,
            pluginDescription,
            isNew,
            true,
            innerRefreshMenu
          ),
        ] as const;
      }

      return [
        id,
        {
          label: pluginLabel,
          sublabel: isNew ? t("main.menu.plugins.new") : undefined,
          submenu: [
            await pluginEnabledMenu(
              id,
              t("main.menu.plugins.enabled"),
              undefined,
              false,
              true,
              innerRefreshMenu
            ),
            { type: "separator" },
            ...template,
          ],
          toolTip: pluginDescription,
        } satisfies Electron.MenuItemConstructorOptions,
      ] as const;
    })
  );

  const availablePlugins = Object.keys(await allPlugins());
  const pluginMenus = await Promise.all(
    availablePlugins
      .sort((a, b) => {
        const aPluginLabel = allPluginsStubs[a]?.name?.() ?? a;
        const bPluginLabel = allPluginsStubs[b]?.name?.() ?? b;

        return aPluginLabel.localeCompare(bPluginLabel);
      })
      .map(async (id) => {
        const predefinedTemplate = menuResult.find((it) => it[0] === id);
        if (predefinedTemplate) {
          return predefinedTemplate[1];
        }

        const plugin = allPluginsStubs[id];
        const pluginLabel = plugin?.name?.() ?? id;
        const pluginDescription = plugin?.description?.() ?? undefined;
        const isNew = plugin?.addedVersion
          ? satisfies(packageJson.version, plugin.addedVersion)
          : false;

        return await pluginEnabledMenu(
          id,
          pluginLabel,
          pluginDescription,
          isNew,
          true,
          innerRefreshMenu
        );
      })
  );

  const langResources = await languageResources();
  const availableLanguages = Object.keys(langResources);

  return [
    {
      label: t("main.menu.playback.label"),
      submenu: [
        {
          accelerator: "MediaPlayPause",
          click: controls.playPause,
          label: t("main.menu.playback.submenu.play-pause"),
        },
        {
          accelerator: "MediaNextTrack",
          click: controls.next,
          label: t("main.menu.playback.submenu.next"),
        },
        {
          accelerator: "MediaPreviousTrack",
          click: controls.previous,
          label: t("main.menu.playback.submenu.previous"),
        },
        { type: "separator" },
        // No accelerators on these: a menu accelerator is handled before the page sees
        // the key (GTK grabs it at the window), so Ctrl+arrows would break word-wise
        // cursor movement in the site's own fields. The media keys above are the ones
        // that cost nothing, and gestures (R7) are the intended quick path for these.
        {
          click: () => controls.goBack(SEEK_STEP_SECONDS),
          label: t("main.menu.playback.submenu.back"),
        },
        {
          click: () => controls.goForward(SEEK_STEP_SECONDS),
          label: t("main.menu.playback.submenu.forward"),
        },
        { type: "separator" },
        {
          click: controls.volumeUp,
          label: t("main.menu.playback.submenu.volume-up"),
        },
        {
          click: controls.volumeDown,
          label: t("main.menu.playback.submenu.volume-down"),
        },
        {
          click: controls.muteUnmute,
          label: t("main.menu.playback.submenu.mute"),
        },
      ],
    },
    {
      label: t("main.menu.plugins.label"),
      submenu: pluginMenus,
    },
    {
      label: t("main.menu.options.label"),
      submenu: [
        {
          checked: config.get("options.autoUpdates"),
          click(item: MenuItem) {
            config.setMenuOption("options.autoUpdates", item.checked);
          },
          label: t("main.menu.options.submenu.auto-update"),
          type: "checkbox",
        },
        {
          checked: config.get("options.resumeOnStart"),
          click(item: MenuItem) {
            config.setMenuOption("options.resumeOnStart", item.checked);
          },
          label: t("main.menu.options.submenu.resume-on-start"),
          type: "checkbox",
        },
        {
          label: t("main.menu.options.submenu.starting-page.label"),
          submenu: (() => {
            const subMenuArray: Electron.MenuItemConstructorOptions[] =
              Object.keys(START_PAGES).map((name) => ({
                checked: config.get("options.startingPage") === name,
                click() {
                  config.set("options.startingPage", name);
                },
                label: name,
                type: "radio",
              }));
            subMenuArray.unshift({
              checked: config.get("options.startingPage") === "",
              click() {
                config.set("options.startingPage", "");
              },
              label: t("main.menu.options.submenu.starting-page.unset"),
              type: "radio",
            });
            return subMenuArray;
          })(),
        },
        {
          label: t("main.menu.options.submenu.visual-tweaks.label"),
          submenu: [
            {
              async click() {
                const output = await prompt(
                  {
                    title: t(
                      "main.menu.options.submenu.visual-tweaks.submenu.custom-window-title.label"
                    ),
                    label: t(
                      "main.menu.options.submenu.visual-tweaks.submenu.custom-window-title.prompt.label"
                    ),
                    value: config.get("options.customWindowTitle") || "",
                    type: "input",
                    inputAttrs: {
                      type: "text",
                      placeholder: t(
                        "main.menu.options.submenu.visual-tweaks.submenu.custom-window-title.prompt.placeholder",
                        {
                          applicationName: APPLICATION_NAME,
                        }
                      ),
                    },
                    width: 500,
                    ...promptOptions(),
                  },
                  win
                );
                if (typeof output === "string") {
                  config.setMenuOption("options.customWindowTitle", output);
                }
              },
              label: t(
                "main.menu.options.submenu.visual-tweaks.submenu.custom-window-title.label"
              ),
            },
            {
              label: t(
                "main.menu.options.submenu.visual-tweaks.submenu.theme.label"
              ),
              submenu: [
                ...((config.get("options.themes")?.length ?? 0) === 0
                  ? [
                      {
                        label: t(
                          "main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.no-theme"
                        ),
                      },
                    ]
                  : []),
                ...(config.get("options.themes")?.map((theme: string) => ({
                  async click() {
                    const { response } = await dialog.showMessageBox(win, {
                      type: "question",
                      defaultId: 1,
                      title: t(
                        "main.menu.options.submenu.visual-tweaks.submenu.theme.dialog.remove-theme"
                      ),
                      message: t(
                        "main.menu.options.submenu.visual-tweaks.submenu.theme.dialog.remove-theme-message",
                        { theme }
                      ),
                      buttons: [
                        t(
                          "main.menu.options.submenu.visual-tweaks.submenu.theme.dialog.button.cancel"
                        ),
                        t(
                          "main.menu.options.submenu.visual-tweaks.submenu.theme.dialog.button.remove"
                        ),
                      ],
                    });

                    if (response === 1) {
                      config.set(
                        "options.themes",
                        config
                          .get("options.themes")
                          ?.filter((t) => t !== theme) ?? []
                      );
                      innerRefreshMenu();
                    }
                  },
                  label: theme,
                  type: "normal" as const,
                })) ?? []),
                { type: "separator" },
                {
                  async click() {
                    const { filePaths } = await dialog.showOpenDialog({
                      filters: [{ name: "CSS Files", extensions: ["css"] }],
                      properties: ["openFile", "multiSelections"],
                    });
                    if (filePaths) {
                      config.set("options.themes", filePaths);
                      innerRefreshMenu();
                    }
                  },
                  label: t(
                    "main.menu.options.submenu.visual-tweaks.submenu.theme.submenu.import-css-file"
                  ),
                  type: "normal",
                },
              ],
            },
          ],
        },
        {
          checked: true,
          click(item: MenuItem) {
            if (!item.checked && app.hasSingleInstanceLock()) {
              app.releaseSingleInstanceLock();
            } else if (item.checked && !app.hasSingleInstanceLock()) {
              app.requestSingleInstanceLock();
            }
          },
          label: t("main.menu.options.submenu.single-instance-lock"),
          type: "checkbox",
        },
        {
          checked: config.get("options.alwaysOnTop"),
          click(item: MenuItem) {
            config.setMenuOption("options.alwaysOnTop", item.checked);
            win.setAlwaysOnTop(item.checked);
          },
          label: t("main.menu.options.submenu.always-on-top"),
          type: "checkbox",
        },
        ...((is.windows() || is.linux()
          ? [
              {
                checked: config.get("options.hideMenu"),
                click(item) {
                  config.setMenuOption("options.hideMenu", item.checked);
                  if (item.checked && !config.get("options.hideMenuWarned")) {
                    dialog.showMessageBox(win, {
                      type: "info",
                      title: t(
                        "main.menu.options.submenu.hide-menu.dialog.title"
                      ),
                      message: t(
                        "main.menu.options.submenu.hide-menu.dialog.message"
                      ),
                    });
                  }
                },
                label: t("main.menu.options.submenu.hide-menu.label"),
                type: "checkbox",
              },
            ]
          : []) satisfies Electron.MenuItemConstructorOptions[]),
        ...((is.windows() || is.macOS()
          ? // Only works on Win/Mac
            // https://www.electronjs.org/docs/api/app#appsetloginitemsettingssettings-macos-windows
            [
              {
                checked: config.get("options.startAtLogin"),
                click(item) {
                  config.setMenuOption("options.startAtLogin", item.checked);
                },
                label: t("main.menu.options.submenu.start-at-login"),
                type: "checkbox",
              },
            ]
          : []) satisfies Electron.MenuItemConstructorOptions[]),
        {
          label: t("main.menu.options.submenu.tray.label"),
          submenu: [
            {
              checked: !config.get("options.tray"),
              click() {
                config.setMenuOption("options.tray", false);
                config.setMenuOption("options.appVisible", true);
              },
              label: t("main.menu.options.submenu.tray.submenu.disabled"),
              type: "radio",
            },
            {
              checked:
                config.get("options.tray") && config.get("options.appVisible"),
              click() {
                config.setMenuOption("options.tray", true);
                config.setMenuOption("options.appVisible", true);
              },
              label: t(
                "main.menu.options.submenu.tray.submenu.enabled-and-show-app"
              ),
              type: "radio",
            },
            {
              checked:
                config.get("options.tray") && !config.get("options.appVisible"),
              click() {
                config.setMenuOption("options.tray", true);
                config.setMenuOption("options.appVisible", false);
              },
              label: t(
                "main.menu.options.submenu.tray.submenu.enabled-and-hide-app"
              ),
              type: "radio",
            },
            { type: "separator" },
            {
              checked: config.get("options.trayClickPlayPause"),
              click(item: MenuItem) {
                config.setMenuOption(
                  "options.trayClickPlayPause",
                  item.checked
                );
              },
              label: t(
                "main.menu.options.submenu.tray.submenu.play-pause-on-click"
              ),
              type: "checkbox",
            },
          ],
        },
        {
          label: `${t("main.menu.options.submenu.language.label")} (Language)`,
          submenu: [
            {
              click() {
                const url = "https://bit.ly/48n5YF7";
                shell.openExternal(url);
              },
              label: t(
                "main.menu.options.submenu.language.submenu.to-help-translate"
              ),
              type: "normal",
            } as Electron.MenuItemConstructorOptions,
          ].concat(
            availableLanguages
              .map((lang): Electron.MenuItemConstructorOptions => ({
                checked: (config.get("options.language") ?? "en") === lang,
                click() {
                  config.setMenuOption("options.language", lang);
                  void setApplicationMenu(win);
                  void setLanguage(lang);
                  dialog.showMessageBox(win, {
                    title: t("main.menu.options.submenu.language.dialog.title"),
                    message: t(
                      "main.menu.options.submenu.language.dialog.message"
                    ),
                  });
                },
                label: `${langResources[lang].translation.language?.name ?? "Unknown"} (${langResources[lang].translation.language?.["local-name"] ?? "Unknown"})`,
                type: "checkbox",
              }))
              .sort((a, b) => a.label!.localeCompare(b.label!))
          ),
        },
        { type: "separator" },
        {
          label: t("main.menu.options.submenu.advanced-options.label"),
          submenu: [
            {
              async click(item: MenuItem) {
                await setProxy(item, win);
              },
              label: t(
                "main.menu.options.submenu.advanced-options.submenu.set-proxy.label"
              ),
              type: "normal",
            },
            {
              checked: config.get("options.overrideUserAgent"),
              click(item: MenuItem) {
                config.setMenuOption("options.overrideUserAgent", item.checked);
              },
              label: t(
                "main.menu.options.submenu.advanced-options.submenu.override-user-agent"
              ),
              type: "checkbox",
            },
            {
              checked: config.get("options.disableHardwareAcceleration"),
              click(item: MenuItem) {
                config.setMenuOption(
                  "options.disableHardwareAcceleration",
                  item.checked
                );
              },
              label: t(
                "main.menu.options.submenu.advanced-options.submenu.disable-hardware-acceleration"
              ),
              type: "checkbox",
            },
            {
              checked: config.get("options.restartOnConfigChanges"),
              click(item: MenuItem) {
                config.setMenuOption(
                  "options.restartOnConfigChanges",
                  item.checked
                );
              },
              label: t(
                "main.menu.options.submenu.advanced-options.submenu.restart-on-config-changes"
              ),
              type: "checkbox",
            },
            {
              checked: config.get("options.autoResetAppCache"),
              click(item: MenuItem) {
                config.setMenuOption("options.autoResetAppCache", item.checked);
              },
              label: t(
                "main.menu.options.submenu.advanced-options.submenu.auto-reset-app-cache"
              ),
              type: "checkbox",
            },
            { type: "separator" },
            is.macOS()
              ? {
                  label: t(
                    "main.menu.options.submenu.advanced-options.submenu.toggle-dev-tools"
                  ),
                  // Cannot use "toggleDevTools" role in macOS
                  click() {
                    const { webContents } = win;
                    if (webContents.isDevToolsOpened()) {
                      webContents.closeDevTools();
                    } else {
                      webContents.openDevTools();
                    }
                  },
                }
              : {
                  label: t(
                    "main.menu.options.submenu.advanced-options.submenu.toggle-dev-tools"
                  ),
                  role: "toggleDevTools",
                },
            {
              click() {
                config.edit();
              },
              label: t(
                "main.menu.options.submenu.advanced-options.submenu.edit-config-json"
              ),
            },
          ],
        },
      ],
    },
    {
      label: t("main.menu.view.label"),
      submenu: [
        {
          label: t("main.menu.view.submenu.reload"),
          role: "reload",
        },
        {
          label: t("main.menu.view.submenu.force-reload"),
          role: "forceReload",
        },
        { type: "separator" },
        {
          accelerator: "CmdOrCtrl+=",
          label: t("main.menu.view.submenu.zoom-in"),
          role: "zoomIn",
          visible: false,
        },
        {
          accelerator: "CmdOrCtrl+Plus",
          label: t("main.menu.view.submenu.zoom-in"),
          role: "zoomIn",
        },
        {
          accelerator: "CmdOrCtrl+-",
          label: t("main.menu.view.submenu.zoom-out"),
          role: "zoomOut",
        },
        {
          accelerator: "CmdOrCtrl+Shift+-",
          label: t("main.menu.view.submenu.zoom-out"),
          role: "zoomOut",
          visible: false,
        },
        {
          label: t("main.menu.view.submenu.reset-zoom"),
          role: "resetZoom",
        },
        { type: "separator" },
        {
          label: t("main.menu.view.submenu.toggle-fullscreen"),
          role: "togglefullscreen",
        },
      ],
    },
    {
      label: t("main.menu.navigation.label"),
      submenu: [
        {
          click() {
            if (navigationHistory.canGoBack()) {
              navigationHistory.goBack();
            }
          },
          label: t("main.menu.navigation.submenu.go-back"),
        },
        {
          click() {
            if (navigationHistory.canGoForward()) {
              navigationHistory.goForward();
            }
          },
          label: t("main.menu.navigation.submenu.go-forward"),
        },
        {
          click() {
            const currentURL = win.webContents.getURL();
            clipboard.writeText(currentURL);
          },
          label: t("main.menu.navigation.submenu.copy-current-url"),
        },
        {
          click: restart,
          label: t("main.menu.navigation.submenu.restart"),
        },
        {
          label: t("main.menu.navigation.submenu.quit"),
          role: "quit",
        },
      ],
    },
    {
      label: t("main.menu.about"),
      submenu: [
        {
          click: () => showAboutDialog(win),
          label: t("main.menu.about-watchdeck"),
        },
      ],
    },
  ];
};
export const setApplicationMenu = async (win: Electron.BrowserWindow) => {
  const menuTemplate: MenuTemplate = [...(await mainMenuTemplate(win))];
  if (process.platform === "darwin") {
    const { name } = app;
    menuTemplate.unshift({
      label: name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "selectAll" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { type: "separator" },
        { role: "minimize" },
        { role: "close" },
        { role: "quit" },
      ],
    });
  }

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
};

async function setProxy(item: Electron.MenuItem, win: BrowserWindow) {
  const output = await prompt(
    {
      inputAttrs: {
        placeholder: t(
          "main.menu.options.submenu.advanced-options.submenu.set-proxy.prompt.placeholder"
        ),
        type: "url",
      },
      label: t(
        "main.menu.options.submenu.advanced-options.submenu.set-proxy.prompt.label"
      ),
      title: t(
        "main.menu.options.submenu.advanced-options.submenu.set-proxy.prompt.title"
      ),
      type: "input",
      value: config.get("options.proxy"),
      width: 450,
      ...promptOptions(),
    },
    win
  );

  if (typeof output === "string") {
    config.setMenuOption("options.proxy", output);
    item.checked = output !== "";
  } else {
    // User pressed cancel
    item.checked = !item.checked; // Reset checkbox
  }
}
