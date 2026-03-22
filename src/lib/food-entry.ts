import type { MealTime, ManualDraftPayload, NutrientDefinition } from "./types";

export interface ManualEntryDraftInput {
  memberId: string;
  itemName: string;
  consumedAt: string;
  mealType: MealTime;
  servingQty: string;
  servingUnit: string;
  manualNotes: string;
  nutrientValues: Record<string, string>;
}

export interface EditableEntryDraftLike {
  itemName: string;
  servingQty: string;
  servingUnit: string;
  nutrients: Record<string, string>;
}

export const toLocalMinuteInput = (value: Date): string => {
  const date = new Date(value);
  date.setSeconds(0, 0);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}T${hour}:${minute}`;
};

export const toIsoMinute = (value: string): string => {
  const [datePart, timePart] = value.split("T");
  const [y, m, d] = datePart.split("-").map((part) => Number.parseInt(part, 10));
  const [hh, mm] = timePart.split(":").map((part) => Number.parseInt(part, 10));
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0).toISOString();
};

export const parseNumericNutrients = (nutrientValues: Record<string, string>): Record<string, number> =>
  Object.fromEntries(
    Object.entries(nutrientValues)
      .map(([code, value]) => {
        const parsed = Number.parseFloat(value);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return null;
        }

        return [code, parsed];
      })
      .filter((entry): entry is [string, number] => Boolean(entry)),
  );

export const buildManualDraftPayload = (input: ManualEntryDraftInput): ManualDraftPayload => ({
  member_id: input.memberId,
  item_name: input.itemName,
  consumed_at: toIsoMinute(input.consumedAt),
  meal_type: input.mealType,
  serving_qty: Number.parseFloat(input.servingQty),
  serving_unit: input.servingUnit,
  manual_notes: input.manualNotes,
  nutrients: parseNumericNutrients(input.nutrientValues),
});

export const validateManualDraftPayload = (payload: ManualDraftPayload): string | null => {
  if (!payload.member_id.trim()) {
    return "Choose a person before saving.";
  }

  if (!payload.item_name.trim()) {
    return "Item name is required.";
  }

  if (!Number.isFinite(payload.serving_qty) || payload.serving_qty <= 0) {
    return "Serving quantity must be a positive number.";
  }

  if (!payload.serving_unit.trim()) {
    return "Serving unit is required.";
  }

  return null;
};

export const validateEditableEntryDraft = (draft: EditableEntryDraftLike): string | null => {
  if (!draft.itemName.trim()) {
    return "Item name is required.";
  }

  const servingQty = Number.parseFloat(draft.servingQty);
  if (!Number.isFinite(servingQty) || servingQty <= 0) {
    return "Serving quantity must be a positive number.";
  }

  if (!draft.servingUnit.trim()) {
    return "Serving unit is required.";
  }

  return null;
};

export const buildEditedNutrientPayload = (
  nutrients: Record<string, string>,
  nutrientMap: Record<string, NutrientDefinition>,
): Array<{ nutrient_code: string; amount: number; unit: string }> =>
  Object.entries(nutrients)
    .map(([code, amountText]) => {
      const amount = Number.parseFloat(amountText);
      const definition = nutrientMap[code];
      if (!Number.isFinite(amount) || amount < 0 || !definition) {
        return null;
      }

      return {
        nutrient_code: code,
        amount,
        unit: definition.unit,
      };
    })
    .filter((entry): entry is { nutrient_code: string; amount: number; unit: string } => Boolean(entry));
