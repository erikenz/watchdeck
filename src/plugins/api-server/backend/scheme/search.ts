import { z } from '@hono/zod-openapi';

export const SearchSchema = z.object({
  continuation: z.string().optional(),
  params: z.string().optional(),
  query: z.string(),
});
