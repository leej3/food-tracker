#!/usr/bin/env bash

set -euo pipefail

PROJECT_ID=$(sed -n 's/^project_id[[:space:]]*=[[:space:]]*"\([^\"]*\)".*/\1/p' supabase/config.toml | head -n 1)
LOCK_DIR=".supabase-start.lock"
if [[ -e "$LOCK_DIR" && ! -d "$LOCK_DIR" ]]; then
  rm -f "$LOCK_DIR"
fi

if [[ -z "${PROJECT_ID}" ]]; then
  PROJECT_ID="$(basename "$PWD")"
fi

# Reuse active project before attempting anything.
if docker ps --filter "name=supabase_db_${PROJECT_ID}" --filter "status=running" --format "{{.Names}}" | grep -q "^supabase_db_${PROJECT_ID}$"; then
  echo "Supabase already running for ${PROJECT_ID}; reusing cached containers."
  exit 0
fi

# If another startup is already running, wait briefly for it to finish.
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Supabase startup already running for ${PROJECT_ID}; waiting for it to finish."
  for _ in $(seq 1 90); do
    sleep 1
    if docker ps --filter "name=supabase_db_${PROJECT_ID}" --filter "status=running" --format "{{.Names}}" | grep -q "^supabase_db_${PROJECT_ID}$"; then
      echo "Supabase started by another process."
      exit 0
    fi
  done
  echo "Timed out waiting for existing Supabase startup to complete."
  exit 1
fi

trap 'rmdir "$LOCK_DIR"' EXIT

# Clean stale project containers left from aborted starts so name collisions do not
# trigger repeated startup attempts and repeated image use.
docker ps -a --filter "name=supabase_.*_${PROJECT_ID}\$" --format "{{.Names}}" | while read -r container_name; do
  if [[ -z "$container_name" ]]; then
    continue
  fi

  if ! docker ps --filter "name=^/${container_name}$" --filter "status=running" --format "{{.Names}}" | grep -q "^/${container_name}$"; then
    docker rm -f "$container_name" >/dev/null 2>&1 || true
  fi
done

echo "Starting Supabase for ${PROJECT_ID} (images will be pulled only if not already cached)."
npx --yes supabase start
