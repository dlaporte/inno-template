# REFERENCE IMPLEMENTATION (Python — the platform's tested stack). Replace
# this Dockerfile wholesale for any other stack; the contract it must meet is
# the same for every language (fetch the get_app_contract MCP tool for the
# full contract and the CURRENT digest-pinned recommended base images):
#   - EXPOSE 8080 and listen on 0.0.0.0:8080   (CI-enforced)
#   - non-root USER before CMD                  (CI-enforced)
#   - GET /healthz -> 200                       (runtime contract)
#   - image passes Trivy HIGH/CRITICAL          (CI-enforced)
FROM python:3.12-slim
# Patch base-image OS packages so the container image passes the platform's
# Trivy HIGH/CRITICAL gate (Debian slim can ship with fixable CVEs).
RUN apt-get update && apt-get -y upgrade && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ .
RUN useradd -m appuser
USER appuser
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8080/healthz').status==200 else 1)"
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
