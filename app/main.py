from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

# Delivered by the storage client lib; imported behind a guard so a local
# `docker build` sanity check works even before storage.py is present.
try:
    from storage import Storage
except Exception:  # pragma: no cover
    Storage = None

app = FastAPI()
# Render HTML through Jinja2, which autoescapes interpolated values by default,
# so the identity header (x-forwarded-user) can't inject markup. Never build
# HTML with f-strings/format() — render through a template instead.
templates = Jinja2Templates(directory="templates")


@app.get("/healthz")
def healthz():
    return JSONResponse({"status": "ok"})


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    # Identity is injected by the gateway (verified Okta session); the app
    # never implements auth. See CLAUDE.md.
    user = request.headers.get("x-forwarded-user", "unknown")
    if Storage is None:
        return templates.TemplateResponse(
            "index.html", {"request": request, "user": user, "storage": False}
        )
    db = Storage()
    await db.execute("CREATE TABLE IF NOT EXISTS visits (email TEXT PRIMARY KEY, n INTEGER)")
    await db.execute(
        "INSERT INTO visits (email, n) VALUES (?, 1) "
        "ON CONFLICT(email) DO UPDATE SET n = n + 1",
        [user],
    )
    mine = await db.query("SELECT n FROM visits WHERE email = ?", [user])
    total = await db.query("SELECT COALESCE(SUM(n),0) AS t FROM visits")
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "user": user,
            "storage": True,
            "mine": mine[0]["n"],
            "total": total[0]["t"],
        },
    )
