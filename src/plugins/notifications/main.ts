import { Notification } from "electron";
import is from "electron-is";

import { registerCallback, VideoInfoEvent } from "@/providers/video-info";
import type { BackendContext } from "@/types/contexts";
import type { VideoInfo } from "@/types/video-info";

import type { NotificationsPluginConfig } from "./index";
import interactive from "./interactive";
import { notificationImage } from "./utils";

let config: NotificationsPluginConfig;

const notify = (info: VideoInfo) => {
  // Send the notification
  const currentNotification = new Notification({
    body: info.channel,
    icon: notificationImage(info, config),
    silent: true,
    title: info.title || "Playing",
    urgency: config.urgency,
  });
  currentNotification.show();

  return currentNotification;
};

const setup = () => {
  let oldNotification: Notification;
  let currentUrl: string | undefined;

  registerCallback((songInfo: VideoInfo, event) => {
    if (
      event !== VideoInfoEvent.TimeChanged &&
      !songInfo.isPaused &&
      (songInfo.url !== currentUrl || config.unpauseNotification)
    ) {
      // Close the old notification
      oldNotification?.close();
      currentUrl = songInfo.url;
      // This fixes a weird bug that would cause the notification to be updated instead of showing
      setTimeout(() => {
        oldNotification = notify(songInfo);
      }, 10);
    }
  });
};

export const onMainLoad = async (
  context: BackendContext<NotificationsPluginConfig>
) => {
  config = await context.getConfig();

  // Register the callback for new song information
  if (is.windows() && config.interactive) {
    interactive(context.window, () => config, context);
  } else {
    setup();
  }
};

export const onConfigChange = (newConfig: NotificationsPluginConfig) => {
  config = newConfig;
};
