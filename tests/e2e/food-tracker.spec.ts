import { Buffer } from "node:buffer";
import { expect, test, type Page } from "@playwright/test";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? "https://test.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const REAL_STACK = process.env.PLAYWRIGHT_REAL_STACK === "1";
const REAL_EMAIL = process.env.PLAYWRIGHT_REAL_EMAIL ?? "pw-food@local.dev";
const REAL_PASSWORD =
  process.env.PLAYWRIGHT_REAL_PASSWORD ?? "localdevpassword123";

const testUser = {
  id: "user-admin-1",
  email: "admin@example.com",
};

const makeSchemaError = (table: string) => ({
  code: "PGRST205",
  details: null,
  hint: null,
  message: `Could not find the table 'public.${table}' in the schema cache`,
});

const formatIsoMinute = (value: string) => {
  const [datePart, timePart] = value.split("T");
  const [y, m, d] = datePart.split("-").map((part) => Number(part));
  const [h, min] = timePart.split(":").map((part) => Number(part));
  return new Date(y, m - 1, d, h, min, 0, 0).toISOString();
};

const mountSupabaseMocks = async (
  page: Page,
  options?: {
    schemaMissing?: string[];
  },
) => {
  const schemaMissing = new Set(options?.schemaMissing ?? []);
  const state = {
    role: "admin",
    members: [
      {
        id: "member-adam",
        name: "Adam",
        canonical_slug: "adam",
        is_active: true,
        default_timezone: "America/New_York",
      },
    ],
    nutrients: [
      { code: "calories", name: "Calories", unit: "kcal", category: "macro" },
      { code: "protein_g", name: "Protein", unit: "g", category: "macro" },
    ],
    entries: [] as Array<{
      id: string;
      member_id: string;
      logged_by_user_id: string;
      photo_storage_path: string | null;
      consumed_at: string;
      item_name: string;
      meal_type: "breakfast" | "lunch" | "dinner" | "snack" | "other";
      serving_qty: number;
      serving_unit: string;
      workflow_state: "analysis_pending" | "review_needed" | "finalized";
      source_confidence: number | null;
      source_label: string;
      manual_notes: string | null;
      created_at: string;
      updated_at: string;
      food_entry_nutrients: Array<{
        nutrient_code: string;
        amount: number;
        unit: string;
        source: "guessed" | "manual";
        source_confidence: number;
      }>;
    }>,
    aiSessions: [] as Array<{
      id: string;
      entry_id: string;
      current_round: number;
      state: "ready_for_review" | "follow_up";
      model: string;
      overall_confidence: number;
      clarifying_questions: string[];
    }>,
    aiCandidates: [] as Array<{
      id: string;
      session_id: string;
      position: number;
      item_name: string;
      serving_qty: number;
      serving_unit: string;
      confidence: number;
      rationale: string;
      payload: {
        nutrients: Array<{
          code: string;
          amount: number;
          unit: string;
          confidence?: number;
        }>;
      };
      is_selected: boolean;
    }>,
  };

  let entryCounter = 0;
  let sessionCounter = 0;

  await page.route("**/*", async (route) => {
    const request = route.request();
    const requestUrl = request.url();
    const url = new URL(requestUrl);
    const path = url.pathname;
    const method = request.method();

    if (method === "POST" && path === "/api/food-analyze") {
      const payload = ((await request.postDataJSON()) ?? {}) as {
        entryId?: string;
        action?: "analyze" | "follow_up";
        model?: string;
      };
      const entryId = payload.entryId ?? state.entries[0]?.id ?? "entry-1";
      const action = payload.action ?? "analyze";
      const analyzeModel = payload.model?.trim() || "gpt-5.4-nano";
      const entry = state.entries.find((candidate) => candidate.id === entryId);

      if (action === "analyze") {
        sessionCounter += 1;
        const sessionId = `session-${sessionCounter}`;
        state.aiSessions = [
          {
            id: sessionId,
            entry_id: entryId,
            current_round: 1,
            state: "ready_for_review",
            model: analyzeModel,
            overall_confidence: 0.82,
            clarifying_questions: ["Was this canned or homemade?"],
          },
        ];
        state.aiCandidates = [
          {
            id: "candidate-1",
            session_id: sessionId,
            position: 1,
            item_name: "Tomato soup",
            serving_qty: 12,
            serving_unit: "oz",
            confidence: 0.82,
            rationale: "Typical tomato soup serving from the photo.",
            payload: {
              nutrients: [
                {
                  code: "calories",
                  amount: 180,
                  unit: "kcal",
                  confidence: 0.82,
                },
                { code: "protein_g", amount: 4, unit: "g", confidence: 0.71 },
              ],
            },
            is_selected: false,
          },
        ];
      } else if (state.aiSessions[0]) {
        state.aiSessions[0] = {
          ...state.aiSessions[0],
          current_round: 2,
          clarifying_questions: [],
          overall_confidence: 0.91,
        };
        state.aiCandidates = state.aiCandidates.map((candidate) => ({
          ...candidate,
          item_name: "Tomato soup (12 oz can)",
          confidence: 0.91,
          rationale: "Updated with the follow-up serving detail.",
        }));
      }

      if (entry) {
        entry.workflow_state = "review_needed";
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          session: state.aiSessions[0]
            ? {
                id: state.aiSessions[0].id,
                current_round: state.aiSessions[0].current_round,
                state: state.aiSessions[0].state,
                overall_confidence: state.aiSessions[0].overall_confidence,
                clarifying_questions: state.aiSessions[0].clarifying_questions,
                model: state.aiSessions[0].model,
              }
            : null,
          candidates: state.aiCandidates,
          inference_model: analyzeModel,
        },
      });
      return;
    }

    if (!requestUrl.startsWith(SUPABASE_URL)) {
      await route.continue();
      return;
    }

    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204 });
      return;
    }
    const maybeSchemaMiss = async (table: string) => {
      if (!schemaMissing.has(table)) {
        return false;
      }

      await route.fulfill({
        status: 404,
        contentType: "application/json",
        json: makeSchemaError(table),
      });
      return true;
    };

    if (method === "POST" && path === "/auth/v1/token") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          access_token: "dummy-access-token",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: "dummy-refresh-token",
          user: testUser,
        },
      });
      return;
    }

    if (method === "GET" && path === "/auth/v1/user") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: testUser,
      });
      return;
    }

    if (method === "POST" && path === "/auth/v1/logout") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {},
      });
      return;
    }

    if (method === "GET" && path === "/rest/v1/user_roles") {
      if (await maybeSchemaMiss("user_roles")) {
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          user_id: testUser.id,
          role: state.role,
        },
      });
      return;
    }

    if (method === "GET" && path === "/rest/v1/nutrient_definitions") {
      if (await maybeSchemaMiss("nutrient_definitions")) {
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: state.nutrients,
      });
      return;
    }

    if (method === "GET" && path === "/rest/v1/family_members") {
      if (await maybeSchemaMiss("family_members")) {
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: state.members,
      });
      return;
    }

    if (method === "GET" && path === "/rest/v1/food_entries") {
      const memberId = url.searchParams.get("member_id")?.replace("eq.", "");
      const filtered = memberId
        ? state.entries.filter((entry) => entry.member_id === memberId)
        : state.entries;

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: filtered,
      });
      return;
    }

    if (method === "POST" && path === "/rest/v1/food_entries") {
      const payload = ((await request.postDataJSON()) ?? {}) as Record<
        string,
        string | number | null
      >;
      entryCounter += 1;
      const entryId = `entry-${entryCounter}`;
      const nextEntry = {
        id: entryId,
        member_id: String(
          payload.member_id ?? state.members[0]?.id ?? "member-adam",
        ),
        logged_by_user_id: testUser.id,
        photo_storage_path:
          typeof payload.photo_storage_path === "string"
            ? payload.photo_storage_path
            : null,
        consumed_at:
          typeof payload.consumed_at === "string"
            ? payload.consumed_at
            : formatIsoMinute("2026-03-22T07:00"),
        item_name:
          typeof payload.item_name === "string"
            ? payload.item_name
            : "Manual entry",
        meal_type: (typeof payload.meal_type === "string"
          ? payload.meal_type
          : "snack") as "breakfast" | "lunch" | "dinner" | "snack" | "other",
        serving_qty: Number(payload.serving_qty ?? 1),
        serving_unit:
          typeof payload.serving_unit === "string"
            ? payload.serving_unit
            : "oz",
        workflow_state: (payload.photo_storage_path
          ? "analysis_pending"
          : "finalized") as "analysis_pending" | "review_needed" | "finalized",
        source_confidence: payload.photo_storage_path ? null : 0.92,
        source_label: payload.photo_storage_path ? "photo" : "manual",
        manual_notes:
          typeof payload.manual_notes === "string"
            ? payload.manual_notes
            : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        food_entry_nutrients: [],
      };
      state.entries.unshift(nextEntry);

      await route.fulfill({
        status: 201,
        contentType: "application/json",
        json: { id: entryId },
      });
      return;
    }

    if (method === "POST" && path === "/rest/v1/food_entry_nutrients") {
      const payload = (await request.postDataJSON()) as Array<{
        entry_id: string;
        nutrient_code: string;
        amount: number;
        unit: string;
      }>;
      for (const row of payload ?? []) {
        const entry = state.entries.find(
          (candidate) => candidate.id === row.entry_id,
        );
        if (!entry) {
          continue;
        }
        entry.food_entry_nutrients.push({
          nutrient_code: row.nutrient_code,
          amount: row.amount,
          unit: row.unit,
          source: "manual",
          source_confidence: 1,
        });
      }

      await route.fulfill({
        status: 201,
        contentType: "application/json",
        json: { ok: true },
      });
      return;
    }

    if (method === "GET" && path === "/rest/v1/food_ai_sessions") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: state.aiSessions,
      });
      return;
    }

    if (method === "GET" && path === "/rest/v1/food_ai_candidates") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: state.aiCandidates,
      });
      return;
    }

    if (
      method === "POST" &&
      path.startsWith("/storage/v1/object/food-photos")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: { Key: "food-photos/mock.jpg" },
      });
      return;
    }

    if (
      method === "POST" &&
      path === "/rest/v1/rpc/apply_food_entry_ai_candidate"
    ) {
      const payload = ((await request.postDataJSON()) ?? {}) as {
        p_entry_id?: string;
        p_candidate_id?: string;
      };
      const candidate = state.aiCandidates.find(
        (row) => row.id === payload.p_candidate_id,
      );
      const entry = state.entries.find((row) => row.id === payload.p_entry_id);

      if (candidate && entry) {
        entry.item_name = candidate.item_name;
        entry.serving_qty = candidate.serving_qty;
        entry.serving_unit = candidate.serving_unit;
        entry.source_confidence = candidate.confidence;
        entry.workflow_state = "review_needed";
        entry.food_entry_nutrients = candidate.payload.nutrients.map(
          (nutrient) => ({
            nutrient_code: nutrient.code,
            amount: nutrient.amount,
            unit: nutrient.unit,
            source: "guessed",
            source_confidence: nutrient.confidence ?? candidate.confidence,
          }),
        );
        state.aiCandidates = state.aiCandidates.map((row) => ({
          ...row,
          is_selected: row.id === candidate.id,
        }));
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: { ok: true },
      });
      return;
    }

    if (method === "POST" && path === "/rest/v1/rpc/finalize_food_entry") {
      const payload = ((await request.postDataJSON()) ?? {}) as {
        p_entry_id?: string;
      };
      const entry = state.entries.find((row) => row.id === payload.p_entry_id);
      if (entry) {
        entry.workflow_state = "finalized";
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: { ok: true },
      });
      return;
    }

    await route.fallback();
  });
};

const signInThroughUi = async (page: Page) => {
  await page.goto("/");
  await page.getByPlaceholder("you@example.com").fill("admin@example.com");
  await page.getByPlaceholder("Password").fill("password123");
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();
};

const ensureRealTestUser = async (email: string, password: string) => {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for real stack Playwright run.",
    );
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
    }),
  });

  if (response.ok || response.status === 422) {
    return;
  }

  const body = await response.text();
  throw new Error(
    `Unable to create local test user: ${response.status} ${body}`,
  );
};

test("manual sign-in and entry flow", async ({ page }) => {
  test.skip(REAL_STACK, "Real-stack mode uses the hosted smoke test.");

  await mountSupabaseMocks(page);
  await signInThroughUi(page);

  await expect(page.getByText("Tracking for")).toBeVisible();
  await page
    .getByPlaceholder("Apple, toast, chicken breast...")
    .fill("Greek yogurt");
  await page.getByRole("spinbutton", { name: "Serving" }).fill("5");
  await page.getByRole("button", { name: "Save entry" }).click();

  await expect(page.getByText("Entry saved.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Greek yogurt" })).toBeVisible();
});

test("schema-missing errors are shown as actionable bootstrap guidance", async ({
  page,
}) => {
  test.skip(REAL_STACK, "Real-stack mode uses the hosted smoke test.");

  await mountSupabaseMocks(page, {
    schemaMissing: ["user_roles", "nutrient_definitions", "family_members"],
  });
  await signInThroughUi(page);

  await expect(page.getByText(/backend is not initialized/i)).toBeVisible();
});

test("photo review flow supports analyze, apply, follow-up, and finalize", async ({
  page,
}) => {
  test.skip(REAL_STACK, "Real-stack mode uses the hosted smoke test.");

  await mountSupabaseMocks(page);
  await signInThroughUi(page);

  await page.getByRole("button", { name: "Photo" }).click();
  await expect(page.getByRole("button", { name: "Add photo" })).toBeVisible();
  await page
    .getByPlaceholder("Apple, toast, chicken breast...")
    .fill("Lunch photo");
  await page.getByLabel("OpenAI model").selectOption("gpt-5.4-mini");
  await page.locator('input[data-testid="photo-input"]').setInputFiles({
    name: "meal.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("fake-image"),
  });
  await page.getByRole("button", { name: "Upload + analyze" }).click();

  await expect(
    page.getByText("Photo uploaded. AI candidates generated."),
  ).toBeVisible();
  await expect(
    page.locator("strong").filter({ hasText: "Tomato soup" }),
  ).toBeVisible();
  await expect(page.getByText("OpenAI model: gpt-5.4-mini")).toBeVisible();
  await page.getByRole("button", { name: "Apply this candidate" }).click();
  await expect(page.getByText(/Candidate applied/i)).toBeVisible();

  await page.getByLabel(/Ask a follow-up/i).fill("It was a 12 oz can.");
  await page.getByRole("button", { name: "Send follow-up" }).click();
  await expect(
    page.locator("strong").filter({ hasText: "Tomato soup (12 oz can)" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Finalize" }).click();
  await expect(page.getByText("Entry finalized.")).toBeVisible();
});

test("hosted smoke login works when real-stack mode is enabled", async ({
  page,
}) => {
  test.skip(!REAL_STACK, "Mock mode covers local regression tests.");

  await ensureRealTestUser(REAL_EMAIL, REAL_PASSWORD);

  await page.goto("/");
  await page.getByPlaceholder("you@example.com").fill(REAL_EMAIL);
  await page.getByPlaceholder("Password").fill(REAL_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("Tracking for")).toBeVisible();
});
