import { describe, expect, it } from "vitest";
import { buildHistorySuggestions, buildNutrientMap } from "../../src/lib/fuzzy";

describe("buildHistorySuggestions", () => {
  it("returns no suggestions for empty input", () => {
    expect(buildHistorySuggestions("   ", ["Apple"])).toEqual([]);
  });

  it("prefers exact substring matches and removes duplicates", () => {
    expect(
      buildHistorySuggestions("apple", [
        "Apple slices",
        "Pineapple chunks",
        "Apple slices",
        "Maple oats",
      ]),
    ).toEqual(["Apple slices", "Pineapple chunks"]);
  });
});

describe("buildNutrientMap", () => {
  it("indexes nutrients by code", () => {
    expect(
      buildNutrientMap([
        { code: "calories", name: "Calories", unit: "kcal", category: "macro" },
        { code: "protein_g", name: "Protein", unit: "g", category: "macro" },
      ]),
    ).toEqual({
      calories: { code: "calories", name: "Calories", unit: "kcal", category: "macro" },
      protein_g: { code: "protein_g", name: "Protein", unit: "g", category: "macro" },
    });
  });
});
