# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Builder
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.12-alpine AS builder

WORKDIR /install

# Dependencias de compilación para paquetes Python bajo Alpine
RUN apk add --no-cache build-base gcc libffi-dev

COPY backend/requirements.txt .
RUN pip install --no-cache-dir --prefix=/install/deps -r requirements.txt


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Runtime (Alpine Lightweight)
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.12-alpine

LABEL org.opencontainers.image.description="Legajo Hours Automator - TrueNAS Alpine Build"

# ── Instalar Chromium nativo de Alpine ──
# Instalar Chromium directamente de los repos de Alpine es muchísimo más
# eficiente y seguro que usar los binarios de Microsoft en Alpine.
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    git \
    tzdata

# Copiar paquetes Python del builder
COPY --from=builder /install/deps /usr/local

# Configuración crucial para que Playwright use el Chromium de Alpine
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

# ── Seguridad Non-Root (Preparado para TrueNAS) ──
# Usamos el UID 568 que es el usuario estándar 'apps' en TrueNAS Scale
# Esto reduce enormemente problemas de Permission Denied al mapear volúmenes locales.
RUN addgroup -g 568 apps && \
    adduser -u 568 -G apps -s /bin/sh -D apps

WORKDIR /app

# Copiar código fuente
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Permisos
RUN chown -R apps:apps /app

USER apps

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/health || exit 1

WORKDIR /app/backend
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
