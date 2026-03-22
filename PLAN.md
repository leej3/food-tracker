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

## 7) Progress log

- 2026-03-22: Migrated implementation to `/Users/johnlee/code/website-management/sites/food-tracker`.
- 2026-03-22: Stabilized local startup flow (idempotent startup, stale container cleanup).
- 2026-03-22: Fixed migration compatibility issues for local Postgres images.
- 2026-03-22: Verified Playwright:
  - mocked e2e test passes.
  - real-stack e2e test passes with local Supabase.
