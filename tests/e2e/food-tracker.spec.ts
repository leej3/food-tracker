import { type Page, test, expect } from "@playwright/test";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "https://test.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const REAL_STACK = process.env.PLAYWRIGHT_REAL_STACK === "1";
const REAL_EMAIL = process.env.PLAYWRIGHT_REAL_EMAIL ?? "pw-food@local.dev";
const REAL_PASSWORD = process.env.PLAYWRIGHT_REAL_PASSWORD ?? "localdevpassword123";

const testUser = {
  id: "user-admin-1",
  email: "admin@example.com",
};

const formatIsoMinute = (value: string) => {
  const [datePart, timePart] = value.split("T");
  const [y, m, d] = datePart.split("-").map((part) => Number(part));
  const [h, min] = timePart.split(":").map((part) => Number(part));
  return new Date(y, m - 1, d, h, min, 0, 0).toISOString();
};

const mountSupabaseMocks = async (page: Page) => {
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
      {
        id: "member-eva",
        name: "Eva",
        canonical_slug: "eva",
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
      photo_storage_path: null;
      consumed_at: string;
      item_name: string;
      meal_type: "snack";
      serving_qty: number;
      serving_unit: string;
      workflow_state: "finalized";
      source_confidence: number;
      source_label: string;
      manual_notes: string | null;
      created_at: string;
      updated_at: string;
      food_entry_nutrients: Array<{
        nutrient_code: string;
        amount: number;
        unit: string;
        source: "manual";
        source_confidence: 1;
      }>;
    }>,
  };

  let entryCounter = 0;

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (!request.url().startsWith(SUPABASE_URL)) {
      await route.continue();
      return;
    }

    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204 });
      return;
    }

    const path = url.pathname;
    const method = request.method();

    const authSignInResponse = {
      access_token: "dummy-access-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: "dummy-refresh-token",
      user: testUser,
    };

    const userRolePayload = {
      id: `role-${testUser.id}`,
      user_id: testUser.id,
      role: state.role,
      granted_by: null,
    };

    if (method === "POST" && path === "/auth/v1/token") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: authSignInResponse,
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
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: userRolePayload,
      });
      return;
    }

    if (method === "GET" && path === "/rest/v1/nutrient_definitions") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: state.nutrients,
      });
      return;
    }

    if (method === "GET" && path === "/rest/v1/family_members") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: state.members,
      });
      return;
    }

    if (method === "GET" && path === "/rest/v1/food_entries") {
      const params = url.searchParams;
      const memberId = params.get("member_id");
      const filtered = memberId
        ? state.entries.filter((entry) => entry.member_id === memberId.replace("eq.", ""))
        : state.entries;

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: filtered,
      });
      return;
    }

    if (method === "POST" && path === "/rest/v1/food_entries") {
      const payload = ((await request.postDataJSON()) ?? {}) as Record<string, string | number>;
      const consumedAt = typeof payload.consumed_at === "string" ? payload.consumed_at : formatIsoMinute("2026-03-22T07:00");
      const memberId = typeof payload.member_id === "string" ? payload.member_id : state.members[0]?.id ?? "member-adam";
      entryCounter += 1;
      const nextEntry = {
        id: `entry-${entryCounter}`,
        member_id: memberId,
        logged_by_user_id: testUser.id,
        photo_storage_path: null,
        consumed_at: consumedAt,
        item_name: typeof payload.item_name === "string" ? payload.item_name : "Manual entry",
        meal_type: "snack",
        serving_qty: Number(payload.serving_qty ?? 1),
        serving_unit: (typeof payload.serving_unit === "string" ? payload.serving_unit : "oz") || "oz",
        workflow_state: "finalized",
        source_confidence: 0.91,
        source_label: "manual",
        manual_notes: payload.manual_notes ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        food_entry_nutrients: [],
      };
      state.entries.unshift(nextEntry);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        json: {
          ...nextEntry,
          manual_notes: nextEntry.manual_notes ?? null,
        },
      });
      return;
    }

    if (method === "POST" && path === "/rest/v1/food_entry_nutrients") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        json: { success: true },
      });
      return;
    }

    if (method === "GET" && path === "/rest/v1/food_ai_sessions") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: [],
      });
      return;
    }

    if (method === "GET" && path === "/rest/v1/food_ai_candidates") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: [],
      });
      return;
    }

    await route.fallback();
  });
};

const ensureRealTestUser = async (email: string, password: string) => {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for real stack Playwright run.");
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
  throw new Error(`Unable to create local test user: ${response.status} ${body}`);
};

test("manual auth and entry flow for Food Tracker", async ({ page }) => {
  test.skip(REAL_STACK, "Real-stack mode uses the live test.");
  await mountSupabaseMocks(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Food Tracker" })).toBeVisible();
  await page.getByPlaceholder("you@example.com").fill("admin@example.com");
  await page.getByPlaceholder("Password").fill("changeme");
  await page.locator("form.auth-form button[type='submit']").click();

  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByText("Tracking for")).toBeVisible();

  await page.getByLabel("Tracking for").selectOption("member-adam");
  await page.getByPlaceholder("Apple, toast, chicken breast...").fill("Banana");
  await page.getByRole("spinbutton").first().fill("1.5");
  await page.getByLabel("Serving unit").fill("oz");
  await page.getByRole("button", { name: "Save entry" }).click();

  await expect(page.getByText("Entry saved.")).toBeVisible();
  await expect(page.getByText("Banana")).toBeVisible();
  await expect(page.getByText("No entries yet for this person.")).not.toBeVisible();
});

test("manual auth and entry flow for Food Tracker on real local stack", async ({ page }) => {
  test.skip(!REAL_STACK, "Set PLAYWRIGHT_REAL_STACK=1 to run this test.");
  test.skip(!SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY missing.");

  await ensureRealTestUser(REAL_EMAIL, REAL_PASSWORD);
  await page.goto("/");

  await page.getByPlaceholder("you@example.com").fill(REAL_EMAIL);
  await page.getByPlaceholder("Password").fill(REAL_PASSWORD);
  await page.locator("form.auth-form button[type='submit']").click();

  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByText("Tracking for")).toBeVisible();

  await page.getByLabel("Tracking for").selectOption({ index: 1 });
  await page.getByPlaceholder("Apple, toast, chicken breast...").fill("Banana");
  await page.getByRole("spinbutton").first().fill("1.5");
  await page.getByLabel("Serving unit").fill("oz");
  await page.getByRole("button", { name: "Save entry" }).click();

  await expect(page.getByText("Entry saved.")).toBeVisible();
  await expect(page.getByText("Banana")).toBeVisible();
  await expect(page.getByText("No entries yet for this person.")).not.toBeVisible();
});
