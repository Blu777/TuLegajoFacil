#!/bin/sh
set -e

# Ensure data directory exists and is writable by apps user
mkdir -p /app/data
chown -R apps:apps /app/data

# Seed DB on first run (empty volume)
if [ ! -f /app/data/history.db ] && [ -f /app/backend/seed.db ]; then
    cp /app/backend/seed.db /app/data/history.db
    chown apps:apps /app/data/history.db
fi

# Drop to apps user and start server
exec su -s /bin/sh apps -c "cd /app/backend && exec uvicorn app:app --host 0.0.0.0 --port 8080 --workers 1"
