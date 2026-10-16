export enum AuthStrategy {
  AUTH_AT_FIRST = 'AUTH_AT_FIRST',
  NONE = 'NONE',
}

export interface APIServerConfig {
  enabled: boolean;
  hostname: string;
  port: number;
  authStrategy: AuthStrategy;
  secret: string;

  authorizedClients: string[];
  useHttps: boolean;
  certPath: string;
  keyPath: string;
}

export const defaultAPIServerConfig: APIServerConfig = {
  authStrategy: AuthStrategy.AUTH_AT_FIRST,
  authorizedClients: [],
  certPath: '',
  enabled: false,
  hostname: '0.0.0.0',
  keyPath: '',
  port: 26538,
  secret: Date.now().toString(36),
  useHttps: false,
};
