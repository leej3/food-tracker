# Food Tracker (`sites/food-tracker`)

Standalone React + Supabase app for logging nutrition by family member with:

- Email authentication and signup.
- Per-person RBAC with `admin` and `logger`.
- Manual and photo entry paths.
- AI-assisted image analysis with follow-up prompts.
- Source-traceable nutrient data (`manual`, `guessed`, `verified`, `edited`).
- Offline queue for manual entries.
- Trend charting on nutrients.

## Stack

- Vite + React + TypeScript
- Supabase Auth / Postgres / Storage
- Supabase Edge Functions + OpenAI Chat Completions API
- Recharts

## Quick start

```bash
cd sites/food-tracker
npm install
npm run supabase:start
npm run supabase:env:write
npm run dev
```

### Useful local helpers

- `npm run supabase:seed:local-admins` (optional): set `FOOD_ADMIN_EMAILS` and
  `ADMIN_PASSWORD` environment variables before running to ensure those users exist.

## Deploy to Cloudflare Pages

Production URL:

- https://food-tracker-7qq.pages.dev

The production deploy flow follows the `consistency-tracker` pattern:

- GitHub Action `.github/workflows/deploy.yml` deploys to Cloudflare Pages on pushes to `main`.
- Build uses `npm run build` with production environment variables injected from repository secrets.
- Deploy is executed with `wrangler pages deploy` using the `food-tracker` project.

Required repository secrets for GitHub Actions:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `CF_API_KEY` (Cloudflare API token for `wrangler`, mapped to `CLOUDFLARE_API_TOKEN` in the workflow)

Note: URLs that include a deployment hash (for example `https://<deployment-id>.food-tracker-7qq.pages.dev`) are immutable snapshots.
If signup/login fails on one of those URLs, open the main project URL above for the latest build.

Local one-off deploy still works with:

```bash
cd sites/food-tracker
export CLOUDFLARE_API_TOKEN=...
npm run build
npm run deploy:cloudflare
```

## Environment variables

- Front-end:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- Function runtime:
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL` (default `gpt-5.4-nano`)
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

## Data model

### Core RBAC

- `user_roles`
- `family_members`
- `member_access`
- `user_directory`

### Food entries

- `food_entries`
- `food_entry_nutrients`
- `nutrient_definitions`

### AI workflow

- `food_ai_sessions`
- `food_ai_messages`
- `food_ai_candidates`

### Storage

- `food-photos` bucket with authenticated read/write policies.

## App flow

1. User signs in.
2. User selects a tracked person.
3. Create either:
   - Manual entry with optional per-nutrient values, or
   - Photo entry (captured from iPhone via `capture="environment"`).
4. Photo entry is uploaded to storage and sent to `food-analyze` function.
5. Function stores candidates + clarifying questions.
6. User confirms a candidate, can send follow-up prompts, then finalizes entry.
7. Manual entries are stored with `manual` source values.
8. Optional offline queue automatically saves manual entries when offline.

## Notes

- iPhone capture is optimized for phone upload (`accept="image/*"` + `capture="environment"`).
- Timestamp precision is minute-level in UTC.
- Retention is indefinite by schema defaults.
