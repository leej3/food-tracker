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
- Cloudflare Pages Functions + OpenAI Chat Completions API
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
- CI now runs lint, typecheck, Vitest coverage, and mocked Playwright before deploy.
- The deploy workflow bootstraps the Food Tracker Supabase schema before Cloudflare publish.
- Build uses `npm run build`, which now also compiles the Pages Function bundle via `wrangler pages functions build`.
- Deploy is executed with `wrangler pages deploy` using the checked-in `wrangler.toml` configuration and `food-tracker` project.

Required repository secrets for GitHub Actions:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_DB_URL`
- `CF_API_KEY` (Cloudflare API token for `wrangler`, mapped to `CLOUDFLARE_API_TOKEN` in the workflow)
- Optional: `FOOD_TRACKER_DB_BOOTSTRAP`
  - `apply_if_missing` (default): verify schema, and rebuild it only if required tables are missing.
  - `reset_and_reseed`: always drop Food Tracker-managed objects and reapply migrations before deploy.
  - `check`: verify only and fail deploy if schema is missing.

Required Cloudflare Pages runtime variables/secrets for `/api/food-analyze`:

- `OPENAI_API_KEY` as a Pages secret
- `SUPABASE_URL`
- Optional runtime tuning:
  - `OPENAI_MODEL` as the server-side default when the UI does not override it
  - `OPENAI_REQUEST_TIMEOUT_MS`

Note: URLs that include a deployment hash (for example `https://<deployment-id>.food-tracker-7qq.pages.dev`) are immutable snapshots.
If signup/login fails on one of those URLs, open the main project URL above for the latest build.

Local one-off deploy still works with:

```bash
cd sites/food-tracker
export CLOUDFLARE_API_TOKEN=...
npm run build
npm run deploy:cloudflare
```

## Production DB bootstrap

Current production URL:

- https://food-tracker-7qq.pages.dev

Deploy no longer assumes schema already exists. The GitHub Action runs:

1. `npm run supabase:schema:bootstrap`
2. `npm run supabase:schema:check`
3. `npm run build`
4. Cloudflare Pages deploy

The bootstrap script manages only Food Tracker-owned objects. It does not `drop schema public cascade`.
If schema is missing or partially incompatible, it resets the Food Tracker tables, types, functions, storage bucket policies, and replays the migration SQL in `supabase/migrations`.

Useful local/manual commands:

```bash
cd sites/food-tracker
export VITE_SUPABASE_URL=...
export VITE_SUPABASE_PUBLISHABLE_KEY=...
export SUPABASE_DB_URL=...
npm run supabase:schema:check
npm run supabase:schema:bootstrap
```

If you need a forced rebuild of Food Tracker-managed database objects:

```bash
FOOD_TRACKER_DB_BOOTSTRAP=reset_and_reseed npm run supabase:schema:bootstrap
```

Quick verification (expected 200, JSON array response, not 404):

```bash
SUPABASE_URL=https://gkfqwrfunkrpxynslwfn.supabase.co
SUPABASE_PUBLISHABLE_KEY=...
curl -s -H "apikey: $SUPABASE_PUBLISHABLE_KEY" "$SUPABASE_URL/rest/v1/nutrient_definitions?select=*"
curl -s -H "apikey: $SUPABASE_PUBLISHABLE_KEY" "$SUPABASE_URL/rest/v1/user_roles?select=*"
curl -s -H "apikey: $SUPABASE_PUBLISHABLE_KEY" "$SUPABASE_URL/rest/v1/family_members?select=*"
```

If these requests return `PGRST205` errors, the database schema still does not include the food-tracker tables.

## Testing

Core local checks now available:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:coverage
npm run test:e2e
npm run ci
```

Coverage includes:

- unit tests for fuzzy search, queue persistence, and entry payload validation
- unit tests for camera-preference detection
- integration tests for bootstrap/schema handling and `FoodTrackerPage`
- Playwright regression tests for:
  - manual sign-in + entry flow
  - schema-missing bootstrap message
  - photo add/analyze/apply/follow-up/finalize flow

## Environment variables

- Front-end:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`
- Cloudflare Pages Function runtime:
  - `OPENAI_API_KEY` (secret)
  - `OPENAI_MODEL` (default `gpt-5.4-nano`, overridable per analysis in the UI dropdown)
  - `SUPABASE_URL`
  - optional `OPENAI_REQUEST_TIMEOUT_MS`

Local Vite development keeps the browser on the same `/api/food-analyze` path and proxies that route to `${VITE_SUPABASE_URL}/functions/v1/food-analyze` when `VITE_SUPABASE_URL` is set. In production, the Pages Function reuses the authenticated user token and browser `apikey` header, so it does not require a separate Supabase service-role secret in Cloudflare.

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
   - Photo entry through one `Add photo` action that prefers direct camera capture on supported phones.
4. Photo entry is uploaded to storage and sent to the same-origin `/api/food-analyze` Pages Function.
5. The Pages Function stores candidates + clarifying questions in Supabase.
6. User confirms a candidate, can send follow-up prompts, then finalizes entry.
7. Manual entries are stored with `manual` source values.
8. Optional offline queue automatically saves manual entries when offline.

## Notes

- iPhone capture is optimized through a single `Add photo` control that applies `capture="environment"` only on supported mobile browsers.
- Production photo analysis now runs server-side in Cloudflare Pages Functions. The browser only sends the authenticated request and never receives `OPENAI_API_KEY`.
- Timestamp precision is minute-level in UTC.
- Retention is indefinite by schema defaults.
