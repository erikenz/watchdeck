import { z } from '@hono/zod-openapi';

import { MediaType } from '@/providers/song-info';

export type ResponseSongInfo = z.infer<typeof SongInfoSchema>;
export const SongInfoSchema = z.object({
  album: z.string().nullable().optional(),
  artist: z.string(),
  elapsedSeconds: z.number().optional(),
  imageSrc: z.string().nullable().optional(),
  isPaused: z.boolean().optional(),
  mediaType: z.enum([
    MediaType.Audio,
    MediaType.OriginalMusicVideo,
    MediaType.UserGeneratedContent,
    MediaType.PodcastEpisode,
    MediaType.OtherVideo,
  ]),
  playlistId: z.string().optional(),
  songDuration: z.number(),
  title: z.string(),
  uploadDate: z.string().optional(),
  url: z.string().optional(),
  videoId: z.string(),
  views: z.number(),
});
