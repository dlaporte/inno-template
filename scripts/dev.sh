#!/usr/bin/env bash
set -euo pipefail
echo "Local dev: gateway runs at http://localhost:8787 with ENVIRONMENT=dev."
echo "Identity is mocked — pass -H 'X-Mock-User: you@davidlaporte.org' -H 'X-Mock-Groups: inno-<app>-users'."
echo "Requires a Docker engine for the container build."
exec npx wrangler dev
