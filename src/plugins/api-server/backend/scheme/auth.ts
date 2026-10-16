import { z } from "@hono/zod-openapi";

export type JWTPayload = z.infer<typeof JWTPayloadSchema>;
export const JWTPayloadSchema = z.object({
  iat: z.number(),
  id: z.string(),
});
