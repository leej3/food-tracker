import { describe, expect, it } from "vitest";
import {
  BACKEND_SCHEMA_NOT_READY_MESSAGE,
  loadAiStatesForEntries,
  loadBootstrapData,
  loadFoodEntries,
} from "../../src/lib/backend";
import { createFromMock } from "../support/mockSupabase";

describe("backend loaders", () => {
  it("loads bootstrap data with role, nutrients, and members", async () => {
    const client = {
      from: createFromMock({
        user_roles: {
          data: { role: "admin" },
          error: null,
        },
        nutrient_definitions: {
          data: [{ code: "calories", name: "Calories", unit: "kcal", category: "macro" }],
          error: null,
        },
        family_members: {
          data: [{ id: "member-1", name: "Ada", canonical_slug: "ada", is_active: true, default_timezone: "America/New_York" }],
          error: null,
        },
      }),
    };

    await expect(loadBootstrapData(client as never, "user-1")).resolves.toEqual({
      role: "admin",
      nutrients: [{ code: "calories", name: "Calories", unit: "kcal", category: "macro" }],
      members: [{ id: "member-1", name: "Ada", canonical_slug: "ada", is_active: true, default_timezone: "America/New_York" }],
    });
  });

  it("throws a schema guidance error when required tables are missing", async () => {
    const client = {
      from: createFromMock({
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
    };

    await expect(loadBootstrapData(client as never, "user-1")).rejects.toThrow(
      BACKEND_SCHEMA_NOT_READY_MESSAGE,
    );
  });

  it("normalizes entry nutrients even when nested rows are omitted", async () => {
    const client = {
      from: createFromMock({
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
            },
          ],
          error: null,
        },
      }),
    };

    await expect(loadFoodEntries(client as never, "member-1")).resolves.toEqual([
      expect.objectContaining({
        id: "entry-1",
        food_entry_nutrients: [],
      }),
    ]);
  });

  it("maps AI sessions and candidates by entry id", async () => {
    const client = {
      from: createFromMock({
        food_ai_sessions: {
          data: [
            {
              id: "session-1",
              entry_id: "entry-1",
              current_round: 2,
              state: "follow_up",
              model: "gpt-5.4-nano",
              overall_confidence: 0.82,
              clarifying_questions: ["How much butter was used?"],
            },
          ],
          error: null,
        },
        food_ai_candidates: {
          data: [
            {
              id: "candidate-1",
              session_id: "session-1",
              position: 1,
              item_name: "Buttered toast",
              serving_qty: 2,
              serving_unit: "oz",
              confidence: 0.8,
              rationale: "Common serving estimate",
              payload: {},
              is_selected: false,
            },
          ],
          error: null,
        },
      }),
    };

    await expect(loadAiStatesForEntries(client as never, ["entry-1"])).resolves.toEqual({
      "entry-1": {
        session: expect.objectContaining({
          id: "session-1",
          current_round: 2,
        }),
        clarifyingQuestions: ["How much butter was used?"],
        candidates: [expect.objectContaining({ id: "candidate-1", item_name: "Buttered toast" })],
      },
    });
  });
});
