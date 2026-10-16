import type {
  WatchLaterEntry,
  WatchLaterQuery,
  WatchLaterState,
  WatchLaterSyncProgress,
} from "../../types";

/** Everything the in-page UI may ask for; the renderer fills it in from its IPC context. */
export interface WatchLaterBridge {
  add: (videoId: string) => Promise<{ ok: boolean; error?: string }>;
  onChanged: (listener: (state: WatchLaterState) => void) => void;
  onProgress: (listener: (progress: WatchLaterSyncProgress) => void) => void;
  query: (query: WatchLaterQuery) => Promise<WatchLaterEntry[]>;
  remove: (videoId: string) => Promise<{ ok: boolean; error?: string }>;
  state: () => Promise<WatchLaterState>;
  sync: () => Promise<WatchLaterState>;
}
