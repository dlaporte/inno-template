export interface StorageOptions {
  base?: string;
  fetcher?: (url: string, init?: any) => Promise<Response>;
}

export interface CurrentUserResult {
  email: string;
  groups: string[];
  member: boolean;
  subject: string | null;
}

// The keys, an ordinary array, plus `truncated`: true when the platform stopped
// listing at its cap, so the keys are only part of the bucket.
export type FileListing = string[] & { truncated: boolean };

export class Storage {
  constructor(opts?: StorageOptions);
  query(sql: string, params?: unknown[]): Promise<unknown[]>;
  execute(sql: string, params?: unknown[]): Promise<unknown>;
  queryLinked(sourceApp: string, sql: string, params?: unknown[]): Promise<unknown[]>;
  executeLinked(sourceApp: string, sql: string, params?: unknown[]): Promise<unknown>;
  putFile(key: string, bytes: unknown): Promise<unknown>;
  getFile(key: string): Promise<Uint8Array | null>;
  listFiles(): Promise<FileListing>;
  deleteFile(key: string): Promise<unknown>;
}

export function currentUser(headers: Record<string, string> | Headers): CurrentUserResult | null;

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
  // The same value under the name APP-CONTRACT §2.2 and the Python client use.
  connect_url: string;
}

export class ConnectionLocked extends NotConnected {
  constructor(connectUrl: string);
}

export class ConnectionsError extends Error {
  constructor(status: number, code: string | null);
  status: number;
  // The answer's `error` code, or null when the body carried none.
  code: string | null;
}
