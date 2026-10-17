/**
 * Getting SponsorBlock's release into the app, with the user's permission, and taking it out again
 * (docs/PRD.md §5.1).
 *
 * **Nothing may import this module except the plugin's `backend` and `menu` contexts.** A plugin's
 * `index.ts` is shared by every bundle, and the transform there drops an import only once nothing
 * in the file references it any more (`vite-plugins/plugin-loader.mts`), so a reference from the
 * page-reachable `renderer` half would pull `electron` and `node:*` into the page and kill the
 * injected script at evaluation.
 *
 * Two rules it exists to keep:
 *
 * 1. Nothing is downloaded before the user has agreed to it, and the agreement is remembered in
 *    the plugin's own config. Declining leaves the plugin off.
 * 2. There is no fallback: if the release cannot be installed, the user is told why and nothing
 *    else runs (the built-in client is a mode the user can choose, not a safety net).
 */
import { app, dialog, shell } from "electron";

import * as config from "@/config";
import type { ExtensionFailure } from "@/extensions/web-extension";
import { t } from "@/i18n";
import { LoggerPrefix } from "@/utils";

import {
  mountSponsorBlockExtension,
  sponsorBlockExtension,
  unmountSponsorBlockExtension,
} from "./extension";
import { sponsorBlockReleasePage } from "./links";

const PLUGIN_ID = "sponsorblock";

const log = (...message: unknown[]) => console.log(LoggerPrefix, ...message);
const logError = (...message: unknown[]) =>
  console.error(LoggerPrefix, ...message);

/** The page the consent dialog offers, for the release this app installs. */
const releasePage = sponsorBlockReleasePage(sponsorBlockExtension.pinnedTag);

let loadedExtensionId: string | null = null;
/** One install at a time: the plugin's start and a config change can both ask for one. */
let installing: Promise<void> | null = null;

const showMessageBox = (
  win: Electron.BrowserWindow,
  options: Electron.MessageBoxOptions
): Promise<Electron.MessageBoxReturnValue> =>
  win.isDestroyed()
    ? dialog.showMessageBox(options)
    : dialog.showMessageBox(win, options);

/**
 * The window is created hidden and shown once the page is up, so a dialog asked for during startup
 * would sit in front of a window nobody can see - and the app's own startup waits on plugins.
 * Waiting for the window is also the right moment: the user is there to answer.
 *
 * Two cases it has to survive. An app asked to start hidden in the tray waits for the first time
 * the window is opened, because a modal over the desktop at login is exactly what that setting is
 * about - and the plugin's own menu can start the download in the meantime. An app that intends to
 * show its window does not wait for ever: `ready-to-show` needs a paint, and a window that never
 * paints (started in the background, or a session without a compositor) would leave the plugin
 * silently inert with nothing asked and nothing said.
 */
const VISIBLE_WAIT_MS = 10_000;

const whenVisible = (win: Electron.BrowserWindow): Promise<void> => {
  if (win.isVisible()) {
    return Promise.resolve();
  }

  // Asked to start hidden in the tray: only the window being opened answers this.
  if (!config.get("options.appVisible")) {
    return new Promise((resolve) => {
      win.once("show", () => resolve());
    });
  }

  return new Promise((resolve) => {
    const onShown = () => {
      clearTimeout(timer);
      resolve();
    };

    // `onShown` runs later, so the timer it clears is already there.
    const timer = setTimeout(() => {
      win.removeListener("show", onShown);
      resolve();
    }, VISIBLE_WAIT_MS);

    win.once("show", onShown);
  });
};

/**
 * The first-use consent step. It keeps asking while the user reads the release page, and answers
 * `false` for anything that is not "download and enable" - the dialog's close button included.
 */
const askForConsent = async (win: Electron.BrowserWindow): Promise<boolean> => {
  for (;;) {
    const { response } = await showMessageBox(win, {
      buttons: [
        t("plugins.sponsorblock.consent.buttons.download"),
        t("plugins.sponsorblock.consent.buttons.release-page"),
        t("plugins.sponsorblock.consent.buttons.decline"),
      ],
      cancelId: 2,
      defaultId: 0,
      detail: t("plugins.sponsorblock.consent.detail", {
        tag: sponsorBlockExtension.pinnedTag,
        url: releasePage,
      }),
      message: t("plugins.sponsorblock.consent.message"),
      title: t("plugins.sponsorblock.consent.title"),
      type: "question",
    });

    if (response === 1) {
      void shell.openExternal(releasePage);
      continue;
    }

    return response === 0;
  }
};

/** The failure report, which answers whether the user wants another attempt. */
const reportFailure = async (
  win: Electron.BrowserWindow,
  failure: ExtensionFailure
): Promise<boolean> => {
  const { response } = await showMessageBox(win, {
    buttons: [
      t("plugins.sponsorblock.failed.buttons.retry"),
      t("plugins.sponsorblock.failed.buttons.close"),
    ],
    cancelId: 1,
    defaultId: 0,
    detail: t(`plugins.sponsorblock.failed.${failure}`),
    message: t("plugins.sponsorblock.failed.message", {
      tag: sponsorBlockExtension.pinnedTag,
      url: releasePage,
    }),
    title: t("plugins.sponsorblock.failed.title"),
    type: "error",
  });

  return response === 0;
};

/**
 * Reloads the page so a change of extension state is actually in effect - and only when there is a
 * page to reload. Neither startup (the site is still loading, or has not been asked for yet) nor a
 * mid-load page is touched: what those need is not a reload, it is the navigation they are already
 * making.
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

export interface InstallContext {
  /** What the user has already agreed to, read from the plugin's own config. */
  consentGiven: boolean;
  /**
   * Asked once the extension is in the session: the user may have switched to the built-in client
   * while the download was running, and two skippers would seek over each other.
   */
  stillWanted: () => boolean;
  window: Electron.BrowserWindow;
}

const install = async ({
  consentGiven,
  stillWanted,
  window: win,
}: InstallContext) => {
  if (!consentGiven) {
    await whenVisible(win);

    if (!(await askForConsent(win))) {
      log("SponsorBlock: the download was declined, so the plugin stays off");
      config.plugins.disable(PLUGIN_ID);

      // The menu was drawn with this plugin enabled, and nothing redraws it for a change no menu
      // item made. Imported here rather than at the top of the file on purpose: `@/menu` awaits
      // `config.plugins.isEnabled` at module scope, which reaches every plugin module through
      // `allPlugins()`, so a static import from a plugin is a cycle with a pending top-level await
      // - the main process never finishes starting and says nothing at all.
      const { refreshMenu } = await import("@/menu");
      await refreshMenu(win).catch(() => undefined);
      return;
    }

    config.plugins.setOptions(PLUGIN_ID, { consentGiven: true });
  }

  // The session's own storage path, which is where every other install lives; `userData` is the
  // answer for a session that has none, rather than a path relative to the working directory.
  const userDataDir =
    win.webContents.session.getStoragePath() ?? app.getPath("userData");

  for (;;) {
    const result = await mountSponsorBlockExtension(
      win.webContents.session,
      userDataDir
    );

    if (result.ok) {
      loadedExtensionId = result.id;
      log(
        `SponsorBlock: extension loaded (${result.id}, ${sponsorBlockExtension.pinnedTag})`
      );

      if (!stillWanted()) {
        unloadExtension(win);
        return;
      }

      reloadIfOnYoutube(win);
      return;
    }

    logError(
      `SponsorBlock: the extension could not be installed (${result.failure})`
    );

    if (!(await reportFailure(win, result.failure))) {
      return;
    }
  }
};

/**
 * Installs and loads the pinned release, asking for consent first when it has not been given. It
 * answers once the extension is loaded or the user has said no - and it does nothing at all when
 * one is already loaded, or when another call is already working on it.
 */
export const ensureExtensionLoaded = (
  context: InstallContext
): Promise<void> => {
  if (loadedExtensionId || installing) {
    return installing ?? Promise.resolve();
  }

  installing = install(context)
    .catch((error: unknown) => {
      logError("SponsorBlock: installing the extension failed", error);
    })
    .finally(() => {
      installing = null;
    });

  return installing;
};

/**
 * Takes the extension out of the session, if one is loaded, and reloads the page for it.
 */
export const unloadExtension = (win: Electron.BrowserWindow): void => {
  if (!loadedExtensionId) {
    return;
  }

  const id = loadedExtensionId;
  loadedExtensionId = null;

  if (!unmountSponsorBlockExtension(win.webContents.session, id)) {
    return;
  }

  log(`SponsorBlock: extension unloaded (${id})`);
  reloadIfOnYoutube(win);
};

/** Whether the release is in this session, which is what the plugin's menu reports. */
export const isExtensionLoaded = (): boolean => loadedExtensionId !== null;
