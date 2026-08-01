export interface StorageOptions {
  base?: string;
  fetcher?: (url: string, init?: any) => Promise<Response>;
}

export interface CurrentUserResult {
  email: string;
  groups: string[];
}

export class Storage {
  constructor(opts?: StorageOptions);
  query(sql: string, params?: unknown[]): Promise<unknown[]>;
  execute(sql: string, params?: unknown[]): Promise<unknown>;
  queryLinked(sourceApp: string, sql: string, params?: unknown[]): Promise<unknown[]>;
  executeLinked(sourceApp: string, sql: string, params?: unknown[]): Promise<unknown>;
  putFile(key: string, bytes: unknown): Promise<unknown>;
  getFile(key: string): Promise<Uint8Array | null>;
  listFiles(): Promise<string[]>;
  deleteFile(key: string): Promise<unknown>;
}

export function currentUser(headers: Record<string, string> | Headers): CurrentUserResult;

export interface ConnectionsOptions {
  base?: string;
  fetcher?: (url: string, init?: any) => Promise<Response>;
}

export interface ConnectionCredential {
  access_token?: string;
  header?: { name: string; value: string };
  expires_at?: string | null;
}

export class Connections {
  constructor(opts?: ConnectionsOptions);
  get(name: string, callerAssertion: string): Promise<ConnectionCredential>;
}

export class NotConnected extends Error {
  constructor(connectUrl: string);
  connectUrl: string;
}
