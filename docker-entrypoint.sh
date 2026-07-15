#!/bin/sh
set -e
mkdir -p /data/.wwebjs_auth /app/uploads

# Remove stale Chromium profile locks left by a previous container.
# They reference the old container hostname, which makes Chromium refuse
# to start ("profile appears to be in use by another Chromium process").
find /data/.wwebjs_auth -maxdepth 3 \
  \( -name "SingletonLock" -o -name "SingletonCookie" -o -name "SingletonSocket" \) \
  -exec rm -rf {} + 2>/dev/null || true

exec "$@"
