#!/usr/bin/env bash
set -euo pipefail

status_output="$(npx --yes supabase status -o env 2>/dev/null)"
api_url="$(printf '%s\n' "$status_output" | sed -n 's/^API_URL=//p' | tr -d '"')"
anon_key="$(printf '%s\n' "$status_output" | sed -n 's/^ANON_KEY=//p' | tr -d '"')"

if [[ -z "${api_url}" || -z "${anon_key}" ]]; then
  printf 'Could not resolve local Supabase API_URL or ANON_KEY.\n'
  printf 'Start local Supabase first: npm run supabase:start\n'
  exit 1
fi

cat > .env.local <<EOF2
VITE_SUPABASE_URL=${api_url}
VITE_SUPABASE_ANON_KEY=${anon_key}
EOF2

printf 'Wrote .env.local from local Supabase status output.\n'
