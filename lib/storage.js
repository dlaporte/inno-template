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
  // Cross-app data links (APP-CONTRACT §2.1): the linked source app's D1 and
  // its files, reachable once the owner has created the link and the platform
  // has bound it to this app (its next deploy or restart, or a platform release).
  async queryLinked(sourceApp, sql, params = []) { return (await this._post(`/_storage/linked/${encodeURIComponent(sourceApp)}/sql/query`, { sql, params })).results; }
  async executeLinked(sourceApp, sql, params = []) { return this._post(`/_storage/linked/${encodeURIComponent(sourceApp)}/sql/execute`, { sql, params }); }
  async putLinkedFile(sourceApp, key, bytes) { const r = await this.fetcher(`${this.base}/_storage/linked/${encodeURIComponent(sourceApp)}/files/${encodeURIComponent(key)}`, { method: "PUT", body: bytes }); if (!r.ok) throw new Error(`storage_error:${r.status}`); return r.json(); }
  // Null only for a key the source's bucket lacks: the linked route answers 404
  // for a source with no deployed link too (not_linked), which throws.
  async getLinkedFile(sourceApp, key) { const r = await this.fetcher(`${this.base}/_storage/linked/${encodeURIComponent(sourceApp)}/files/${encodeURIComponent(key)}`); if (r.status === 404 && (await errorCode(r)) === "not_found") return null; if (!r.ok) throw new Error(`storage_error:${r.status}`); return new Uint8Array(await r.arrayBuffer()); }
  async listLinkedFiles(sourceApp) { return this._listing(`/_storage/linked/${encodeURIComponent(sourceApp)}/files`); }
  async deleteLinkedFile(sourceApp, key) { const r = await this.fetcher(`${this.base}/_storage/linked/${encodeURIComponent(sourceApp)}/files/${encodeURIComponent(key)}`, { method: "DELETE" }); if (!r.ok) throw new Error(`storage_error:${r.status}`); return r.json(); }
  async putFile(key, bytes) { const r = await this.fetcher(`${this.base}/_storage/files/${encodeURIComponent(key)}`, { method: "PUT", body: bytes }); if (!r.ok) throw new Error(`storage_error:${r.status}`); return r.json(); }
  async getFile(key) { const r = await this.fetcher(`${this.base}/_storage/files/${encodeURIComponent(key)}`); if (r.status === 404) return null; if (!r.ok) throw new Error(`storage_error:${r.status}`); return new Uint8Array(await r.arrayBuffer()); }
  async listFiles() { return this._listing("/_storage/files"); }
  async deleteFile(key) { const r = await this.fetcher(`${this.base}/_storage/files/${encodeURIComponent(key)}`, { method: "DELETE" }); if (!r.ok) throw new Error(`storage_error:${r.status}`); return r.json(); }
  // The keys, as an ordinary array that also carries `truncated`: true when the
  // platform stopped listing at its cap (APP-CONTRACT R5), so the keys are only part
  // of the bucket. Track keys in D1 rather than walk a bucket that size. The flag
  // is not enumerable, so deep equality, for...in and JSON see only the keys.
  async _listing(path) { const r = await this.fetcher(`${this.base}${path}`); if (!r.ok) throw new Error(`storage_error:${r.status}`); const out = await r.json(); return Object.defineProperty(out.keys, "truncated", { value: out.truncated === true, enumerable: false, writable: true, configurable: true }); }
}

// The `error` code a failed storage answer carries, or null when its body has none.
async function errorCode(r) {
  try { const body = await r.json(); return body && typeof body.error === "string" ? body.error : null; } catch { return null; }
}

// Headers for serving a stored file back to a browser (APP-SECURITY §3): always
// a download, never rendered, so an uploaded HTML or SVG file cannot run script
// on the site. Each character of the name outside A-Z, a-z, 0-9, ".", "_" and
// "-" becomes "_", so the name cannot leave its quotes or the header line.
export function fileDownloadHeaders(filename) {
  const safe = String(filename).replace(/[^A-Za-z0-9._-]/gu, "_");
  return {
    "Content-Disposition": `attachment; filename="${safe}"`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
  };
}
// The caller, or null when the request carries no identity (the platform's
// health probe, or a local run without the headers). Never default the absence
// into a value: code that needs a person handles null first. `subject` is the
// caller's identity provider ID, null when the header is empty or missing; a
// subject alone never makes a user.
export function currentUser(headers) {
  const get = (k) => (typeof headers.get === "function" ? headers.get(k) : headers[k]) || "";
  const email = get("x-forwarded-user").trim();
  if (!email) return null;
  const groups = get("x-forwarded-groups").split(",").map((s) => s.trim()).filter(Boolean);
  const subject = get("x-forwarded-subject").trim() || null;
  return { email, groups, member: groups.some((g) => g.endsWith("-users")), subject };
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
      throw new ConnectionsError(r.status, await errorCode(r));
    }
    const out = await r.json();
    if (out.status === "not_connected") {
      throw out.locked ? new ConnectionLocked(out.connect_url) : new NotConnected(out.connect_url);
    }
    return { access_token: out.access_token, header: out.header, expires_at: out.expires_at };
  }
}
