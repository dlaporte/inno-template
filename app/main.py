import traceback

from starlette.applications import Starlette
from starlette.responses import JSONResponse, PlainTextResponse
from starlette.routing import Route
from starlette.templating import Jinja2Templates

# Delivered by the storage client lib; imported behind a guard so a local
# `docker build` sanity check works even before storage.py is present.
try:
    from storage import Storage
except Exception:  # pragma: no cover
    Storage = None

# Render HTML through Jinja2, which autoescapes interpolated values by default,
# so the identity header (x-forwarded-user) can't inject markup. Never build
# HTML with f-strings/format() — render through a template instead.
templates = Jinja2Templates(directory="templates")


async def healthz(request):
    return JSONResponse({"status": "ok"})


async def home(request):
    # Identity is injected by the gateway (verified Okta session); the app
    # never implements auth. See CLAUDE.md.
    user = request.headers.get("x-forwarded-user", "unknown")
    try:
        if Storage is None:
            return templates.TemplateResponse(
                request, "index.html", {"user": user, "storage": False}
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
            request,
            "index.html",
            {"user": user, "storage": True, "mine": mine[0]["n"], "total": total[0]["t"]},
        )
    except Exception as e:  # TEMP diagnostic: surface the real error in-page
        return PlainTextResponse(
            "DIAGNOSTIC — app error for user=" + user + "\n\n" + repr(e) + "\n\n" + traceback.format_exc(),
            status_code=200,
        )


app = Starlette(routes=[Route("/healthz", healthz), Route("/", home)])
