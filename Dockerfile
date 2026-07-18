FROM python:3.12-slim
WORKDIR /app
COPY app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ .
RUN useradd -m appuser
USER appuser
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8080/healthz').status==200 else 1)"
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
