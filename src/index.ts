// Must come first: it sets the app's on-disk identity before any path is read.
import "./app-identity";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import ErrorHtmlAsset from "@assets/error.html?asset";
import { enhanceWebRequest } from "@jellybrick/electron-better-web-request";
import type { BetterSession } from "@jellybrick/electron-better-web-request";
import { deepmerge } from "deepmerge-ts";
import {
  BrowserWindow,
  app,
  screen,
  globalShortcut,
  session,
  shell,
  dialog,
  ipcMain,
  protocol,
} from "electron";
import type { BrowserWindowConstructorOptions } from "electron";
import electronDebug from "electron-debug";
import is from "electron-is";
import unhandled from "electron-unhandled";
import { deepEqual } from "fast-equals";
import { parse } from "node-html-parser";
import { languageResources } from "virtual:i18n";
import { allPlugins, mainPlugins } from "virtual:plugins";

import * as config from "@/config";
import { APPLICATION_NAME, loadI18n, setLanguage, t } from "@/i18n";
import {
  forceLoadMainPlugin,
  forceUnloadMainPlugin,
  getAllLoadedMainPlugins,
  loadAllMainPlugins,
} from "@/loader/main";
import { refreshMenu, setApplicationMenu } from "@/menu";
import { defaultAuthProxyConfig } from "@/plugins/auth-proxy-adapter/config";
import { fileExists, injectCSSAsFile } from "@/plugins/utils/main";
import { restart, setupAppControls } from "@/providers/app-controls";
import {
  APP_PROTOCOL,
  handleProtocol,
  setupProtocolHandler,
} from "@/providers/protocol-handler";
import { START_PAGES } from "@/providers/start-pages";
import { setupVideoInfo } from "@/providers/video-info";
import { setUpTray } from "@/tray";
import type { PluginConfig } from "@/types/plugins";
import { LoggerPrefix } from "@/utils";
import { isTesting } from "@/utils/testing";

// Catch errors and log them
unhandled({
  logger: console.error,
  showDialog: false,
});

// Prevent window being garbage collected
let mainWindow: Electron.BrowserWindow | null;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.exit();
}

protocol.registerSchemesAsPrivileged([
  {
    privileges: {
      allowServiceWorkers: true,
      bypassCSP: true,
      codeCache: true,
      corsEnabled: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
    scheme: "http",
  },
  {
    privileges: {
      allowServiceWorkers: true,
      bypassCSP: true,
      codeCache: true,
      corsEnabled: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
    scheme: "https",
  },
  { privileges: { standard: true }, scheme: "mailto" },
]);

// Ozone platform hint: Required for Wayland support
app.commandLine.appendSwitch("ozone-platform-hint", "auto");

// Remote debugging, on request only: `pnpm dev:remote` (or WATCHDECK_REMOTE_DEBUG=<port>)
// starts Chromium with a CDP endpoint, so a tool - or a Chrome window on another
// machine - can attach to the running app instead of guessing from logs.
const remoteDebugPort = process.env.WATCHDECK_REMOTE_DEBUG;
if (remoteDebugPort) {
  app.commandLine.appendSwitch("remote-debugging-port", remoteDebugPort);
  // Chrome 111+ refuses cross-origin CDP websockets without this.
  app.commandLine.appendSwitch("remote-allow-origins", "*");
  console.log(
    `${LoggerPrefix} requesting remote debugging on http://127.0.0.1:${remoteDebugPort}`
  );
}

// SharedArrayBuffer: Required for downloader (@ffmpeg/core-mt)
// OverlayScrollbar: Required for overlay scrollbars
// UseOzonePlatform: Required for Wayland support
// WaylandWindowDecorations: Required for Wayland decorations
app.commandLine.appendSwitch(
  "enable-features",
  "OverlayScrollbar,SharedArrayBuffer,UseOzonePlatform,WaylandWindowDecorations"
);

// Disable Fluent Scrollbar (for OverlayScrollbar)
const disabledFeatures = ["FluentScrollbar"];
const disableHardwareAcceleration = config.get(
  "options.disableHardwareAcceleration"
);

// Linux specific fixes
if (is.linux()) {
  // Stops chromium from launching its own MPRIS service
  if (await config.plugins.isEnabled("shortcuts")) {
    disabledFeatures.push("MediaSessionService");
  }

  // WM_CLASS/app_id and the on-disk identity are set in src/app-identity.ts.
}

if (disableHardwareAcceleration) {
  if (is.dev()) {
    console.log("Disabling hardware acceleration");
  }
  app.disableHardwareAcceleration();
}

// Apply disabled features
app.commandLine.appendSwitch("disable-features", disabledFeatures.join(","));

if (config.get("options.proxy")) {
  const authProxyEnabled = await config.plugins.isEnabled("auth-proxy-adapter");

  let proxyToUse = "";
  if (authProxyEnabled) {
    // Use proxy from Auth-Proxy-Adapter plugin
    const authProxyConfig = deepmerge(
      defaultAuthProxyConfig,
      config.get("plugins.auth-proxy-adapter") ?? {}
    ) as typeof defaultAuthProxyConfig;

    const { hostname, port } = authProxyConfig;
    proxyToUse = `socks5://${hostname}:${port}`;
  } else if (config.get("options.proxy")) {
    // Use global proxy settings
    proxyToUse = config.get("options.proxy");
  }
  console.log(LoggerPrefix, `Using proxy: ${proxyToUse}`);
  app.commandLine.appendSwitch("proxy-server", proxyToUse);
}

// Adds debug features like hotkeys for triggering dev tools and reload
electronDebug({
  showDevTools: false, // Disable automatic devTools on new window
});

let icon = "assets/icon.png";
if (process.platform === "win32") {
  icon = "assets/generated/icons/win/icon.ico";
} else if (process.platform === "darwin") {
  icon = "assets/generated/icons/mac/icon.icns";
}

function onClosed() {
  // Dereference the window
  // For multiple Windows store them in an array
  mainWindow = null;
}

ipcMain.handle("watchdeck:get-main-plugin-names", async () =>
  Object.keys(await mainPlugins())
);

const initHook = async (win: BrowserWindow) => {
  const allPluginStubs = await allPlugins();

  ipcMain.handle(
    "watchdeck:get-config",
    (_, id: string) =>
      deepmerge(
        allPluginStubs[id].config ?? { enabled: false },
        config.get(`plugins.${id}`) ?? {}
      ) as PluginConfig
  );
  ipcMain.handle("watchdeck:set-config", (_, name: string, obj: object) => {
    config.setPartial(`plugins.${name}`, obj, allPluginStubs[name].config);
  });

  config.watch((newValue, oldValue) => {
    const newPluginConfigList = (newValue?.plugins ?? {}) as Record<
      string,
      unknown
    >;
    const oldPluginConfigList = (oldValue?.plugins ?? {}) as Record<
      string,
      unknown
    >;

    Object.entries(newPluginConfigList).forEach(([id, newPluginConfig]) => {
      const isEqual = deepEqual(oldPluginConfigList[id], newPluginConfig);

      if (!isEqual) {
        const oldConfig = oldPluginConfigList[id] as PluginConfig;
        const config = deepmerge(
          allPluginStubs[id].config ?? { enabled: false },
          newPluginConfig ?? {}
        ) as PluginConfig;

        if (config.enabled !== oldConfig?.enabled) {
          if (config.enabled) {
            win.webContents.send("plugin:enable", id);
            ipcMain.emit("plugin:enable", id);
            forceLoadMainPlugin(id, win);
          } else {
            win.webContents.send("plugin:unload", id);
            ipcMain.emit("plugin:unload", id);
            forceUnloadMainPlugin(id, win);
          }

          if (allPluginStubs[id]?.restartNeeded) {
            showNeedToRestartDialog(id);
          }
        }

        const mainPlugin = getAllLoadedMainPlugins()[id];
        if (mainPlugin) {
          if (config.enabled && typeof mainPlugin.backend !== "function") {
            mainPlugin.backend?.onConfigChange?.call(
              mainPlugin.backend,
              config
            );
          }
        }

        win.webContents.send("config-changed", id, config);
      }
    });
  });
};

const showNeedToRestartDialog = async (id: string) => {
  const plugin = (await allPlugins())[id];

  const dialogOptions: Electron.MessageBoxOptions = {
    buttons: [
      t("main.dialog.need-to-restart.buttons.restart-now"),
      t("main.dialog.need-to-restart.buttons.later"),
    ],
    cancelId: 1,
    defaultId: 0,
    detail: t("main.dialog.need-to-restart.detail", {
      pluginName: plugin?.name?.() ?? id,
    }),
    message: t("main.dialog.need-to-restart.message", {
      pluginName: plugin?.name?.() ?? id,
    }),
    title: t("main.dialog.need-to-restart.title"),
    type: "info",
  };

  let dialogPromise: Promise<Electron.MessageBoxReturnValue>;
  if (mainWindow) {
    dialogPromise = dialog.showMessageBox(mainWindow, dialogOptions);
  } else {
    dialogPromise = dialog.showMessageBox(dialogOptions);
  }

  dialogPromise.then((dialogOutput) => {
    switch (dialogOutput.response) {
      case 0: {
        restart();
        break;
      }

      // Ignore
      default: {
        break;
      }
    }
  });
};

function initTheme(win: BrowserWindow) {
  // Load user CSS
  const themes: string[] = config.get("options.themes");
  if (Array.isArray(themes)) {
    for (const cssFile of themes) {
      fileExists(
        cssFile,
        () => {
          injectCSSAsFile(win.webContents, cssFile);
        },
        () => {
          console.warn(
            LoggerPrefix,
            t("main.console.theme.css-file-not-found", { cssFile })
          );
        }
      );
    }
  }

  win.webContents.once("did-finish-load", () => {
    if (is.dev()) {
      // DevTools used to open here on every dev run, covering the window that is the
      // thing under development. It stays one keystroke (F12) or one menu click away.
      console.debug(LoggerPrefix, t("main.console.did-finish-load.ready"));
    }
  });
}

async function createMainWindow() {
  const windowSize = config.get("window-size");
  const windowMaximized = config.get("window-maximized");
  const windowPosition: Electron.Point = config.get("window-position");
  const useInlineMenu = await config.plugins.isEnabled("in-app-menu");

  const defaultTitleBarOverlayOptions: Electron.TitleBarOverlay = {
    color: "#00000000",
    height: 32,
    symbolColor: "#ffffff",
  };

  const decorations: Partial<BrowserWindowConstructorOptions> = {
    autoHideMenuBar: config.get("options.hideMenu"),
    frame: !is.macOS() && !useInlineMenu,
    titleBarOverlay: defaultTitleBarOverlayOptions,
    titleBarStyle: useInlineMenu
      ? "hidden"
      : is.macOS()
        ? "hiddenInset"
        : "default",
  };

  // Note: on linux, for some weird reason, having these extra properties with 'frame: false' does not work
  if (is.linux() && useInlineMenu) {
    delete decorations.titleBarOverlay;
    delete decorations.titleBarStyle;
  }

  const electronWindowSettings: Electron.BrowserWindowConstructorOptions = {
    backgroundColor: "#000",
    height: windowSize.height,
    icon,
    minHeight: 425,
    minWidth: 325,
    show: false,
    title: config.get("options.customWindowTitle") || APPLICATION_NAME,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "..", "preload", "preload.cjs"),
      ...(isTesting()
        ? undefined
        : {
            // Sandbox is only enabled in tests for now
            // See https://www.electronjs.org/docs/latest/tutorial/sandbox#preload-scripts
            sandbox: false,
          }),
    },
    width: windowSize.width,
    ...decorations,
  };

  const win = new BrowserWindow(electronWindowSettings);

  await initHook(win);
  initTheme(win);

  await loadAllMainPlugins(win);

  if (windowPosition) {
    const { x: windowX, y: windowY } = windowPosition;
    const winSize = win.getSize();
    const display = screen.getDisplayNearestPoint(windowPosition);
    const primaryDisplay = screen.getPrimaryDisplay();

    const scaleFactor = is.windows()
      ? primaryDisplay.scaleFactor / display.scaleFactor
      : 1;
    const scaledWidth = Math.floor(windowSize.width * scaleFactor);
    const scaledHeight = Math.floor(windowSize.height * scaleFactor);

    const scaledX = windowX;
    const scaledY = windowY;

    if (
      scaledX + scaledWidth / 2 < display.bounds.x - 8 || // Left
      scaledX + scaledWidth / 2 > display.bounds.x + display.bounds.width || // Right
      scaledY < display.bounds.y - 8 || // Top
      scaledY + scaledHeight / 2 > display.bounds.y + display.bounds.height // Bottom
    ) {
      // Window is offscreen
      if (is.dev()) {
        console.warn(
          LoggerPrefix,
          t("main.console.window.tried-to-render-offscreen", {
            displaySize: JSON.stringify(display.bounds),
            position: JSON.stringify(windowPosition),
            windowSize: String(winSize),
          })
        );
      }
    } else {
      win.setSize(scaledWidth, scaledHeight);
      win.setPosition(scaledX, scaledY);
    }
  }

  if (windowMaximized) {
    win.maximize();
  }

  if (config.get("options.alwaysOnTop")) {
    win.setAlwaysOnTop(true);
  }

  // An explicitly chosen starting page wins over resuming: the user asked for that page
  // on every launch, and the resume option sits right next to it in the menu.
  const startingPage = START_PAGES[config.get("options.startingPage")];
  const urlToLoad = startingPage
    ? `${config.defaultConfig.url}${startingPage}`
    : config.get("options.resumeOnStart")
      ? config.get("url")
      : config.defaultConfig.url;
  win.on("closed", onClosed);

  win.on("move", () => {
    if (win.isMaximized()) {
      return;
    }

    const [x, y] = win.getPosition();
    lateSave("window-position", { x, y });
  });

  let winWasMaximized: boolean;

  win.on("resize", () => {
    const [width, height] = win.getSize();
    const isMaximized = win.isMaximized();

    if (winWasMaximized !== isMaximized) {
      winWasMaximized = isMaximized;
      config.set("window-maximized", isMaximized);
    }

    if (isMaximized) {
      return;
    }

    lateSave("window-size", {
      height,
      width,
    });
  });

  const savedTimeouts: Record<string, NodeJS.Timeout | undefined> = {};

  function lateSave(
    key: string,
    value: unknown,
    fn: (key: string, value: unknown) => void = config.set
  ) {
    if (savedTimeouts[key]) {
      clearTimeout(savedTimeouts[key]);
    }

    savedTimeouts[key] = setTimeout(() => {
      fn(key, value);
      savedTimeouts[key] = undefined;
    }, 600);
  }

  app.on("render-process-gone", (_event, _webContents, details) => {
    showUnresponsiveDialog(win, details);
  });

  win.once("ready-to-show", () => {
    if (config.get("options.appVisible")) {
      win.show();
    }
  });

  removeContentSecurityPolicy();

  win.webContents.on("dom-ready", () => {
    if (useInlineMenu && is.windows()) {
      win.setTitleBarOverlay({
        ...defaultTitleBarOverlayOptions,
        height: Math.floor(
          defaultTitleBarOverlayOptions.height! *
            win.webContents.getZoomFactor()
        ),
      });
    }
  });
  win.webContents.loadURL(urlToLoad);

  return win;
}

app.once("browser-window-created", (_event, win) => {
  if (config.get("options.overrideUserAgent")) {
    // User agents are from https://developers.whatismybrowser.com/useragents/explore/
    const originalUserAgent = win.webContents.userAgent;
    const userAgents = {
      linux:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.152 Safari/537.36",
      mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.152 Safari/537.36",
      windows:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.152 Safari/537.36",
    };

    const updatedUserAgent = is.macOS()
      ? userAgents.mac
      : is.windows()
        ? userAgents.windows
        : userAgents.linux;

    win.webContents.userAgent = updatedUserAgent;
    app.userAgentFallback = updatedUserAgent;

    win.webContents.session.webRequest.onBeforeSendHeaders((details, cb) => {
      // This will only happen if login failed, and "retry" was pressed
      if (
        win.webContents.getURL().startsWith("https://accounts.google.com") &&
        details.url.startsWith("https://accounts.google.com")
      ) {
        details.requestHeaders["User-Agent"] = originalUserAgent;
      }

      cb({ requestHeaders: details.requestHeaders });
    });
  }

  setupVideoInfo(win);
  setupAppControls();

  win.webContents.on(
    "did-fail-load",
    (
      _event,
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
      frameProcessId,
      frameRoutingId
    ) => {
      // -3 is ERR_ABORTED: the load was replaced (a redirect, or the dev server
      // reloading the page after optimizing dependencies). Logging it as a failure
      // in every dev run trains people to ignore the log.
      if (errorCode === -3) {
        return;
      }

      const log = JSON.stringify(
        {
          error: "did-fail-load",
          errorCode,
          errorDescription,
          frameProcessId,
          frameRoutingId,
          isMainFrame,
          validatedURL,
        },
        null,
        "\t"
      );
      if (is.dev()) {
        console.log(log);
      }

      if (
        errorCode !== -3 &&
        // A sub-frame that fails is not a failed page. YouTube loads its own
        // cookie-rotation frame (accounts.youtube.com/RotateCookiesPage) on every
        // visit, and it fails often enough that treating it as fatal replaced the
        // whole app with the error screen.
        isMainFrame &&
        // Workaround for #2435
        !URL.parse(validatedURL)?.hostname?.includes("doubleclick.net")
      ) {
        // -3 is a false positive
        win.webContents.send("log", log);
        win.webContents.loadFile(ErrorHtmlAsset);
      }
    }
  );

  win.webContents.on("will-prevent-unload", (event) => {
    event.preventDefault();
  });

  /**
   * A popup would be a second window carrying this app's preload - and so its IPC bridge - into a
   * page the app does not control. Links that want a window go to the browser instead, and only
   * `http(s)` is handed over: a page can name any scheme it likes.
   */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/u.test(url)) {
      void shell.openExternal(url);
    }

    return { action: "deny" };
  });

  /**
   * The window shows the site, the app's own error page, and nothing else. A page-initiated
   * navigation to `file://` (or any other scheme) would put a document of the page's choosing in
   * front of the preload's bridge.
   */
  win.webContents.on("will-navigate", (event, url) => {
    if (!/^https?:/u.test(url)) {
      event.preventDefault();
    }
  });

  // Every page sets its own title, and the site's is "YouTube" - not this app's name.
  // Keep the window titled after the app, unless a custom title is configured; the
  // config is re-read here so a change from the menu takes effect on the next
  // navigation instead of needing a restart.
  win.on("page-title-updated", (event) => {
    event.preventDefault();
    win.setTitle(config.get("options.customWindowTitle") || APPLICATION_NAME);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }

  // Unregister all shortcuts.
  globalShortcut.unregisterAll();
});

app.on("activate", async () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    mainWindow = await createMainWindow();
  } else if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
});

const getDefaultLocale = async (locale: string) =>
  Object.keys(await languageResources()).includes(locale) ? locale : null;

/**
 * `--remote-debugging-port` does not report a bind failure: with the port already taken by
 * another browser, the app starts without an endpoint and whoever owns the port answers on it -
 * which looks exactly like a working debugging setup until the tools drive the wrong browser.
 * The endpoint names its client, so ask it once the app is up and say which case this is.
 */
const reportRemoteDebugEndpoint = async (port: string) => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    const version = (await response.json()) as { "User-Agent"?: string };
    const agent = version["User-Agent"] ?? "";
    if (agent.includes(app.getName())) {
      console.log(
        `${LoggerPrefix} remote debugging ready on http://127.0.0.1:${port}`
      );
      return;
    }
    console.warn(
      `${LoggerPrefix} port ${port} answers, but not for this app (${agent || "unknown"}) - another browser owns it, so the app has no CDP endpoint; pass WATCHDECK_REMOTE_DEBUG=<free port>`
    );
  } catch {
    console.warn(
      `${LoggerPrefix} nothing answers on http://127.0.0.1:${port}: the port was taken before the app could bind it, or debugging is off`
    );
  }
};

app.whenReady().then(async () => {
  if (!config.get("options.language")) {
    const locale = await getDefaultLocale(app.getLocale());
    if (locale) {
      config.set("options.language", locale);
    }
  }

  await loadI18n().then(async () => {
    await setLanguage(config.get("options.language") ?? "en");
    console.log(LoggerPrefix, t("main.console.i18n.loaded"));
  });

  if (remoteDebugPort) {
    await reportRemoteDebugEndpoint(remoteDebugPort);
  }

  if (config.get("options.autoResetAppCache")) {
    // Clear cache after 20s
    const clearCacheTimeout = setTimeout(() => {
      if (is.dev()) {
        console.log(
          LoggerPrefix,
          t("main.console.when-ready.clearing-cache-after-20s")
        );
      }

      session.defaultSession.clearCache();
      clearTimeout(clearCacheTimeout);
    }, 20_000);
  }

  // Register appID on windows
  if (is.windows()) {
    const appID = "com.github.erikenz.watchdeck";
    app.setAppUserModelId(appID);
    const appLocation = process.execPath;
    const appData = app.getPath("appData");
    // Check shortcut validity if not in dev mode / running portable app
    if (
      !is.dev() &&
      !appLocation.startsWith(path.join(appData, "..", "Local", "Temp"))
    ) {
      const shortcutPath = path.join(
        appData,
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
        `${APPLICATION_NAME}.lnk`
      );
      try {
        // Check if shortcut is registered and valid
        const shortcutDetails = shell.readShortcutLink(shortcutPath); // Throw error if it doesn't exist yet
        if (
          shortcutDetails.target !== appLocation ||
          shortcutDetails.appUserModelId !== appID
        ) {
          // oxlint-disable-next-line typescript/only-throw-error
          throw "needUpdate";
        }
      } catch (error) {
        // If not valid -> Register shortcut
        shell.writeShortcutLink(
          shortcutPath,
          error === "needUpdate" ? "update" : "create",
          {
            appUserModelId: appID,
            cwd: path.dirname(appLocation),
            description: `${APPLICATION_NAME} Desktop App - including custom plugins`,
            target: appLocation,
          }
        );
      }
    }
  }

  ipcMain.on("get-renderer-script", (event) => {
    // Inject index.html file as string using insertAdjacentHTML
    // In dev mode, get string from process.env.VITE_DEV_SERVER_URL, else use fs.readFileSync
    if (is.dev() && process.env.ELECTRON_RENDERER_URL) {
      // HACK: to make vite work with electron renderer (supports hot reload)
      event.returnValue = [
        null,
        `
        console.log('${LoggerPrefix}', 'Loading vite from dev server');
        (async () => {
          await new Promise((resolve) => {
            if (document.readyState === 'loading') {
              console.log('${LoggerPrefix}', 'Waiting for DOM to load');
              document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
            } else {
              resolve();
            }
          });
          const viteScript = document.createElement('script');
          viteScript.type = 'module';
          viteScript.src = '${process.env.ELECTRON_RENDERER_URL}/@vite/client';
          const rendererScript = document.createElement('script');
          rendererScript.type = 'module';
          rendererScript.src = '${process.env.ELECTRON_RENDERER_URL}/renderer.ts';
          document.body.appendChild(viteScript);
          document.body.appendChild(rendererScript);
        })();
        0
      `,
      ];
    } else {
      const rendererPath = path.join(__dirname, "..", "renderer");
      const indexHTML = parse(
        fs.readFileSync(path.join(rendererPath, "index.html"), "utf-8")
      );
      const scriptSrc = indexHTML.querySelector("script")!;
      const scriptPath = path.join(
        rendererPath,
        scriptSrc.getAttribute("src")!
      );
      const scriptString = fs.readFileSync(scriptPath, "utf-8");
      event.returnValue = [
        url.pathToFileURL(scriptPath).toString(),
        `${scriptString};0`,
      ];
    }
  });

  mainWindow = await createMainWindow();
  await setApplicationMenu(mainWindow);
  await refreshMenu(mainWindow);
  setUpTray(app, mainWindow);

  setupProtocolHandler(mainWindow);

  app.on("second-instance", (_, commandLine) => {
    const uri = `${APP_PROTOCOL}://`;
    const protocolArgv = commandLine.find((arg) => arg.startsWith(uri));
    if (protocolArgv) {
      const lastIndex = protocolArgv.endsWith("/") ? -1 : undefined;
      const command = protocolArgv.slice(uri.length, lastIndex);
      if (is.dev()) {
        console.debug(
          LoggerPrefix,
          t("main.console.second-instance.receive-command", { command })
        );
      }

      const splited = decodeURIComponent(command).split(" ");

      handleProtocol(splited.shift()!, ...splited);
      return;
    }

    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }

    mainWindow.focus();
  });

  // Autostart at login
  app.setLoginItemSettings({
    openAtLogin: config.get("options.startAtLogin"),
  });

  // No update feed: the inherited auto-updater pointed at the upstream project's
  // GitHub releases and was removed in the P0 reset (docs/PRD.md §R8). Updates come
  // back once Watchdeck owns a signed feed — `options.autoUpdates` stays in the
  // config for that day.
  if (config.get("options.hideMenu") && !config.get("options.hideMenuWarned")) {
    dialog.showMessageBox(mainWindow, {
      message: t("main.dialog.hide-menu-enabled.message"),
      title: t("main.dialog.hide-menu-enabled.title"),
      type: "info",
    });
    config.set("options.hideMenuWarned", true);
  }

  // Optimized for Mac OS X
  if (is.macOS() && !config.get("options.appVisible")) {
    app.dock?.hide();
  }

  let forceQuit = false;
  app.on("before-quit", () => {
    forceQuit = true;
  });

  if (is.macOS() || config.get("options.tray")) {
    mainWindow.on("close", (event) => {
      // Hide the window instead of quitting (quit is available in tray options)
      if (!forceQuit) {
        event.preventDefault();
        mainWindow!.hide();
      }
    });
  }
});

function showUnresponsiveDialog(
  win: BrowserWindow,
  details: Electron.RenderProcessGoneDetails
) {
  if (details) {
    console.error(
      LoggerPrefix,
      t("main.console.unresponsive.details", {
        error: JSON.stringify(details, null, "\t"),
      })
    );
  }

  dialog
    .showMessageBox(win, {
      buttons: [
        t("main.dialog.unresponsive.buttons.wait"),
        t("main.dialog.unresponsive.buttons.relaunch"),
        t("main.dialog.unresponsive.buttons.quit"),
      ],
      cancelId: 0,
      detail: t("main.dialog.unresponsive.detail"),
      message: t("main.dialog.unresponsive.message"),
      title: t("main.dialog.unresponsive.title"),
      type: "error",
    })
    .then((result) => {
      switch (result.response) {
        case 1: {
          restart();
          break;
        }

        case 2: {
          app.quit();
          break;
        }
      }
    });
}

function removeContentSecurityPolicy(
  betterSession: BetterSession = session.defaultSession as BetterSession
) {
  // Allows defining multiple "onHeadersReceived" listeners
  // by enhancing the session.
  // Some plugins (e.g. adblocker) also define a "onHeadersReceived" listener
  enhanceWebRequest(betterSession);

  // Custom listener to tweak the content security policy
  betterSession.webRequest.onHeadersReceived((details, callback) => {
    details.responseHeaders ??= {};

    // prettier-ignore
    if (URL.parse(details.url)?.protocol === 'https:') {
      // Remove the content security policy
      delete details.responseHeaders['content-security-policy-report-only'];
      delete details.responseHeaders['Content-Security-Policy-Report-Only'];
      delete details.responseHeaders['content-security-policy'];
      delete details.responseHeaders['Content-Security-Policy'];

      if (
        !details.responseHeaders['access-control-allow-origin'] &&
        !details.responseHeaders['Access-Control-Allow-Origin']
      ) {
        details.responseHeaders['access-control-allow-origin'] = ['https://www.\u0079\u006F\u0075\u0074\u0075\u0062\u0065.com'];
      }
    }

    callback({ cancel: false, responseHeaders: details.responseHeaders });
  });

  // When multiple listeners are defined, apply them all
  betterSession.webRequest.setResolver(
    "onHeadersReceived",
    async (listeners) =>
      await listeners.reduce(
        async (accumulator, listener) => {
          const acc = await accumulator;
          if (acc.cancel) {
            return acc;
          }

          const result = await listener.apply();
          return { ...acc, ...result };
        },
        Promise.resolve({ cancel: false })
      )
  );
}
