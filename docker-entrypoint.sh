#!/bin/sh
set -e

mkdir -p /data/.wwebjs_auth /app/uploads /app/uploads/media

# Remove stale Chromium profile locks left by a previous container.
# They reference the old container hostname, which makes Chromium refuse
# to start ("profile appears to be in use by another Chromium process").
find /data/.wwebjs_auth \
  \( -name "SingletonLock" -o -name "SingletonCookie" -o -name "SingletonSocket" \) \
  -exec rm -rf {} + 2>/dev/null || true

# Avoid writing the user's git config. Volumes can look "dubious" to git.
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=safe.directory
export GIT_CONFIG_VALUE_0='*'

repo_url() {
  url="${GIT_REPO_URL:-https://github.com/sa3eedDev/whatsapp-sender.git}"
  token="${GIT_TOKEN:-${GITHUB_TOKEN:-}}"
  if [ -n "$token" ]; then
    case "$url" in
      https://*)
        printf 'https://x-access-token:%s@%s\n' "$token" "${url#https://}"
        return
        ;;
    esac
  fi
  printf '%s\n' "$url"
}

update_from_git() {
  branch="${GIT_BRANCH:-main}"
  public_url="${GIT_REPO_URL:-https://github.com/sa3eedDev/whatsapp-sender.git}"
  url=$(repo_url)
  src=/tmp/whatsapp-sender-src

  echo "Checking ${public_url} (${branch}) for a new commit..."
  remote_sha=$(git ls-remote "$url" "refs/heads/${branch}" 2>/dev/null | cut -f1 | head -n 1 || true)
  if [ -z "$remote_sha" ]; then
    echo "Could not read ${branch}. Starting the current app." >&2
    echo "If the repo is private, set GIT_TOKEN (or GITHUB_TOKEN)." >&2
    return 0
  fi

  deployed=""
  if [ -f /app/.deployed-sha ]; then
    deployed=$(cat /app/.deployed-sha)
  fi

  if [ "$deployed" = "$remote_sha" ]; then
    echo "Already up to date (${remote_sha})."
    return 0
  fi

  echo "New commit on ${branch}: ${remote_sha} (running ${deployed:-image}). Pulling..."
  rm -rf "$src"
  git clone --depth 1 --branch "$branch" --single-branch "$url" "$src"

  old_lock=""
  if [ -f /app/package-lock.json ]; then
    old_lock=$(sha256sum /app/package-lock.json | awk '{ print $1 }')
  fi

  git -C "$src" archive --format=tar HEAD > /tmp/app-update.tar
  rm -rf "$src"
  tar -xf /tmp/app-update.tar -C /app
  rm -f /tmp/app-update.tar

  new_lock=""
  if [ -f /app/package-lock.json ]; then
    new_lock=$(sha256sum /app/package-lock.json | awk '{ print $1 }')
  fi
  if [ ! -d /app/node_modules ] || [ "$old_lock" != "$new_lock" ]; then
    echo "Dependencies changed. Installing..."
    npm ci --omit=dev --prefix /app
  fi

  # Entrypoint itself lives outside /app. Pick up a newer one on the next start.
  if [ -f /app/docker-entrypoint.sh ]; then
    cp /app/docker-entrypoint.sh /docker-entrypoint.sh
    chmod +x /docker-entrypoint.sh
  fi

  printf '%s\n' "$remote_sha" > /app/.deployed-sha
  echo "Updated to ${remote_sha}."
}

auto_update="${AUTO_UPDATE:-true}"
if [ "$auto_update" = "true" ] || [ "$auto_update" = "1" ]; then
  if ! update_from_git; then
    echo "Auto-update failed. Starting the current app." >&2
  fi
fi

exec "$@"
