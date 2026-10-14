export class Storage {
  constructor(opts = {}) {
    this.base = opts.base || process.env.INNO_STORAGE_BASE || "http://storage.internal";
    this.fetcher = opts.fetcher || fetch;
  }
  async _post(path, body) {
    const r = await this.fetcher(`${this.base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`storage_error:${r.status}`);
    return r.json();
  }
  async query(sql, params = []) { return (await this._post("/_storage/sql/query", { sql, params })).results; }
  async execute(sql, params = []) { return this._post("/_storage/sql/execute", { sql, params }); }
  // Cross-app data links (APP-CONTRACT §2.1): the linked source app's D1,
  // available only after the owner created the link and the app redeployed.
  async queryLinked(sourceApp, sql, params = []) { return (await this._post(`/_storage/linked/${encodeURIComponent(sourceApp)}/sql/query`, { sql, params })).results; }
  async executeLinked(sourceApp, sql, params = []) { return this._post(`/_storage/linked/${encodeURIComponent(sourceApp)}/sql/execute`, { sql, params }); }
  async putFile(key, bytes) { const r = await this.fetcher(`${this.base}/_storage/files/${encodeURIComponent(key)}`, { method: "PUT", body: bytes }); if (!r.ok) throw new Error(`storage_error:${r.status}`); return r.json(); }
  async getFile(key) { const r = await this.fetcher(`${this.base}/_storage/files/${encodeURIComponent(key)}`); if (r.status === 404) return null; if (!r.ok) throw new Error(`storage_error:${r.status}`); return new Uint8Array(await r.arrayBuffer()); }
  // The keys, as an ordinary array that also carries `truncated`: true when the
  // gateway stopped listing at its cap (APP-CONTRACT R5), so the keys are only part
  // of the bucket. Track keys in D1 rather than walk a bucket that size. The flag
  // is not enumerable, so deep equality, for...in and JSON see only the keys.
  async listFiles() { const r = await this.fetcher(`${this.base}/_storage/files`); if (!r.ok) throw new Error(`storage_error:${r.status}`); const out = await r.json(); return Object.defineProperty(out.keys, "truncated", { value: out.truncated === true, enumerable: false, writable: true, configurable: true }); }
  async deleteFile(key) { const r = await this.fetcher(`${this.base}/_storage/files/${encodeURIComponent(key)}`, { method: "DELETE" }); if (!r.ok) throw new Error(`storage_error:${r.status}`); return r.json(); }
}
export function currentUser(headers) {
  const get = (k) => (typeof headers.get === "function" ? headers.get(k) : headers[k]) || "";
  return { email: get("x-forwarded-user"), groups: get("x-forwarded-groups").split(",").map((s) => s.trim()).filter(Boolean) };
}

export class NotConnected extends Error {
  constructor(connectUrl) {
    super(`not connected: open ${connectUrl} to link your account`);
    this.name = "NotConnected";
    this.connectUrl = connectUrl;
    // The same value under the name APP-CONTRACT §2.2 and the Python client use.
    this.connect_url = connectUrl;
  }
}

export class ConnectionLocked extends NotConnected {
  constructor(connectUrl) {
    super(connectUrl);
    this.name = "ConnectionLocked";
    this.message = "connection locked: re-authorize this app in your MCP client (in Claude: /mcp, then re-authenticate it), then try again";
  }
}

// A failed seam call: `status` is the HTTP status and `code` the answer's
// `error` code (null when the body carried none). APP-CONTRACT §2.2 says which
// codes are the app's to fix and which mean retry later. The message is
// `connections_error:<status>`, as it was before the code was kept.
export class ConnectionsError extends Error {
  constructor(status, code) {
    super(`connections_error:${status}`);
    this.name = "ConnectionsError";
    this.status = status;
    this.code = code;
  }
}

// Per-user backend credentials (APP-CONTRACT §2.2). `callerAssertion` is the
// value of THIS request's inbound `X-Caller-Assertion` header: the app must
// echo it (identity rides only that platform-signed token). Returns a live
// credential ({ access_token } or { header }). Throws NotConnected(connectUrl),
// which the app relays to the user; ConnectionLocked, a NotConnected the user
// fixes by re-authorizing the MCP client; or ConnectionsError for any other
// failed seam call.
export class Connections {
  constructor(opts = {}) {
    this.base = opts.base || process.env.INNO_STORAGE_BASE || "http://storage.internal";
    this.fetcher = opts.fetcher || fetch;
  }
  async get(name, callerAssertion) {
    const r = await this.fetcher(`${this.base}/_connections/${name}`, {
      method: "POST",
      headers: { "X-Caller-Assertion": callerAssertion || "" },
    });
    if (!r.ok) {
      let code = null;
      try { const body = await r.json(); if (body && typeof body.error === "string") code = body.error; } catch {}
      throw new ConnectionsError(r.status, code);
    }
    const out = await r.json();
    if (out.status === "not_connected") {
      throw out.locked ? new ConnectionLocked(out.connect_url) : new NotConnected(out.connect_url);
    }
    return { access_token: out.access_token, header: out.header, expires_at: out.expires_at };
  }
}
