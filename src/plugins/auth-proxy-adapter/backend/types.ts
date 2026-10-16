import type { Server } from "node:http";
import type { Server as NodeServer, Socket as NodeSocket } from "node:net";

import type { AuthProxyConfig } from "../config";

export interface BackendType {
  server?: Server | NodeServer;
  oldConfig?: AuthProxyConfig;
  startServer: (serverConfig: AuthProxyConfig) => void;
  stopServer: () => void;
  handleSocks5: (
    clientSocket: NodeSocket,
    chunk: Buffer,
    upstreamProxyUrl: string
  ) => void;
  processSocks5Request: (
    clientSocket: NodeSocket,
    data: Buffer,
    upstreamProxyUrl: string
  ) => void;
}
