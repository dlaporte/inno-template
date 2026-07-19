from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.templating import Jinja2Templates

# Render HTML through Jinja2, which autoescapes interpolated values by default.
# Never build HTML with f-strings/format() — render through a template instead.
templates = Jinja2Templates(directory="templates")


async def healthz(request):
    # Container contract: return 200 when healthy. Required by the runtime.
    return JSONResponse({"status": "ok"})


async def home(request):
    # Placeholder landing page. This template ships as a bare scaffold with no
    # application logic — build your app here. Identity is injected by the
    # gateway as X-Forwarded-User (see CLAUDE.md), and persistence uses the
    # Storage client in storage.py; both are documented in CLAUDE.md with
    # copy-paste examples. Add your routes below and extend index.html.
    return templates.TemplateResponse(request, "index.html", {})


app = Starlette(routes=[Route("/healthz", healthz), Route("/", home)])
