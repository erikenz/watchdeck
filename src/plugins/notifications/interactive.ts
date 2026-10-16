import nextIcon from "@assets/media-icons-black/next.png?asset&asarUnpack";
import pauseIcon from "@assets/media-icons-black/pause.png?asset&asarUnpack";
import playIcon from "@assets/media-icons-black/play.png?asset&asarUnpack";
import previousIcon from "@assets/media-icons-black/previous.png?asset&asarUnpack";
import { app, Notification } from "electron";
import type { BrowserWindow } from "electron";

import {
  APP_PROTOCOL,
  changeProtocolHandler,
} from "@/providers/protocol-handler";
import { getVideoControls } from "@/providers/video-controls";
import { registerCallback, VideoInfoEvent } from "@/providers/video-info";
import { setTrayOnClick, setTrayOnDoubleClick } from "@/tray";
import type { BackendContext } from "@/types/contexts";
import { mediaIcons } from "@/types/media-icons";
import type { VideoInfo } from "@/types/video-info";

import type { NotificationsPluginConfig } from "./index";
import { notificationImage, secondsToMinutes, ToastStyles } from "./utils";

let videoControls: ReturnType<typeof getVideoControls>;
let savedNotification: Notification | undefined;

type Accessor<T> = () => T;

export default (
  win: BrowserWindow,
  config: Accessor<NotificationsPluginConfig>,
  { ipc: { on, send } }: BackendContext<NotificationsPluginConfig>
) => {
  const sendNotification = (songInfo: VideoInfo) => {
    const iconSrc = notificationImage(songInfo, config());

    savedNotification?.close();

    let icon: string;
    if (typeof iconSrc === "object") {
      icon = iconSrc.toDataURL();
    } else {
      icon = iconSrc;
    }

    savedNotification = new Notification({
      title: songInfo.title || "Playing",
      body: songInfo.channel,
      icon: iconSrc,
      silent: true,
      // https://learn.microsoft.com/en-us/uwp/schemas/tiles/toastschema/schema-root
      // https://learn.microsoft.com/en-us/windows/apps/design/shell/tiles-and-notifications/toast-schema
      // https://learn.microsoft.com/en-us/windows/apps/design/shell/tiles-and-notifications/adaptive-interactive-toasts?tabs=xml
      // https://learn.microsoft.com/en-us/uwp/api/windows.ui.notifications.toasttemplatetype
      toastXml: getXml(songInfo, icon),
    });

    // To fix the notification not closing
    setTimeout(() => savedNotification?.close(), 5000);

    savedNotification.on("close", () => {
      savedNotification = undefined;
    });

    savedNotification.show();
  };

  const getXml = (songInfo: VideoInfo, iconSrc: string) => {
    switch (config().toastStyle) {
      default:
      case ToastStyles.logo:
      case ToastStyles.legacy: {
        return xmlLogo(songInfo, iconSrc);
      }

      case ToastStyles.banner_top_custom: {
        return xmlBannerTopCustom(songInfo, iconSrc);
      }

      case ToastStyles.hero: {
        return xmlHero(songInfo, iconSrc);
      }

      case ToastStyles.banner_bottom: {
        return xmlBannerBottom(songInfo, iconSrc);
      }

      case ToastStyles.banner_centered_bottom: {
        return xmlBannerCenteredBottom(songInfo, iconSrc);
      }

      case ToastStyles.banner_centered_top: {
        return xmlBannerCenteredTop(songInfo, iconSrc);
      }
    }
  };

  const selectIcon = (kind: keyof typeof mediaIcons): string => {
    switch (kind) {
      case "play": {
        return playIcon;
      }
      case "pause": {
        return pauseIcon;
      }
      case "next": {
        return nextIcon;
      }
      case "previous": {
        return previousIcon;
      }
      default: {
        return "";
      }
    }
  };

  const display = (kind: keyof typeof mediaIcons) => {
    if (config().toastStyle === ToastStyles.legacy) {
      return `content="${mediaIcons[kind]}"`;
    }

    return `\
            content="${
              config().toastStyle
                ? ""
                : kind.charAt(0).toUpperCase() + kind.slice(1)
            }"\
            imageUri="file:///${selectIcon(kind)}"
        `;
  };

  const getButton = (kind: keyof typeof mediaIcons) =>
    `<action ${display(
      kind
    )} activationType="protocol" arguments="${APP_PROTOCOL}://${kind}"/>`;

  const getButtons = (isPaused: boolean) => `\
    <actions>
        ${getButton("previous")}
        ${isPaused ? getButton("play") : getButton("pause")}
        ${getButton("next")}
    </actions>\
`;

  const toast = (content: string, isPaused: boolean) => `\
<toast>
    <audio silent="true" />
    <visual>
        <binding template="ToastGeneric">
            ${content}
        </binding>
    </visual>

    ${getButtons(isPaused)}
</toast>`;

  const xmlImage = (
    { title, channel, isPaused }: VideoInfo,
    imgSrc: string,
    placement: string
  ) =>
    toast(
      `\
            <image id="1" src="${imgSrc}" name="Image" ${placement}/>
            <text id="1">${title}</text>
            <text id="2">${channel}</text>\
`,
      isPaused ?? false
    );

  const xmlLogo = (songInfo: VideoInfo, imgSrc: string) =>
    xmlImage(songInfo, imgSrc, 'placement="appLogoOverride"');

  const xmlHero = (songInfo: VideoInfo, imgSrc: string) =>
    xmlImage(songInfo, imgSrc, 'placement="hero"');

  const xmlBannerBottom = (songInfo: VideoInfo, imgSrc: string) =>
    xmlImage(songInfo, imgSrc, "");

  const xmlBannerTopCustom = (songInfo: VideoInfo, imgSrc: string) =>
    toast(
      `\
            <image id="1" src="${imgSrc}" name="Image" />
            <text>ㅤ</text>
            <group>
                <subgroup>
                    <text hint-style="body">${songInfo.title}</text>
                    <text hint-style="captionSubtle">${songInfo.channel}</text>
                </subgroup>
                ${xmlMoreData(songInfo)}
            </group>\
`,
      songInfo.isPaused ?? false
    );

  const xmlMoreData = ({ elapsedSeconds, duration }: VideoInfo) => `\
<subgroup hint-textStacking="bottom">
    <text hint-style="captionSubtle" hint-wrap="true" hint-align="right">${secondsToMinutes(
      elapsedSeconds ?? 0
    )} / ${secondsToMinutes(duration)}</text>
</subgroup>\
`;

  const xmlBannerCenteredBottom = (
    { title, channel, isPaused }: VideoInfo,
    imgSrc: string
  ) =>
    toast(
      `\
            <text>ㅤ</text>
            <group>
                <subgroup hint-weight="1" hint-textStacking="center">
                    <text hint-align="center" hint-style="${titleFontPicker(
                      title
                    )}">${title}</text>
                    <text hint-align="center" hint-style="SubtitleSubtle">${channel}</text>
                </subgroup>
            </group>
            <image id="1" src="${imgSrc}" name="Image"  hint-removeMargin="true" />\
`,
      isPaused ?? false
    );

  const xmlBannerCenteredTop = (
    { title, channel, isPaused }: VideoInfo,
    imgSrc: string
  ) =>
    toast(
      `\
            <image id="1" src="${imgSrc}" name="Image" />
            <text>ㅤ</text>
            <group>
                <subgroup hint-weight="1" hint-textStacking="center">
                    <text hint-align="center" hint-style="${titleFontPicker(
                      title
                    )}">${title}</text>
                    <text hint-align="center" hint-style="SubtitleSubtle">${channel}</text>
                </subgroup>
            </group>\
`,
      isPaused ?? false
    );

  const titleFontPicker = (title: string) => {
    if (title.length <= 13) {
      return "Header";
    }

    if (title.length <= 22) {
      return "Subheader";
    }

    if (title.length <= 26) {
      return "Title";
    }

    return "Subtitle";
  };

  videoControls = getVideoControls(win);

  let currentSeconds = 0;
  on("watchdeck:player-api-loaded", () => {
    send("watchdeck:setup-time-changed-listener");
  });

  let savedSongInfo: VideoInfo;
  let lastUrl: string | undefined;

  // Register songInfoCallback
  registerCallback((songInfo, event) => {
    if (event === VideoInfoEvent.TimeChanged) {
      currentSeconds = songInfo.elapsedSeconds ?? 0;
    }
    if (!songInfo.channel && !songInfo.title) {
      return;
    }

    savedSongInfo = { ...songInfo };
    if (
      !songInfo.isPaused &&
      (songInfo.url !== lastUrl || config().unpauseNotification)
    ) {
      lastUrl = songInfo.url;
      sendNotification(songInfo);
    }
  });

  if (config().trayControls) {
    setTrayOnClick(() => {
      if (savedNotification) {
        savedNotification.close();
        savedNotification = undefined;
      } else if (savedSongInfo) {
        sendNotification({
          ...savedSongInfo,
          elapsedSeconds: currentSeconds,
        });
      }
    });

    setTrayOnDoubleClick(() => {
      if (win.isVisible()) {
        win.hide();
      } else {
        win.show();
      }
    });
  }

  app.once("before-quit", () => {
    savedNotification?.close();
  });

  changeProtocolHandler((cmd, ...args) => {
    if (Object.keys(videoControls).includes(cmd)) {
      // @ts-expect-error: cmd is a key of videoControls
      videoControls[cmd as keyof typeof videoControls](...args);
      if (
        config().refreshOnPlayPause &&
        (cmd === "pause" || (cmd === "play" && !config().unpauseNotification))
      ) {
        setImmediate(() => {
          sendNotification({
            ...savedSongInfo,
            elapsedSeconds: currentSeconds,
            isPaused: cmd === "pause",
          });
        });
      }
    }
  });
};
