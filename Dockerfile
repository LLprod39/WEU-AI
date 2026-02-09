# WEU MVP — один образ, два варианта: mini (по умолчанию) и full.
# Сборка: docker build --build-arg BUILD=mini .  или  --build-arg BUILD=full .
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Зависимости системы (минимально для psycopg и др.)
# sshpass — для SSH подключений к серверам с паролями в воркфлоу
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    libpq5 curl sshpass openssh-client \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-mini.txt requirements-full.txt ./

# По умолчанию всегда mini. full только при WEU_BUILD=full в docker-compose
ARG BUILD=mini
RUN if [ "$BUILD" = "full" ]; then pip install -r requirements-full.txt; else pip install -r requirements-mini.txt; fi

# Cursor CLI для headless-агентов. Документация: https://cursor.com/ru/docs/cli/headless
# Бинарник ставится в ~/.local/bin; в образе — /root/.local/bin.
ENV CI=1
RUN curl -fsSL https://cursor.com/install | bash
ENV PATH="/root/.local/bin:${PATH}"

# Codex CLI (OpenAI) — опционально. Задай INSTALL_CODEX=true в docker-compose для агента Codex.
ARG INSTALL_CODEX=false
RUN if [ "$INSTALL_CODEX" = "true" ]; then \
  curl -fsSL "https://github.com/openai/codex/releases/download/rust-v0.98.0/codex-x86_64-unknown-linux-musl.tar.gz" -o /tmp/codex.tar.gz && \
  tar -xzf /tmp/codex.tar.gz -C /tmp && \
  mv /tmp/codex-x86_64-unknown-linux-musl /usr/local/bin/codex && \
  chmod +x /usr/local/bin/codex && \
  rm -f /tmp/codex.tar.gz; \
fi

COPY . .

COPY docker/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

RUN python manage.py collectstatic --noinput 2>/dev/null || true

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]
