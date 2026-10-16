// This is used for to control the songs
import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';

import { LikeType } from '@/types/datahost-get-state';

// see protocol-handler.ts
type ArgsType<T> = T | string[] | undefined;

const parseNumberFromArgsType = (args: ArgsType<number>) => {
  if (typeof args === 'number') {
    return args;
  } else if (Array.isArray(args)) {
    return Number(args[0]);
  }
  return null;
};

const parseBooleanFromArgsType = (args: ArgsType<boolean>) => {
  if (typeof args === 'boolean') {
    return args;
  } else if (Array.isArray(args)) {
    return args[0] === 'true';
  }
  return null;
};

const parseStringFromArgsType = (args: ArgsType<string>) => {
  if (typeof args === 'string') {
    return args;
  } else if (Array.isArray(args)) {
    return args[0];
  }
  return null;
};

export const getSongControls = (win: BrowserWindow) => ({
  // Playback
  previous: () => {
    win.webContents.send('watchdeck:previous-video');
  },
  next: () => {
    win.webContents.send('watchdeck:next-video');
  },
  play: () => {
    win.webContents.send('watchdeck:play');
  },
  pause: () => {
    win.webContents.send('watchdeck:pause');
  },
  playPause: () => {
    win.webContents.send('watchdeck:toggle-play');
  },
  like: () => {
    win.webContents.send('watchdeck:update-like', LikeType.Like);
  },
  dislike: () => {
    win.webContents.send('watchdeck:update-like', LikeType.Dislike);
  },
  seekTo: (seconds: ArgsType<number>) => {
    const secondsNumber = parseNumberFromArgsType(seconds);
    if (secondsNumber !== null) {
      win.webContents.send('watchdeck:seek-to', seconds);
    }
  },
  goBack: (seconds: ArgsType<number>) => {
    const secondsNumber = parseNumberFromArgsType(seconds);
    if (secondsNumber !== null) {
      win.webContents.send('watchdeck:seek-by', -secondsNumber);
    }
  },
  goForward: (seconds: ArgsType<number>) => {
    const secondsNumber = parseNumberFromArgsType(seconds);
    if (secondsNumber !== null) {
      win.webContents.send('watchdeck:seek-by', seconds);
    }
  },
  requestShuffleInformation: () => {
    win.webContents.send('watchdeck:get-shuffle');
  },
  shuffle: () => {
    win.webContents.send('watchdeck:shuffle');
  },
  switchRepeat: (n: ArgsType<number> = 1) => {
    const repeat = parseNumberFromArgsType(n);
    if (repeat !== null) {
      win.webContents.send('watchdeck:switch-repeat', n);
    }
  },
  // General
  setVolume: (volume: ArgsType<number>) => {
    const volumeNumber = parseNumberFromArgsType(volume);
    if (volumeNumber !== null) {
      win.webContents.send('watchdeck:update-volume', volume);
    }
  },
  setFullscreen: (isFullscreen: ArgsType<boolean>) => {
    const isFullscreenValue = parseBooleanFromArgsType(isFullscreen);
    if (isFullscreenValue !== null) {
      win.setFullScreen(isFullscreenValue);
      win.webContents.send(
        'watchdeck:click-fullscreen-button',
        isFullscreenValue,
      );
    }
  },
  requestFullscreenInformation: () => {
    win.webContents.send('watchdeck:get-fullscreen');
  },
  requestQueueInformation: () => {
    win.webContents.send('watchdeck:get-queue');
  },
  muteUnmute: () => {
    win.webContents.send('watchdeck:toggle-mute');
  },
  openSearchBox: () => {
    win.webContents.sendInputEvent({
      type: 'keyDown',
      keyCode: '/',
    });
  },
  // Queue
  addSongToQueue: (videoId: string, queueInsertPosition: string) => {
    const videoIdValue = parseStringFromArgsType(videoId);
    if (videoIdValue === null) return;

    win.webContents.send(
      'watchdeck:add-to-queue',
      videoIdValue,
      queueInsertPosition,
    );
  },
  moveSongInQueue: (fromIndex: ArgsType<number>, toIndex: ArgsType<number>) => {
    const fromIndexValue = parseNumberFromArgsType(fromIndex);
    const toIndexValue = parseNumberFromArgsType(toIndex);
    if (fromIndexValue === null || toIndexValue === null) return;

    win.webContents.send(
      'watchdeck:move-in-queue',
      fromIndexValue,
      toIndexValue,
    );
  },
  removeSongFromQueue: (index: ArgsType<number>) => {
    const indexValue = parseNumberFromArgsType(index);
    if (indexValue === null) return;

    win.webContents.send('watchdeck:remove-from-queue', indexValue);
  },
  setQueueIndex: (index: ArgsType<number>) => {
    const indexValue = parseNumberFromArgsType(index);
    if (indexValue === null) return;

    win.webContents.send('watchdeck:set-queue-index', indexValue);
  },
  clearQueue: () => {
    win.webContents.send('watchdeck:clear-queue');
  },

  search: async (query: string, params?: string, continuation?: string) =>
    new Promise((resolve) => {
      ipcMain.once('watchdeck:search-results', (_, result) => {
        resolve(result as string);
      });
      win.webContents.send('watchdeck:search', query, params, continuation);
    }),
});
