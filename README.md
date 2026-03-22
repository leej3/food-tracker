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

```bash
cd sites/food-tracker
npm run build
npx wrangler login
npm run deploy:cloudflare
```

Production environment variables in Cloudflare Pages:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

`wrangler.toml` is configured as a Pages project using `dist` as the build output.

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
