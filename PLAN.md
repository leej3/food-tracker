# Food Tracker v1 Plan (Standalone)

## 1) Scope and boundaries

The first release intentionally favors simplicity and a single deployed app:

- Standalone directory: `sites/food-tracker`.
- Supabase project per app.
- Standalone first-run deployment path (no SSR backend initially).
- Multi-user family workflow with explicit many-to-many mapping:
  - independent tracked persons (`family_members`),
  - assignments in `member_access`,
  - automatic self-person and access grant on signup.
- Full create/read workflow with iterative rollout toward richer optimisation.
- Indefinite retention in schema.

## 2) Product requirements (explicitly implemented)

- Email signup + login.
- Family members are independent tracked people.
- Many-to-many access model:
  - `family_members`
  - `member_access`
  - `user_roles`
  - Admin and logger rights through policy checks.
- Manual and photo entry methods.
- Photo flow:
  - upload photo
  - call `food-analyze` edge function
  - capture AI suggestions with confidence and rationale
  - optional follow-up interaction
  - candidate application.
- Source lineage for nutrients:
  - `manual`, `guessed`, `verified`, `edited`.
- Offline-first minimum:
  - manual drafts queued when network unavailable.
- Time grain: minute-level timestamps.
- Units default to ounce-based serving.
- Metrics tracked (default set):
  - calories, protein, sugar, vitamin B12, alcohol, and full nutrition set.

### User clarifications integrated

- "Self" person assignment on signup is automatic.
- Shadow inference path is enabled by default for all new photo candidates:
  - run local/shadow endpoint first,
  - fall back to OpenAI above confidence floor when needed.
- Edit-finalized-entry flow is included in this pass:
  - manual edits are captured in `food_entry_nutrients` as `edited`.
- The real stack path is preferred for final validation while mocks are kept for fast offline iteration.

## 3) Schema and migration plan

### Already shipped

- Migration: `0001_init.sql`
  - Core entities and enums.
  - `food_entries`, `food_entry_nutrients`, `nutrient_definitions`.
  - `food_ai_sessions`, `food_ai_messages`, `food_ai_candidates`.
  - Storage bucket and policies for `food-photos`.
  - RLS policies for access control.
- Migration: `0002_user_directory.sql` (new)
  - `user_directory` for admin email lookup.
  - `search_user_directory(p_search)` helper (admin only).
- Migration: `0004_auto_self_access_and_inference_events.sql`
  - `handle_new_user_role()` auto self-member + access assignment for new users.
  - Backfill for existing auth users who created no own tracked member.
  - `food_ai_inference_events` telemetry with path enum:
    `shadow`, `shadow_fallback_to_openai`, `openai`.
- Migration: `0005_update_food_entry_with_values.sql`
  - `update_food_entry_with_values(...)` RPC for editable finalized entries.

## 4) Frontend implementation plan

### Completed (including this pass)

- App shell with auth routing in `src/App.tsx`.
- Supabase client setup.
- Shared types + utility helpers:
  - `src/lib/supabase.ts`
  - `src/lib/types.ts`
  - `src/lib/fuzzy.ts`
  - `src/lib/queue.ts`
- Auth pages:
  - `src/components/LoginPage.tsx`
  - `src/components/ResetPasswordPage.tsx`
- Main logger flow:
  - `src/components/FoodTrackerPage.tsx`
  - member selection and trend chart integration.
  - manual entry with nutrient cards.
  - photo capture and AI review state.
- Admin management page:
  - `src/components/AdminPanel.tsx`
- Offline queue UI:
  - `src/components/OfflineBanner.tsx`
- Trend chart:
  - `src/components/TrendChart.tsx`
- Global styling:
  - `src/index.css`

- Improvements included in this pass:
  - candidate persistence with follow-up state transitions,
  - explicit "edit finalized entry" flow with save path,
  - offline queueing and retry,
  - local-first `supabase-start-cached` lock-based startup and stale-container cleanup,
  - migration compatibility updates for local Postgres image SQL support,
  - local inference telemetry persisted in `food_ai_inference_events`.

### Pending / follow-up (future iterations)

- Optional delete/archive workflow for stale entries.
- CSV export and advanced trend analysis options.
- Per-nutrient confidence threshold policy controls in dashboards.

## 5) Edge function plan

- `supabase/functions/food-analyze/index.ts`
- Responsibilities:
  - verify auth + member access.
  - download signed image URL.
  - call OpenAI model and enforce JSON response.
  - persist candidates + clarifying questions.
  - expose session state for resumable analysis.
- Existing hardening changes completed:
  - OpenAI key and photo path checks.
  - candidate/session cleanup for re-runs.

## 6) Deployment/validation checklist

- Run migrations in order.
- Confirm production PostgREST schema contains food-tracker tables (`nutrient_definitions`, `user_roles`, `family_members`, ... ) before marking deployment as complete.
- Seed bucket and any admin users for local development.
- Ensure `food-analyze` has environment variables in Supabase secrets.
- Confirm app runs:
  - auth signup/login
  - member selection
  - manual entry
- Confirm photo flow:
  - upload photo
  - analyze -> review -> apply candidate
  - finalize.
- Confirm RBAC:
  - logger sees only assigned people
  - admin can add member access.
- Confirm offline queue:
  - submit manual entry while offline
  - come back online and sync.
- Confirm shadow + OpenAI fallback telemetry in `food_ai_inference_events`.
- Confirm real-stack end-to-end Playwright:
  - local mock test path passes.
  - real local-stack test path passes.
- Cloudflare deployment readiness:
  - GitHub Action `.github/workflows/deploy.yml` deploys on `main`.
  - project name set to `food-tracker` and deploy command matches consistency-tracker style.
  - `wrangler.toml` exists with `pages_build_output_dir = "dist"`.
  - local `npm run deploy:cloudflare` remains for one-off deploys.
  - production variables are configured in Cloudflare Pages:
    - `VITE_SUPABASE_URL`
    - `VITE_SUPABASE_ANON_KEY`.
  - `CF_API_KEY` is used in CI (`CLOUDFLARE_API_TOKEN`).

## 8) Production schema remediation (current blocker)

- The production error set:
  - `Could not find the table 'public.nutrient_definitions'`
  - `Could not find the table 'public.user_roles'`
  - `Could not find the table 'public.family_members'`
  means the Pages deployment is pointed at an existing Supabase project that has only the consistency-tracker schema (`people`, `consistency_entries`).
- `food-tracker-7qq.pages.dev` is otherwise healthy; this is a backend schema mismatch.
- Apply these migration files on the same Supabase project before using the app:
  - `supabase/migrations/0001_init.sql`
  - `supabase/migrations/0002_user_directory.sql`
  - `supabase/migrations/0004_auto_self_access_and_inference_events.sql`
  - `supabase/migrations/0005_update_food_entry_with_values.sql`
- After applying, verify with production anon key:
  - `curl -s -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" "$SUPABASE_URL/rest/v1/nutrient_definitions?select=*"`
  - `curl -s -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" "$SUPABASE_URL/rest/v1/user_roles?select=*"`
  - `curl -s -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" "$SUPABASE_URL/rest/v1/family_members?select=*"`
- Expected output should be JSON array(s); `[]` is acceptable for new installs. 404 indicates schema is not loaded.

## 7) Progress log

- 2026-03-22: Migrated implementation to `/Users/johnlee/code/website-management/sites/food-tracker` and then corrected to `/Users/johnlee/code/websites-management/sites/food-tracker` (parent repo alignment).
- 2026-03-22: Stabilized local startup flow (idempotent startup, stale container cleanup).
- 2026-03-22: Fixed migration compatibility issues for local Postgres images.
- 2026-03-22: Verified Playwright:
  - mocked e2e test passes.
  - real-stack e2e test passes with local Supabase.
- 2026-03-22: Added Cloudflare Pages deployment scaffold (wrangler config + deploy script).
- 2026-03-22: Aligned Cloudflare deploy flow with consistency-tracker pattern (push-to-main GitHub Action).
- 2026-03-22: Created GitHub repository `leej3/food-tracker` and set default branch to `main`.
- 2026-03-22: Added GitHub Actions secrets: `CF_API_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- 2026-03-22: Updated `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` secrets to match the deployed consistency-tracker production values.
- 2026-03-22: Synced secrets used in build step to:
  - `VITE_SUPABASE_URL`: `https://gkfqwrfunkrpxynslwfn.supabase.co`
  - `VITE_SUPABASE_ANON_KEY`: `consistency-tracker-production-anon-key`
- 2026-03-22: Created Cloudflare Pages project `food-tracker` in account `fd50ad223bc35ee2f616ec01a9a8858e`.
- 2026-03-22: Triggered and validated CI deploy to Cloudflare Pages.
  - Production URL: `https://food-tracker-7qq.pages.dev`.
  - Latest successful deployment after prod secret refresh: `https://bbd626aa.food-tracker-7qq.pages.dev` (commit `2fad783`).
- 2026-03-22: Production login failure was traced to local-only Supabase env values in build-time secrets; corrected to hosted values used by consistency-tracker.
- 2026-03-22: Production app logs now show 404s for `nutrient_definitions`, `user_roles`, `family_members`; this indicates missing migration application on the shared Supabase backend and is blocked until migration SQL is applied.
