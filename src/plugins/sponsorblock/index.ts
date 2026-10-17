import { t } from "@/i18n";
import type { GetPlayerResponse } from "@/types/get-player-response";
import { createPlugin, LoggerPrefix } from "@/utils";

import {
  mountSponsorBlockExtension,
  unmountSponsorBlockExtension,
} from "./extension";
import { sortSegments } from "./segments";
import type { Segment, SkipSegment } from "./types";

/**
 * SponsorBlock (docs/PRD.md §5.1, R2).
 *
 * Two ways to get it, and the config says which: the official extension release loaded at
 * runtime (`mode: "extension"`, the shipping path once the spike passed) or our own client
 * against the public API (`mode: "native"`, kept as the fallback). Only one of them may run -
 * two skippers would seek over each other.
 *
 * Both can be switched at runtime, without a restart. What a switch cannot do is reach a page
 * that is already loaded: content scripts arrive with a navigation, and taking the extension
 * away leaves what it already injected running. So a change of state reloads the page (see
 * `reloadIfOnYoutube`) rather than pretending the toggle did nothing.
 */
export interface SponsorBlockPluginConfig {
  enabled: boolean;
  /** `extension` loads the official release; `native` is our own client. */
  mode: "extension" | "native";
  /** Fetch a newer extension release when one is published. */
  autoUpdate: boolean;
  apiURL: string;
  categories: (
    | "sponsor"
    | "intro"
    | "outro"
    | "interaction"
    | "selfpromo"
    | "music_offtopic"
  )[];
}

let currentSegments: Segment[] = [];
let loadedExtensionId: string | null = null;
/** The two bundles (main, renderer) each keep their own copy of this module. */
let backendMode: SponsorBlockPluginConfig["mode"] | null = null;
let rendererMode: SponsorBlockPluginConfig["mode"] | null = null;
let pluginConfig: SponsorBlockPluginConfig | null = null;
let pluginWindow: Electron.BrowserWindow | null = null;
let nativeRequestsRegistered = false;

const log = (...message: unknown[]) => console.log(LoggerPrefix, ...message);
const logError = (...message: unknown[]) =>
  console.error(LoggerPrefix, ...message);

const resetSegments = () => {
  currentSegments = [];
};

/** Our own client's skip: the extension does its own, so this only runs in native mode. */
const onTimeUpdate = (event: Event) => {
  if (
    rendererMode !== "native" ||
    !(event.target instanceof HTMLVideoElement)
  ) {
    return;
  }

  const video = event.target;

  for (const segment of currentSegments) {
    if (video.currentTime >= segment[0] && video.currentTime < segment[1]) {
      video.currentTime = segment[1];

      if (window.electronIs.dev()) {
        log("SponsorBlock: skipping segment", segment);
      }
    }
  }
};

/** Our own client's skipping, attached to the page's media element. */
const attachNativeSkipping = () => {
  const video = document.querySelector<HTMLVideoElement>("video");

  if (rendererMode !== "native" || !video) {
    detachNativeSkipping();
    return;
  }

  video.addEventListener("timeupdate", onTimeUpdate);
  // A fresh video starts with no segments until the backend answers
  video.addEventListener("emptied", resetSegments);
};

const detachNativeSkipping = () => {
  const video = document.querySelector<HTMLVideoElement>("video");

  if (!video) {
    return;
  }

  video.removeEventListener("timeupdate", onTimeUpdate);
  video.removeEventListener("emptied", resetSegments);
};

const fetchSegments = async (
  apiURL: string,
  categories: string[],
  videoId: string
) => {
  const sponsorBlockURL = `${apiURL}/api/skipSegments?videoID=${videoId}&categories=${JSON.stringify(
    categories
  )}`;
  try {
    const resp = await fetch(sponsorBlockURL, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      redirect: "follow",
    });
    if (resp.status !== 200) {
      return [];
    }

    const segments = (await resp.json()) as SkipSegment[];
    return sortSegments(segments.map((submission) => submission.segment));
  } catch (error) {
    // The 404 that means "this video has no segments" is answered above; getting here is a
    // network failure, which is worth saying out loud. Not gated on a dev check: the check
    // itself (`electron-is`) is a CommonJS module that has no business in a page, and the
    // plugin's page half shares this file.
    logError("SponsorBlock: request failed", error);

    return [];
  }
};

/**
 * Reloads the page so a change of extension state is actually in effect - and only when there
 * is a page to reload. Neither startup (the site is still loading, or has not been asked for
 * yet) nor a mid-load page is touched: what those need is not a reload, it is the navigation
 * they are already making.
 */
const reloadIfOnYoutube = (win: Electron.BrowserWindow) => {
  const isLoading = win.webContents.isLoading();
  const url = win.webContents.getURL();

  if (win.isDestroyed() || isLoading || !url.includes("youtube.com")) {
    return;
  }

  win.webContents.reload();
  log("SponsorBlock: reloaded the page for the new setting");
};

export default createPlugin<
  unknown,
  unknown,
  unknown,
  SponsorBlockPluginConfig
>({
  backend: {
    async start({ getConfig, ipc, window }) {
      pluginWindow = window;
      pluginConfig = await getConfig();
      backendMode = pluginConfig.mode;

      if (!nativeRequestsRegistered) {
        // Registered once for the life of the app: `ipcMain.on` has no matching off, and a
        // toggle-off/on pair would otherwise stack a second copy of this listener. The mode
        // is read per request instead.
        nativeRequestsRegistered = true;
        ipc.on(
          "watchdeck:video-src-changed",
          async (data: GetPlayerResponse) => {
            if (backendMode !== "native" || !pluginConfig) {
              return;
            }

            const segments = await fetchSegments(
              pluginConfig.apiURL,
              pluginConfig.categories,
              data?.videoDetails?.videoId
            );
            ipc.send("sponsorblock-skip", segments);
          }
        );
      }

      if (backendMode === "extension") {
        // Inline on purpose. The plugin transform strips this context out of the bundles a page
        // gets and then drops the imports nothing else references - a module-level helper would
        // keep the extension loader in the page's module graph, where its `node:*` imports throw
        // the moment the module is evaluated.
        const userDataDir = window.webContents.session.getStoragePath();
        const id = userDataDir
          ? await mountSponsorBlockExtension(
              window.webContents.session,
              userDataDir,
              { autoUpdate: pluginConfig.autoUpdate }
            )
          : null;

        if (id) {
          loadedExtensionId = id;
          log(`SponsorBlock: extension loaded (${id})`);
          reloadIfOnYoutube(window);
        } else {
          logError(
            "SponsorBlock: no extension on disk and none could be downloaded"
          );
        }
      }
    },
    onConfigChange(newConfig) {
      pluginConfig = newConfig;
      backendMode = newConfig.mode;
      const win = pluginWindow;

      if (!win || win.isDestroyed()) {
        return;
      }

      // Only reached while the plugin is enabled - switching it off goes through `stop`.
      if (newConfig.mode === "extension" && !loadedExtensionId) {
        const userDataDir = win.webContents.session.getStoragePath();

        void mountSponsorBlockExtension(
          win.webContents.session,
          userDataDir ?? "",
          { autoUpdate: newConfig.autoUpdate }
        ).then((id) => {
          if (id) {
            loadedExtensionId = id;
            log(`SponsorBlock: extension loaded (${id})`);
            reloadIfOnYoutube(win);
          } else {
            logError(
              "SponsorBlock: no extension on disk and none could be downloaded"
            );
          }
        });
        return;
      }

      if (newConfig.mode !== "extension" && loadedExtensionId) {
        const id = loadedExtensionId;
        loadedExtensionId = null;

        if (unmountSponsorBlockExtension(win.webContents.session, id)) {
          log(`SponsorBlock: extension unloaded (${id})`);
          reloadIfOnYoutube(win);
        }
      }
    },
    stop({ window }) {
      if (!loadedExtensionId) {
        return;
      }

      const id = loadedExtensionId;
      loadedExtensionId = null;

      if (unmountSponsorBlockExtension(window.webContents.session, id)) {
        log(`SponsorBlock: extension unloaded (${id})`);
        reloadIfOnYoutube(window);
      }
    },
  },
  config: {
    apiURL: "https://sponsor.ajay.app",
    autoUpdate: true,
    categories: [
      "sponsor",
      "intro",
      "outro",
      "interaction",
      "selfpromo",
      "music_offtopic",
    ],
    enabled: false,
    mode: "extension",
  },
  description: () => t("plugins.sponsorblock.description"),
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();

    return [
      {
        checked: config.mode === "extension",
        click() {
          void setConfig({ mode: "extension" });
        },
        label: t("plugins.sponsorblock.menu.mode-extension"),
        type: "radio" as const,
      },
      {
        checked: config.mode === "native",
        click() {
          void setConfig({ mode: "native" });
        },
        label: t("plugins.sponsorblock.menu.mode-native"),
        type: "radio" as const,
      },
      { type: "separator" as const },
      {
        checked: config.autoUpdate,
        click(item: Electron.MenuItem) {
          void setConfig({ autoUpdate: item.checked });
        },
        label: t("plugins.sponsorblock.menu.auto-update"),
        type: "checkbox" as const,
      },
    ];
  },
  name: () => t("plugins.sponsorblock.name"),
  renderer: {
    onPlayerApiReady() {
      attachNativeSkipping();
    },
    async start({ getConfig, ipc }) {
      rendererMode = (await getConfig()).mode;

      ipc.on("sponsorblock-skip", (segments: Segment[]) => {
        if (rendererMode === "native") {
          currentSegments = segments;
        }
      });

      attachNativeSkipping();
    },
    onConfigChange(newConfig) {
      if (rendererMode === newConfig.mode) {
        return;
      }

      rendererMode = newConfig.mode;
      attachNativeSkipping();
    },
    stop({ ipc }) {
      rendererMode = null;
      detachNativeSkipping();
      ipc.removeAllListeners("sponsorblock-skip");
    },
  },
  // Enabling and disabling both work on the session at runtime; the page is reloaded instead
  // (see `reloadIfOnYoutube`).
  restartNeeded: false,
});
