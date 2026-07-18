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
  async putFile(key, bytes) { const r = await this.fetcher(`${this.base}/_storage/files/${encodeURIComponent(key)}`, { method: "PUT", body: bytes }); if (!r.ok) throw new Error(`storage_error:${r.status}`); return r.json(); }
  async getFile(key) { const r = await this.fetcher(`${this.base}/_storage/files/${encodeURIComponent(key)}`); if (r.status === 404) return null; if (!r.ok) throw new Error(`storage_error:${r.status}`); return new Uint8Array(await r.arrayBuffer()); }
  async listFiles() { const r = await this.fetcher(`${this.base}/_storage/files`); if (!r.ok) throw new Error(`storage_error:${r.status}`); return (await r.json()).keys; }
  async deleteFile(key) { const r = await this.fetcher(`${this.base}/_storage/files/${encodeURIComponent(key)}`, { method: "DELETE" }); if (!r.ok) throw new Error(`storage_error:${r.status}`); return r.json(); }
}
export function currentUser(headers) {
  const get = (k) => (typeof headers.get === "function" ? headers.get(k) : headers[k]) || "";
  return { email: get("x-forwarded-user"), groups: get("x-forwarded-groups").split(",").map((s) => s.trim()).filter(Boolean) };
}
