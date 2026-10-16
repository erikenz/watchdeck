import path from "node:path";

import { app } from "electron";
import type { BrowserWindow } from "electron";

import { getVideoControls } from "./video-controls";

export const APP_PROTOCOL = "watchdeck";

let protocolHandler: ((cmd: string, ...args: string[]) => void) | undefined;

export function setupProtocolHandler(win: BrowserWindow) {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  } else {
    app.setAsDefaultProtocolClient(APP_PROTOCOL);
  }

  const videoControls = getVideoControls(win);

  protocolHandler = ((cmd: keyof typeof videoControls, ...args) => {
    if (Object.keys(videoControls).includes(cmd)) {
      // @ts-expect-error: cmd is a key of videoControls
      videoControls[cmd](...args);
    }
  }) as (cmd: string, ...args: string[]) => void;
}

export function handleProtocol(cmd: string, ...args: string[]) {
  protocolHandler?.(cmd, ...args);
}

export function changeProtocolHandler(
  f: (cmd: string, ...args: string[]) => void
) {
  protocolHandler = f;
}
