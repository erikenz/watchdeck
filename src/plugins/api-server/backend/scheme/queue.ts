import { z } from "@hono/zod-openapi";

export const QueueParamsSchema = z.object({
  index: z.coerce.number().int().nonnegative(),
});

export const AddSongToQueueSchema = z.object({
  insertPosition: z
    .enum(["INSERT_AT_END", "INSERT_AFTER_CURRENT_VIDEO"])
    .optional()
    .default("INSERT_AT_END"),
  videoId: z.string(),
});
export const MoveSongInQueueSchema = z.object({
  toIndex: z.number(),
});
export const SetQueueIndexSchema = z.object({
  index: z.number().int().nonnegative(),
});
