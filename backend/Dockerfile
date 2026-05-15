FROM python:3.12-slim@sha256:401f6e1a67dad31a1bd78e9ad22d0ee0a3b52154e6bd30e90be696bb6a3d7461

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates nodejs npm gcc docker.io \
    && rm -rf /var/lib/apt/lists/*

# hadolint binary
RUN curl -L -o /usr/local/bin/hadolint "https://github.com/hadolint/hadolint/releases/download/v2.12.0/hadolint-Linux-x86_64" \
    && chmod +x /usr/local/bin/hadolint

# docker-compose-linter CLI (dclint)
RUN npm install -g npm@10
RUN npm install -g dclint@3.1.0

# standalone Docker Compose v2 CLI
RUN curl -L -o /usr/local/bin/docker-compose "https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-x86_64" \
    && chmod +x /usr/local/bin/docker-compose

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY alembic.ini ./alembic.ini
COPY alembic ./alembic

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
