export type FoodAccessLevel = "admin" | "logger" | "viewer";
export type FoodEntryState = "analysis_pending" | "review_needed" | "finalized" | "archived";
export type MealTime = "breakfast" | "lunch" | "dinner" | "snack" | "other";
export type NutrientSource = "guessed" | "edited" | "verified" | "manual";
export type AiSessionState = "candidate" | "follow_up" | "ready_for_review" | "finalized" | "abandoned";

export const AVAILABLE_METRICS = [
  "calories",
  "protein_g",
  "total_fat_g",
  "saturated_fat_g",
  "trans_fat_g",
  "carbs_g",
  "fiber_g",
  "sugar_g",
  "added_sugar_g",
  "sodium_mg",
  "potassium_mg",
  "cholesterol_mg",
  "calcium_mg",
  "vitamin_b12_ug",
  "alcohol_g",
] as const;

export type NutrientCode = (typeof AVAILABLE_METRICS)[number];

export interface FamilyMember {
  id: string;
  name: string;
  canonical_slug: string;
  is_active: boolean;
  default_timezone: string;
}

export interface UserRole {
  user_id: string;
  role: FoodAccessLevel;
  granted_by: string | null;
}

export interface MemberAccess {
  id: string;
  member_id: string;
  user_id: string;
  access_level: FoodAccessLevel;
  granted_by: string | null;
}

export interface UserDirectoryRow {
  user_id: string;
  email: string;
}

export interface NutrientDefinition {
  code: string;
  name: string;
  unit: string;
  category: string;
}

export interface FoodEntryRow {
  id: string;
  member_id: string;
  logged_by_user_id: string;
  photo_storage_path: string | null;
  consumed_at: string;
  item_name: string;
  meal_type: MealTime;
  serving_qty: number;
  serving_unit: string;
  workflow_state: FoodEntryState;
  source_confidence: number | null;
  source_label: string | null;
  manual_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FoodEntryNutrient {
  id?: string;
  entry_id?: string;
  nutrient_code: string;
  amount: number;
  unit: string;
  source: NutrientSource;
  source_confidence: number;
}

export interface EditableFoodEntryPayload {
  p_item_name: string;
  p_consumed_at: string;
  p_meal_type: MealTime;
  p_serving_qty: number;
  p_serving_unit: string;
  p_manual_notes: string;
  p_nutrients: Array<{ nutrient_code: string; amount: number; unit: string }>;
}

export interface FoodEntryWithNutrients extends FoodEntryRow {
  food_entry_nutrients: FoodEntryNutrient[];
}

export interface AiSession {
  id: string;
  entry_id: string;
  current_round: number;
  state: AiSessionState;
  model: string;
  overall_confidence: number | null;
  clarifying_questions: string[] | null;
}

export interface AiCandidate {
  id: string;
  session_id: string;
  position: number;
  item_name: string;
  serving_qty: number;
  serving_unit: string;
  confidence: number;
  rationale: string | null;
  payload: { nutrients?: Array<{ code: string; amount: number; unit: string; confidence?: number }> };
  is_selected: boolean;
}

export interface ManualDraftPayload {
  member_id: string;
  item_name: string;
  consumed_at: string;
  meal_type: MealTime;
  serving_qty: number;
  serving_unit: string;
  manual_notes: string;
  nutrients: Record<string, number>;
}
