import os
from urllib.parse import quote

import httpx


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

    async def list_files(self) -> list:
        r = await self._request("GET", "/_storage/files")
        r.raise_for_status()
        return r.json()["keys"]

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
        super().__init__(f"not connected — open {connect_url} to link your account")
        self.connect_url = connect_url


# Per-user backend credentials (APP-CONTRACT §2.2). `caller_assertion` is the
# value of THIS request's inbound X-Caller-Assertion header — the app must
# echo it (identity rides only that platform-signed token). Returns a live
# credential ({"access_token": ...} or {"header": ...}), or raises
# NotConnected(connect_url) which the app relays to the user.
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
        r.raise_for_status()
        out = r.json()
        if out.get("status") == "not_connected":
            raise NotConnected(out.get("connect_url"))
        return {"access_token": out.get("access_token"), "header": out.get("header"), "expires_at": out.get("expires_at")}
