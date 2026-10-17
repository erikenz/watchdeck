import { shell } from "electron";

import { t } from "@/i18n";
import type { GetPlayerResponse } from "@/types/get-player-response";
import { createPlugin, LoggerPrefix } from "@/utils";

import {
  ensureExtensionLoaded,
  isExtensionLoaded,
  unloadExtension,
} from "./install";
import { SPONSOR_BLOCK_REPOSITORY } from "./links";
import { sortSegments } from "./segments";
import type { Segment, SkipSegment } from "./types";

/**
 * SponsorBlock (docs/PRD.md §5.1, R2).
 *
 * Two ways to get it, and the config says which: the official extension release loaded at runtime
 * (`mode: "extension"`, the shipping path once the spike passed) or our own client against the
 * public API (`mode: "native"`). Only one of them may run - two skippers would seek over each
 * other.
 *
 * The extension is downloaded, never bundled: it is GPL-3.0 code, this app is MIT, and the user
 * has to agree to the download before it happens (see `./install.ts`, which owns that flow). There
 * is no automatic fallback to the built-in client: if the release cannot be installed, the user is
 * told why and nothing skips.
 *
 * Both modes can be switched at runtime, without a restart. What a switch cannot do is reach a page
 * that is already loaded: content scripts arrive with a navigation, and taking the extension
 * away leaves what it already injected running. So a change of state reloads the page (see
 * `reloadIfOnYoutube`) rather than pretending the toggle did nothing.
 */
export interface SponsorBlockPluginConfig {
  enabled: boolean;
  /**
   * The user's agreement to download the official release. Nothing is fetched without it, and
   * declining leaves the plugin off.
   */
  consentGiven: boolean;
  /** `extension` loads the official release; `native` is our own client. */
  mode: "extension" | "native";
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
        void ensureExtensionLoaded({
          consentGiven: pluginConfig.consentGiven,
          stillWanted: () => pluginConfig?.mode === "extension",
          window,
        });
      }
    },
    onConfigChange(newConfig) {
      pluginConfig = newConfig;
      backendMode = newConfig.mode;
      const win = pluginWindow;

      if (!win || win.isDestroyed()) {
        return;
      }

      // Only reached while the plugin is enabled - switching it off goes through `stop`. Both
      // calls do nothing when there is nothing to do: the install is skipped while one is
      // loaded, and the unload while none is.
      if (newConfig.mode === "extension") {
        void ensureExtensionLoaded({
          consentGiven: newConfig.consentGiven,
          stillWanted: () => pluginConfig?.mode === "extension",
          window: win,
        });
        return;
      }

      unloadExtension(win);
    },
    stop({ window }) {
      unloadExtension(window);
    },
  },
  config: {
    apiURL: "https://sponsor.ajay.app",
    categories: [
      "sponsor",
      "intro",
      "outro",
      "interaction",
      "selfpromo",
      "music_offtopic",
    ],
    consentGiven: false,
    enabled: false,
    mode: "extension",
  },
  description: () => t("plugins.sponsorblock.description"),
  menu: async ({ getConfig, setConfig, window }) => {
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
      // Shown while there is nothing to skip with: the release has not been installed yet (the
      // first run, a download that failed, or an app that started hidden and has not asked). The
      // state is otherwise invisible, which is how a plugin ends up looking broken.
      ...(config.mode === "extension" && !isExtensionLoaded()
        ? [
            { type: "separator" as const },
            {
              click() {
                void ensureExtensionLoaded({
                  consentGiven: config.consentGiven,
                  stillWanted: () => pluginConfig?.mode === "extension",
                  window,
                });
              },
              label: config.consentGiven
                ? t("plugins.sponsorblock.menu.install-again")
                : t("plugins.sponsorblock.menu.install"),
            },
          ]
        : []),
      { type: "separator" as const },
      {
        click() {
          void shell.openExternal(SPONSOR_BLOCK_REPOSITORY);
        },
        label: t("plugins.sponsorblock.menu.about"),
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
  // (see `./install.ts`).
  restartNeeded: false,
});
