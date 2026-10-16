/**
 * The page's entry point: this bundle is injected into the site's main world, where it
 * wires the player providers to the plugin host.
 *
 * It is deliberately thin - everything this app knows about the site lives in
 * `providers/youtube-dom` and the `video-info` / `video-controls` pairs. What is left
 * here is the plugin lifecycle and the page-level styling hooks the plugins rely on.
 */
import i18next from "i18next";
import { setTheme } from "mdui/functions/setTheme.js";

import "mdui/mdui.css";
import "mdui";

import { loadI18n, setLanguage, t as i18t } from "@/i18n";
import { setupVideoControls } from "@/providers/video-controls-front";
import { bindPlayer, setupVideoInfo } from "@/providers/video-info-front";
import { getPlayer } from "@/providers/youtube-dom";
import type { MusicPlayer } from "@/types/music-player";
import type { PluginConfig } from "@/types/plugins";
import type { YouTubePlayer } from "@/types/youtube-player";
import {
  defaultTrustedTypePolicy,
  registerWindowDefaultTrustedTypePolicy,
} from "@/utils/trusted-types";

import {
  createContext,
  forceLoadRendererPlugin,
  forceUnloadRendererPlugin,
  getAllLoadedRendererPlugins,
  getLoadedRendererPlugin,
  loadAllRendererPlugins,
} from "./loader/renderer";

setTheme("dark");
registerWindowDefaultTrustedTypePolicy();

let api: (Element & MusicPlayer) | null = null;
let isPluginLoaded = false;
let firstDataLoaded = false;

/**
 * The plugin API still hands plugins the wide, inherited `MusicPlayer` view of the
 * player (docs/PRD.md §R5 reworks the plugins that use it). The element underneath is
 * the same one this app's own providers drive.
 */
const onApiLoaded = async (player: Element & YouTubePlayer) => {
  const pluginApi = player as unknown as Element & MusicPlayer;
  api = pluginApi;

  // A plugin enabled after this point gets a synthetic `dataloaded` below
  player.addEventListener("videodatachange", (name) => {
    if (name === "dataloaded") {
      firstDataLoaded = true;
    }
  });

  // Workaround for macOS traffic lights
  {
    let osType = "Unknown";
    if (window.electronIs.osx()) {
      osType = "Macintosh";
    } else if (window.electronIs.windows()) {
      osType = "Windows";
    } else if (window.electronIs.linux()) {
      osType = "Linux";
    }
    document.documentElement.dataset.os = osType;
  }

  for (const [id, plugin] of Object.entries(getAllLoadedRendererPlugins())) {
    if (typeof plugin.renderer !== "function") {
      await plugin.renderer?.onPlayerApiReady?.call(
        plugin.renderer,
        pluginApi,
        createContext(id)
      );
    }
  }

  if (firstDataLoaded) {
    document.dispatchEvent(
      new CustomEvent("videodatachange", { detail: { name: "dataloaded" } })
    );
  }

  window.ipcRenderer.send("watchdeck:player-api-loaded");
};

const defineWdTransElements = () => {
  customElements.define(
    "wd-trans",
    class extends HTMLElement {
      connectedCallback() {
        const key = this.getAttribute("key");
        if (key) {
          const targetHtml = i18t(key);
          (this.innerHTML as string | TrustedHTML) = defaultTrustedTypePolicy
            ? defaultTrustedTypePolicy.createHTML(targetHtml)
            : targetHtml;
        }
      }
    }
  );
};

const preload = async () => {
  await loadI18n();
  await setLanguage(window.mainConfig.get("options.language") ?? "en");
  window.i18n = {
    t: i18t.bind(i18next),
  };
  defineWdTransElements();
  if (document.body?.dataset?.os) {
    document.body.dataset.os = navigator.userAgent;
  }
};

const main = async () => {
  await loadAllRendererPlugins();
  isPluginLoaded = true;

  window.ipcRenderer.on("plugin:unload", async (_event, id: string) => {
    await forceUnloadRendererPlugin(id);
  });
  window.ipcRenderer.on("plugin:enable", async (_event, id: string) => {
    await forceLoadRendererPlugin(id);
    if (api) {
      const plugin = getLoadedRendererPlugin(id);
      if (plugin && typeof plugin.renderer !== "function") {
        await plugin.renderer?.onPlayerApiReady?.call(
          plugin.renderer,
          api,
          createContext(id)
        );
      }
    }
  });

  window.ipcRenderer.on(
    "config-changed",
    (_event, id: string, newConfig: PluginConfig) => {
      const plugin = getAllLoadedRendererPlugins()[id];
      if (plugin && typeof plugin.renderer !== "function") {
        plugin.renderer?.onConfigChange?.call(plugin.renderer, newConfig);
      }
    }
  );

  setupVideoInfo();
  setupVideoControls();

  // Setup back to front logger
  if (window.electronIs.dev()) {
    window.ipcRenderer.on("log", (_event, log: string) => {
      console.log(JSON.parse(log));
    });
  }
};

/**
 * Waits for the site to mount its player, then starts the plugins that need it.
 *
 * The site creates the player on the first video and keeps it afterwards, so this
 * runs once; the `video-info` provider follows later replacements on its own.
 */
const initObserver = async () => {
  await new Promise<void>((resolve) => {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => resolve(), {
        once: true,
      });
    } else {
      resolve();
    }
  });

  const observer = new MutationObserver(() => {
    if (api) {
      observer.disconnect();
      return;
    }

    const player = getPlayer();
    if (!player) {
      return;
    }

    bindPlayer();

    if (!isPluginLoaded) {
      // The plugins are still loading; keep watching and wire up after
      return;
    }

    observer.disconnect();
    void onApiLoaded(player);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
};

initObserver().then(preload).then(main);
