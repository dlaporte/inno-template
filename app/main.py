import os
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse

try:
    from storage import Storage, current_user  # delivered by Task 6
except Exception:  # pragma: no cover - local build sanity before Task 6
    Storage = None

app = FastAPI()

@app.get("/healthz")
def healthz():
    return JSONResponse({"status": "ok"})

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    user = request.headers.get("x-forwarded-user", "unknown")
    if Storage is None:
        return f"<h1>Hello {user}</h1><p>storage unavailable</p>"
    db = Storage()
    await db.execute("CREATE TABLE IF NOT EXISTS visits (email TEXT PRIMARY KEY, n INTEGER)")
    await db.execute(
        "INSERT INTO visits (email, n) VALUES (?, 1) ON CONFLICT(email) DO UPDATE SET n = n + 1", [user])
    mine = await db.query("SELECT n FROM visits WHERE email = ?", [user])
    total = await db.query("SELECT COALESCE(SUM(n),0) AS t FROM visits")
    return f"<h1>Hello {user}</h1><p>Your visits: {mine[0]['n']}</p><p>Total visits: {total[0]['t']}</p>"
