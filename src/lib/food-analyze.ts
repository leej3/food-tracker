import type { Session } from "@supabase/supabase-js";
import type { AiCandidate } from "./types";

type AnalyzeAction = "analyze" | "follow_up";

interface AnalyzeBody {
  entryId: string;
  action: AnalyzeAction;
  message?: string;
}

interface AnalyzeSessionResponse {
  id: string;
  current_round?: number;
  state: string;
  overall_confidence: number;
  clarifying_questions: string[];
  model?: string;
}

export interface FoodAnalyzeResponse {
  session: AnalyzeSessionResponse | null;
  candidates: AiCandidate[];
  inference_provider?: string;
  inference_path?: string;
  inference_model?: string;
  openai_notes?: string;
}

const FOOD_ANALYZE_PATH = "/api/food-analyze";
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY;

const getAnalyzeErrorMessage = (status: number, payload: unknown): string => {
  const detail =
    typeof payload === "object" && payload !== null
      ? typeof (payload as { detail?: unknown }).detail === "string"
        ? (payload as { detail: string }).detail
        : typeof (payload as { error?: unknown }).error === "string"
          ? (payload as { error: string }).error
          : ""
      : "";

  const normalized = detail.replaceAll("_", " ").trim();
  if (normalized) {
    return normalized;
  }

  if (status === 401) {
    return "Your session expired. Sign in again and retry.";
  }

  if (status === 403) {
    return "You do not have access to analyze photos for this person.";
  }

  if (status === 404) {
    return "The photo entry could not be found.";
  }

  if (status >= 500) {
    return "Photo analysis is unavailable right now.";
  }

  return "Unable to analyze photo.";
};

export const invokeFoodAnalyze = async (
  session: Session,
  body: AnalyzeBody,
): Promise<FoodAnalyzeResponse> => {
  if (!session.access_token) {
    throw new Error("Your session expired. Sign in again and retry.");
  }

  const response = await fetch(FOOD_ANALYZE_PATH, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...(supabasePublishableKey ? { apikey: supabasePublishableKey } : {}),
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = { error: text };
    }
  }

  if (!response.ok) {
    throw new Error(getAnalyzeErrorMessage(response.status, payload));
  }

  return (payload ?? {
    session: null,
    candidates: [],
  }) as FoodAnalyzeResponse;
};
