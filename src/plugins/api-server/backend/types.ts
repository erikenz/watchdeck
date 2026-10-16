import type { serve } from "@hono/node-server";
import type { OpenAPIHono as Hono } from "@hono/zod-openapi";

import type { BackendContext } from "@/types/contexts";
import type { VideoInfo } from "@/types/video-info";

import type { APIServerConfig } from "../config";

export type HonoApp = Hono;
export interface BackendType {
  app?: HonoApp;
  server?: ReturnType<typeof serve>;
  oldConfig?: APIServerConfig;
  songInfo?: VideoInfo;
  volumeState?: { isMuted: boolean; state: number };

  init: (ctx: BackendContext<APIServerConfig>) => void;
  run: (config: APIServerConfig) => void;
  end: () => void;
}
