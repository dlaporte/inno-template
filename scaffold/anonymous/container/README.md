# {app} (container type, anonymous)

A container-type app on the Innovation Platform that is never told who its
callers are: your code in `app/` runs in a container behind the platform's
front door, which decides who reaches the app by its audience (members-only,
internal or public) and never tells the app who the caller is.

## Developing

Start in `app/main.py`, a Starlette reference app, and the `Dockerfile`, and
read `CLAUDE.md` for the platform's constraints: the identity headers this app
never reads, the storage client in `app/storage.py`, and the
`## Container contract` section of `CLAUDE.md`. Any stack that meets the
contract works: replace `app/` and the `Dockerfile` wholesale for another.

## Running locally

The front door and the host that runs your container are the platform's, so
locally you run the container on its own:

```bash
docker build -t inno-app .
docker run -p 8080:8080 inno-app
curl http://localhost:8080/healthz
```

This app is never told who the caller is: every request it gets carries the
identity headers present and empty, so there is no caller to mock.

There is no `/_storage/*` proxy without the platform's host, so storage calls fail
locally. To exercise the real front door and storage, push to your default branch: CI runs the full
safety-gate suite as your preflight, without deploying.

## Deploying

Deploys are RELEASE-driven:

1. **Push to the default branch**: safety gates run (nothing deploys). Delete
   `app/.needs-build` once real code is in place; deploys are skipped while it
   exists.
2. **Tag a release**: `git tag v1.0.0 && git push origin v1.0.0` deploys the image
   the gates just scanned behind the platform's front door, then attaches your
   app's hostname.
