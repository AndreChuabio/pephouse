# PepHouse backend: FastAPI + numpy Monte Carlo, with Java + Synthea baked in so
# live cohort generation (live_cohort=true) works in the hosted container, not just
# on a laptop with Docker. Entry point is backend/main.py:app.
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      openjdk-21-jre-headless unzip curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Synthea baked in, exploded for the Zip64 classpath run (java -cp DIR App).
RUN mkdir -p /opt/synthea \
    && curl -sL -o /tmp/synthea.jar \
       https://github.com/synthetichealth/synthea/releases/download/master-branch-latest/synthea-with-dependencies.jar \
    && cd /opt/synthea && unzip -q /tmp/synthea.jar && rm /tmp/synthea.jar
ENV SYNTHEA_CP=/opt/synthea

WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .

ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
