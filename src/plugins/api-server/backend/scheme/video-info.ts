import { z } from "@hono/zod-openapi";

export type ResponseVideoInfo = z.infer<typeof VideoInfoSchema>;
/**
 * The video the app is showing, as the HTTP API reports it. It mirrors
 * {@link VideoInfo} without the native thumbnail (`image`), which is a main-process
 * object.
 *
 * The route path keeps its historical `song-info` name: it is a client-facing contract,
 * and renaming it belongs to this plugin's own rework (docs/PRD.md §R5).
 */
export const VideoInfoSchema = z.object({
  channel: z.string(),
  channelId: z.string().optional(),
  channelUrl: z.string().optional(),
  duration: z.number(),
  elapsedSeconds: z.number(),
  imageSrc: z.string().optional(),
  isLive: z.boolean().optional(),
  isMuted: z.boolean(),
  isPaused: z.boolean(),
  playlistId: z.string().optional(),
  title: z.string(),
  uploadDate: z.string().optional(),
  url: z.string().optional(),
  videoId: z.string(),
  views: z.number().optional(),
  volume: z.number(),
});
