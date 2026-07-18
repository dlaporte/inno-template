import os, httpx

class Storage:
    def __init__(self, base: str | None = None):
        self.base = base or os.environ.get("INNO_STORAGE_BASE", "http://storage.internal")

    async def _post(self, path: str, body: dict):
        async with httpx.AsyncClient() as c:
            r = await c.post(f"{self.base}{path}", json=body)
            r.raise_for_status()
            return r.json()

    async def query(self, sql: str, params: list | None = None):
        return (await self._post("/_storage/sql/query", {"sql": sql, "params": params or []}))["results"]

    async def execute(self, sql: str, params: list | None = None):
        return await self._post("/_storage/sql/execute", {"sql": sql, "params": params or []})

    async def put_file(self, key: str, data: bytes):
        async with httpx.AsyncClient() as c:
            r = await c.put(f"{self.base}/_storage/files/{key}", content=data); r.raise_for_status(); return r.json()

    async def get_file(self, key: str) -> bytes | None:
        async with httpx.AsyncClient() as c:
            r = await c.get(f"{self.base}/_storage/files/{key}")
            if r.status_code == 404: return None
            r.raise_for_status(); return r.content

def current_user(request) -> dict:
    h = request.headers
    groups = [g.strip() for g in h.get("x-forwarded-groups", "").split(",") if g.strip()]
    return {"email": h.get("x-forwarded-user", ""), "groups": groups}
