import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AiCandidate,
  AiSession,
  FamilyMember,
  FoodAccessLevel,
  FoodEntryWithNutrients,
  NutrientDefinition,
} from "./types";

export const BACKEND_SCHEMA_NOT_READY_MESSAGE =
  "Food Tracker backend is not initialized for this project yet. Deployment must apply the Food Tracker schema before the app can be used.";

type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
};

export interface AiStateSnapshot {
  session: AiSession;
  clarifyingQuestions: string[];
  candidates: AiCandidate[];
}

const isSupabaseErrorLike = (error: unknown): error is SupabaseErrorLike =>
  typeof error === "object" && error !== null;

export const getBackendSchemaError = (error: unknown): string | null => {
  if (!isSupabaseErrorLike(error) || error.code !== "PGRST205") {
    return null;
  }

  const summary = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  if (!summary.includes("schema cache")) {
    return null;
  }

  return BACKEND_SCHEMA_NOT_READY_MESSAGE;
};

export const getAppErrorMessage = (error: unknown, fallback: string): string => {
  const schemaError = getBackendSchemaError(error);
  if (schemaError) {
    return schemaError;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (isSupabaseErrorLike(error) && typeof error.message === "string" && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
};

export const isTransientNetworkError = (error: unknown): boolean => {
  const message = getAppErrorMessage(error, "").toLowerCase();
  return (
    error instanceof TypeError ||
    message.includes("failed to fetch") ||
    message.includes("network request failed") ||
    message.includes("network error") ||
    message.includes("load failed")
  );
};

export const buildEmptyValueMap = (keys: string[]): Record<string, string> =>
  Object.fromEntries(keys.map((key) => [key, ""])) as Record<string, string>;

export const loadFamilyMembers = async (
  client: Pick<SupabaseClient, "from">,
): Promise<FamilyMember[]> => {
  const { data, error } = await client
    .from("family_members")
    .select("id,name,canonical_slug,is_active,default_timezone")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(getAppErrorMessage(error, "Unable to load tracked people."));
  }

  return (data ?? []) as FamilyMember[];
};

export const loadBootstrapData = async (
  client: Pick<SupabaseClient, "from">,
  userId: string,
): Promise<{
  role: FoodAccessLevel;
  nutrients: NutrientDefinition[];
  members: FamilyMember[];
}> => {
  const [roleData, nutrientData, members] = await Promise.all([
    client.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
    client
      .from("nutrient_definitions")
      .select("code,name,unit,category")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    loadFamilyMembers(client),
  ]);

  if (roleData.error) {
    throw new Error(getAppErrorMessage(roleData.error, "Unable to load account role."));
  }

  if (nutrientData.error) {
    throw new Error(getAppErrorMessage(nutrientData.error, "Unable to load nutrient definitions."));
  }

  return {
    role: (roleData.data?.role as FoodAccessLevel | undefined) ?? "logger",
    nutrients: (nutrientData.data ?? []) as NutrientDefinition[],
    members,
  };
};

export const loadFoodEntries = async (
  client: Pick<SupabaseClient, "from">,
  memberId: string,
): Promise<FoodEntryWithNutrients[]> => {
  const { data, error } = await client
    .from("food_entries")
    .select(
      "id,member_id,logged_by_user_id,photo_storage_path,consumed_at,item_name,meal_type,serving_qty,serving_unit,workflow_state,source_confidence,source_label,manual_notes,created_at,updated_at,food_entry_nutrients(nutrient_code,amount,unit,source,source_confidence)",
    )
    .eq("member_id", memberId)
    .order("consumed_at", { ascending: false })
    .limit(250);

  if (error) {
    throw new Error(getAppErrorMessage(error, "Unable to load food entries."));
  }

  const raw = (data ?? []) as Array<
    FoodEntryWithNutrients & {
      food_entry_nutrients?: FoodEntryWithNutrients["food_entry_nutrients"];
    }
  >;

  return raw.map((entry) => ({
    ...entry,
    food_entry_nutrients: entry.food_entry_nutrients ?? [],
  }));
};

export const loadAiStatesForEntries = async (
  client: Pick<SupabaseClient, "from">,
  entryIds: string[],
): Promise<Record<string, AiStateSnapshot>> => {
  if (entryIds.length === 0) {
    return {};
  }

  const { data: sessionData, error: sessionError } = await client
    .from("food_ai_sessions")
    .select("id,entry_id,current_round,state,model,overall_confidence,clarifying_questions")
    .in("entry_id", entryIds);

  if (sessionError) {
    throw new Error(getAppErrorMessage(sessionError, "Unable to load AI sessions."));
  }

  const sessions = ((sessionData ?? []) as AiSession[]).filter((row) => entryIds.includes(row.entry_id));
  if (sessions.length === 0) {
    return {};
  }

  const sessionIds = sessions.map((item) => item.id);
  const { data: candidateData, error: candidateError } = await client
    .from("food_ai_candidates")
    .select("id,session_id,position,item_name,serving_qty,serving_unit,confidence,rationale,payload,is_selected")
    .in("session_id", sessionIds)
    .order("position", { ascending: true });

  if (candidateError) {
    throw new Error(getAppErrorMessage(candidateError, "Unable to load AI candidates."));
  }

  const candidatesBySession = new Map<string, AiCandidate[]>();
  (candidateData ?? []).forEach((candidate) => {
    const typed = candidate as unknown as AiCandidate;
    const nextList = candidatesBySession.get(typed.session_id) ?? [];
    nextList.push(typed);
    candidatesBySession.set(typed.session_id, nextList);
  });

  return sessions.reduce<Record<string, AiStateSnapshot>>((acc, sessionRow) => {
    acc[sessionRow.entry_id] = {
      session: sessionRow,
      clarifyingQuestions: sessionRow.clarifying_questions ?? [],
      candidates: candidatesBySession.get(sessionRow.id) ?? [],
    };
    return acc;
  }, {});
};
