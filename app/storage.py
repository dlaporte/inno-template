import os
from urllib.parse import quote

import httpx


class FileList(list):
    """The keys of a listing, an ordinary list, plus `truncated`.

    `truncated` is True when the gateway stopped listing at its cap (APP-CONTRACT R5),
    so the keys are only part of the bucket. Track keys in D1 rather than walk a
    bucket that size.
    """

    truncated: bool = False


class Storage:
    def __init__(self, base: str | None = None, client: httpx.AsyncClient | None = None):
        self.base = base or os.environ.get("INNO_STORAGE_BASE", "http://storage.internal")
        self.client = client

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        if self.client is not None:
            return await self.client.request(method, f"{self.base}{path}", **kwargs)
        async with httpx.AsyncClient() as c:
            return await c.request(method, f"{self.base}{path}", **kwargs)

    async def _post(self, path: str, body: dict):
        r = await self._request("POST", path, json=body)
        r.raise_for_status()
        return r.json()

    async def query(self, sql: str, params: list | None = None):
        return (await self._post("/_storage/sql/query", {"sql": sql, "params": params or []}))["results"]

    async def execute(self, sql: str, params: list | None = None):
        return await self._post("/_storage/sql/execute", {"sql": sql, "params": params or []})

    # Cross-app data links (APP-CONTRACT §2.1): the linked source app's D1,
    # available only after the owner created the link and the app redeployed.
    async def query_linked(self, source_app: str, sql: str, params: list | None = None):
        path = f"/_storage/linked/{quote(source_app, safe='')}/sql/query"
        return (await self._post(path, {"sql": sql, "params": params or []}))["results"]

    async def execute_linked(self, source_app: str, sql: str, params: list | None = None):
        path = f"/_storage/linked/{quote(source_app, safe='')}/sql/execute"
        return await self._post(path, {"sql": sql, "params": params or []})

    async def put_file(self, key: str, data: bytes):
        r = await self._request("PUT", f"/_storage/files/{quote(key, safe='')}", content=data)
        r.raise_for_status()
        return r.json()

    async def get_file(self, key: str) -> bytes | None:
        r = await self._request("GET", f"/_storage/files/{quote(key, safe='')}")
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.content

    async def list_files(self) -> FileList:
        r = await self._request("GET", "/_storage/files")
        r.raise_for_status()
        out = r.json()
        keys = FileList(out["keys"])
        keys.truncated = out.get("truncated") is True
        return keys

    async def delete_file(self, key: str):
        r = await self._request("DELETE", f"/_storage/files/{quote(key, safe='')}")
        r.raise_for_status()
        return r.json()


def current_user(request) -> dict:
    h = request.headers
    groups = [g.strip() for g in h.get("x-forwarded-groups", "").split(",") if g.strip()]
    return {"email": h.get("x-forwarded-user", ""), "groups": groups}


class NotConnected(Exception):
    def __init__(self, connect_url: str):
        super().__init__(f"not connected: open {connect_url} to link your account")
        self.connect_url = connect_url


class ConnectionLocked(NotConnected):
    """The credential exists, but this MCP client's grant cannot open it: re-authorize the client, do not reconnect the backend."""

    def __init__(self, connect_url: str):
        super().__init__(connect_url)
        self.args = ("connection locked: re-authorize this app in your MCP client (in Claude: /mcp, then re-authenticate it), then try again",)


class ConnectionsError(httpx.HTTPStatusError):
    """A failed seam call: `status` is the HTTP status and `code` the answer's `error` code (None when the body carried none).

    APP-CONTRACT §2.2 says which codes are the app's to fix and which mean retry later.
    It is an httpx.HTTPStatusError, the error this call raised before the code was
    kept, so an existing `except httpx.HTTPStatusError` still catches it.
    """

    def __init__(self, response: httpx.Response, code: str | None):
        super().__init__(f"connections_error:{response.status_code}", request=response.request, response=response)
        self.status = response.status_code
        self.code = code


# Per-user backend credentials (APP-CONTRACT §2.2). `caller_assertion` is the
# value of THIS request's inbound X-Caller-Assertion header: the app must
# echo it (identity rides only that platform-signed token). Returns a live
# credential ({"access_token": ...} or {"header": ...}). Raises
# NotConnected(connect_url), which the app relays to the user; ConnectionLocked,
# a NotConnected the user fixes by re-authorizing the MCP client; or
# ConnectionsError for any other failed seam call.
class Connections:
    def __init__(self, base: str | None = None, client: httpx.AsyncClient | None = None):
        self.base = base or os.environ.get("INNO_STORAGE_BASE", "http://storage.internal")
        self.client = client

    async def get(self, name: str, caller_assertion: str) -> dict:
        headers = {"X-Caller-Assertion": caller_assertion or ""}
        if self.client is not None:
            r = await self.client.post(f"{self.base}/_connections/{name}", headers=headers)
        else:
            async with httpx.AsyncClient() as c:
                r = await c.post(f"{self.base}/_connections/{name}", headers=headers)
        if not r.is_success:
            code = None
            try:
                body = r.json()
                if isinstance(body, dict) and isinstance(body.get("error"), str):
                    code = body["error"]
            except ValueError:
                pass
            raise ConnectionsError(r, code)
        out = r.json()
        if out.get("status") == "not_connected":
            raise (ConnectionLocked if out.get("locked") else NotConnected)(out.get("connect_url"))
        return {"access_token": out.get("access_token"), "header": out.get("header"), "expires_at": out.get("expires_at")}
