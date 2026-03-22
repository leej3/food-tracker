import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFromMock } from "../support/mockSupabase";

const { signOutMock, fromMock } = vi.hoisted(() => ({
  signOutMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("../../src/lib/supabase", () => ({
  supabase: {
    from: fromMock,
    auth: {
      signOut: signOutMock,
    },
  },
}));

vi.mock("../../src/components/OfflineBanner", () => ({
  OfflineBanner: () => <div>Offline banner</div>,
}));

vi.mock("../../src/components/TrendChart", () => ({
  TrendChart: () => <div>Trend chart</div>,
}));

vi.mock("../../src/components/AdminPanel", () => ({
  AdminPanel: () => <div>Admin panel</div>,
}));

import { FoodTrackerPage } from "../../src/components/FoodTrackerPage";

describe("FoodTrackerPage", () => {
  beforeEach(() => {
    fromMock.mockReset();
    signOutMock.mockReset();
  });

  it("shows an actionable schema message when bootstrap tables are missing", async () => {
    fromMock.mockImplementation(
      createFromMock({
        user_roles: {
          data: null,
          error: {
            code: "PGRST205",
            message: "Could not find the table 'public.user_roles' in the schema cache",
          },
        },
        nutrient_definitions: {
          data: [],
          error: null,
        },
        family_members: {
          data: [],
          error: null,
        },
      }),
    );

    render(
      <FoodTrackerPage
        session={{ user: { id: "user-1", email: "admin@example.com" } } as never}
      />,
    );

    expect(await screen.findByText(/backend is not initialized/i)).toBeInTheDocument();
  });

  it("loads members and entries after a successful bootstrap", async () => {
    fromMock.mockImplementation(
      createFromMock({
        user_roles: {
          data: { role: "admin" },
          error: null,
        },
        nutrient_definitions: {
          data: [{ code: "calories", name: "Calories", unit: "kcal", category: "macro" }],
          error: null,
        },
        family_members: {
          data: [
            {
              id: "member-1",
              name: "Ada",
              canonical_slug: "ada",
              is_active: true,
              default_timezone: "America/New_York",
            },
          ],
          error: null,
        },
        food_entries: {
          data: [
            {
              id: "entry-1",
              member_id: "member-1",
              logged_by_user_id: "user-1",
              photo_storage_path: null,
              consumed_at: "2026-03-22T07:30:00.000Z",
              item_name: "Toast",
              meal_type: "breakfast",
              serving_qty: 2,
              serving_unit: "oz",
              workflow_state: "finalized",
              source_confidence: 1,
              source_label: "manual",
              manual_notes: null,
              created_at: "2026-03-22T07:30:00.000Z",
              updated_at: "2026-03-22T07:30:00.000Z",
              food_entry_nutrients: [],
            },
          ],
          error: null,
        },
        food_ai_sessions: {
          data: [],
          error: null,
        },
      }),
    );

    render(
      <FoodTrackerPage
        session={{ user: { id: "user-1", email: "admin@example.com" } } as never}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Toast")).toBeInTheDocument();
    });

    expect(screen.getByRole("option", { name: "Ada" })).toBeInTheDocument();
    expect(screen.getByText("Recent entries")).toBeInTheDocument();
    expect(screen.getByText("Admin panel")).toBeInTheDocument();
  });
});
