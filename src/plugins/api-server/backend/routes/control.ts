import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";

import { getVideoControls } from "@/providers/video-controls";
import type { BackendContext } from "@/types/contexts";
import type { VideoInfo } from "@/types/video-info";

import type { APIServerConfig } from "../../config";
import { API_VERSION } from "../api-version";
import {
  GoBackSchema,
  GoForwardScheme,
  SeekSchema,
  SetFullscreenSchema,
  SetVolumeSchema,
  VideoInfoSchema,
} from "../scheme";
import type { ResponseVideoInfo } from "../scheme";
import type { HonoApp } from "../types";

const routes = {
  getFullscreenState: createRoute({
    method: "get",
    path: `/api/${API_VERSION}/fullscreen`,
    summary: "get fullscreen state",
    description: "Get the current fullscreen state",
    responses: {
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: z.object({
              state: z.boolean(),
            }),
          },
        },
      },
    },
  }),
  getVolumeState: createRoute({
    method: "get",
    path: `/api/${API_VERSION}/volume`,
    summary: "get volume state",
    description: "Get the current volume state of the player",
    responses: {
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: z.object({
              state: z.number(),
              isMuted: z.boolean(),
            }),
          },
        },
      },
    },
  }),
  goBack: createRoute({
    method: "post",
    path: `/api/${API_VERSION}/go-back`,
    summary: "go back",
    description: "Move the current song back by a number of seconds",
    request: {
      body: {
        description: "seconds to go back",
        content: {
          "application/json": {
            schema: GoBackSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: "Success",
      },
    },
  }),
  goForward: createRoute({
    method: "post",
    path: `/api/${API_VERSION}/go-forward`,
    summary: "go forward",
    description: "Move the current song forward by a number of seconds",
    request: {
      body: {
        description: "seconds to go forward",
        content: {
          "application/json": {
            schema: GoForwardScheme,
          },
        },
      },
    },
    responses: {
      204: {
        description: "Success",
      },
    },
  }),
  next: createRoute({
    method: "post",
    path: `/api/${API_VERSION}/next`,
    summary: "play next song",
    description: "Plays the next song in the queue",
    responses: {
      204: {
        description: "Success",
      },
    },
  }),
  nextSongInfo: createRoute({
    method: "get",
    path: `/api/${API_VERSION}/queue/next`,
    summary: "get next song info",
    description:
      "Get information about the next song in the queue (relative index +1)",
    responses: {
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: VideoInfoSchema,
          },
        },
      },
      204: {
        description: "No next song in queue",
      },
    },
  }),
  oldSongInfo: createRoute({
    deprecated: true,
    method: "get",
    path: `/api/${API_VERSION}/song-info`,
    summary: "get current song info",
    description: "Get the current song info",
    responses: {
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: VideoInfoSchema,
          },
        },
      },
      204: {
        description: "No song info",
      },
    },
  }),
  pause: createRoute({
    method: "post",
    path: `/api/${API_VERSION}/pause`,
    summary: "Pause",
    description: "Change the state of the player to pause",
    responses: {
      204: {
        description: "Success",
      },
    },
  }),
  play: createRoute({
    method: "post",
    path: `/api/${API_VERSION}/play`,
    summary: "Play",
    description: "Change the state of the player to play",
    responses: {
      204: {
        description: "Success",
      },
    },
  }),
  previous: createRoute({
    method: "post",
    path: `/api/${API_VERSION}/previous`,
    summary: "play previous song",
    description: "Plays the previous song in the queue",
    responses: {
      204: {
        description: "Success",
      },
    },
  }),
  seekTo: createRoute({
    method: "post",
    path: `/api/${API_VERSION}/seek-to`,
    summary: "seek",
    description: "Seek to a specific time in the current song",
    request: {
      body: {
        description: "seconds to seek to",
        content: {
          "application/json": {
            schema: SeekSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: "Success",
      },
    },
  }),
  setFullscreen: createRoute({
    method: "post",
    path: `/api/${API_VERSION}/fullscreen`,
    summary: "set fullscreen",
    description: "Set the fullscreen state of the player",
    request: {
      body: {
        description: "fullscreen state",
        content: {
          "application/json": {
            schema: SetFullscreenSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: "Success",
      },
    },
  }),
  setVolume: createRoute({
    method: "post",
    path: `/api/${API_VERSION}/volume`,
    summary: "set volume",
    description: "Set the volume of the player",
    request: {
      body: {
        description: "volume to set",
        content: {
          "application/json": {
            schema: SetVolumeSchema,
          },
        },
      },
    },
    responses: {
      204: {
        description: "Success",
      },
    },
  }),
  songInfo: createRoute({
    method: "get",
    path: `/api/${API_VERSION}/song`,
    summary: "get current song info",
    description: "Get the current song info",
    responses: {
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: VideoInfoSchema,
          },
        },
      },
      204: {
        description: "No song info",
      },
    },
  }),
  toggleMute: createRoute({
    method: "post",
    path: `/api/${API_VERSION}/toggle-mute`,
    summary: "toggle mute",
    description: "Toggle the mute state of the player",
    responses: {
      204: {
        description: "Success",
      },
    },
  }),
  togglePlay: createRoute({
    method: "post",
    path: `/api/${API_VERSION}/toggle-play`,
    summary: "Toggle play/pause",
    description:
      "Change the state of the player to play if paused, or pause if playing",
    responses: {
      204: {
        description: "Success",
      },
    },
  }),
};

type PromiseOrValue<T> = T | Promise<T>;

export const register = (
  app: HonoApp,
  { window }: BackendContext<APIServerConfig>,
  songInfoGetter: () => PromiseOrValue<VideoInfo | undefined>,
  volumeStateGetter: () => PromiseOrValue<
    | {
        isMuted: boolean;
        state: number;
      }
    | undefined
  >
) => {
  const controller = getVideoControls(window);

  app.openapi(routes.previous, (ctx) => {
    controller.previous();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.next, (ctx) => {
    controller.next();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.play, (ctx) => {
    controller.play();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.pause, (ctx) => {
    controller.pause();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.togglePlay, (ctx) => {
    controller.playPause();

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.seekTo, (ctx) => {
    const { seconds } = ctx.req.valid("json");
    controller.seekTo(seconds);

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.goBack, (ctx) => {
    const { seconds } = ctx.req.valid("json");
    controller.goBack(seconds);

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.goForward, (ctx) => {
    const { seconds } = ctx.req.valid("json");
    controller.goForward(seconds);

    ctx.status(204);
    return ctx.body(null);
  });

  app.openapi(routes.setVolume, (ctx) => {
    const { volume } = ctx.req.valid("json");
    controller.setVolume(volume);

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.getVolumeState, async (ctx) => {
    ctx.status(200);
    return ctx.json(
      (await volumeStateGetter()) ?? { isMuted: false, state: 0 }
    );
  });
  app.openapi(routes.setFullscreen, (ctx) => {
    const { state } = ctx.req.valid("json");
    window.setFullScreen(state);

    ctx.status(204);
    return ctx.body(null);
  });
  app.openapi(routes.toggleMute, (ctx) => {
    controller.muteUnmute();

    ctx.status(204);
    return ctx.body(null);
  });

  app.openapi(routes.getFullscreenState, (ctx) => {
    ctx.status(200);
    return ctx.json({ state: window.isFullScreen() });
  });

  const songInfo = async (ctx: Context) => {
    const info = await songInfoGetter();

    if (!info) {
      ctx.status(204);
      return ctx.body(null);
    }

    const body = { ...info };
    delete body.image;

    ctx.status(200);
    return ctx.json(body satisfies ResponseVideoInfo);
  };
  app.openapi(routes.oldSongInfo, songInfo);
  app.openapi(routes.songInfo, songInfo);
};
