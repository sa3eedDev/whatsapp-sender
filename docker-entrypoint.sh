#!/bin/sh
set -e
mkdir -p /data/.wwebjs_auth /app/uploads
exec "$@"
