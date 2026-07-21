#!/bin/sh
set -e
mkdir -p /data/uploads /data/.wwebjs_auth

# Remove stale Chromium profile locks left by a previous container.
find /data/.wwebjs_auth \
  \( -name "SingletonLock" -o -name "SingletonCookie" -o -name "SingletonSocket" \) \
  -exec rm -rf {} + 2>/dev/null || true

exec "$@"
