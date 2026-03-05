# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Builder
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /install

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir --prefix=/install/deps -r requirements.txt


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Runtime (Debian Slim)
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.12-slim

LABEL org.opencontainers.image.description="Legajo Hours Automator - TrueNAS Debian Build"

# ── Install Chromium and Playwright deps via APT ──
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    libnss3 \
    libfreetype6 \
    libharfbuzz0b \
    ca-certificates \
    fonts-freefont-ttf \
    wget \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

# Copy python dependencies from builder
COPY --from=builder /install/deps /usr/local

# Playwright config to use system Chromium
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# ── Non-Root Security (TrueNAS apps user) ──
# UID 568 is the standard 'apps' user on TrueNAS Scale
RUN groupadd -g 568 apps && \
    useradd -u 568 -g apps -s /bin/sh -m apps

WORKDIR /app

# Copy source code
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Permissions
RUN chown -R apps:apps /app

USER apps

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/health || exit 1

WORKDIR /app/backend
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
