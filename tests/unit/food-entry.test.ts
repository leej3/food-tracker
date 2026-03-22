import { describe, expect, it } from "vitest";
import {
  buildEditedNutrientPayload,
  buildManualDraftPayload,
  parseNumericNutrients,
  validateEditableEntryDraft,
  validateManualDraftPayload,
} from "../../src/lib/food-entry";

describe("food entry helpers", () => {
  it("parses only valid numeric nutrient values", () => {
    expect(
      parseNumericNutrients({
        calories: "250",
        protein_g: "17.5",
        sugar_g: "-1",
        sodium_mg: "NaN",
      }),
    ).toEqual({
      calories: 250,
      protein_g: 17.5,
    });
  });

  it("builds a manual payload from form strings", () => {
    const payload = buildManualDraftPayload({
      memberId: "member-1",
      itemName: "Tomato soup",
      consumedAt: "2026-03-22T18:45",
      mealType: "dinner",
      servingQty: "8",
      servingUnit: "oz",
      manualNotes: "homemade",
      nutrientValues: {
        calories: "120",
        sodium_mg: "450",
      },
    });

    expect(payload).toEqual({
      member_id: "member-1",
      item_name: "Tomato soup",
      consumed_at: new Date(2026, 2, 22, 18, 45, 0, 0).toISOString(),
      meal_type: "dinner",
      serving_qty: 8,
      serving_unit: "oz",
      manual_notes: "homemade",
      nutrients: {
        calories: 120,
        sodium_mg: 450,
      },
    });
  });

  it("validates required manual entry fields", () => {
    expect(
      validateManualDraftPayload({
        member_id: "member-1",
        item_name: " ",
        consumed_at: "2026-03-22T18:45:00.000Z",
        meal_type: "dinner",
        serving_qty: 0,
        serving_unit: "",
        manual_notes: "",
        nutrients: {},
      }),
    ).toBe("Item name is required.");
  });

  it("validates editable drafts", () => {
    expect(
      validateEditableEntryDraft({
        itemName: "Soup",
        servingQty: "0",
        servingUnit: "oz",
        nutrients: {},
      }),
    ).toBe("Serving quantity must be a positive number.");
  });

  it("builds edited nutrients using known nutrient definitions only", () => {
    expect(
      buildEditedNutrientPayload(
        {
          calories: "120",
          protein_g: "8",
          sugar_g: "-3",
          unknown: "4",
        },
        {
          calories: { code: "calories", name: "Calories", unit: "kcal", category: "macro" },
          protein_g: { code: "protein_g", name: "Protein", unit: "g", category: "macro" },
        },
      ),
    ).toEqual([
      { nutrient_code: "calories", amount: 120, unit: "kcal" },
      { nutrient_code: "protein_g", amount: 8, unit: "g" },
    ]);
  });
});
