import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type AnalyzeBody = {
  entryId?: string;
  action?: "analyze" | "follow_up";
  message?: string;
  model?: string;
};

type NutritionCandidate = {
  code: string;
  amount: number;
  unit: string;
  confidence?: number;
};

type CandidatePayload = {
  item_name: string;
  serving_qty: number;
  serving_unit: string;
  confidence?: number;
  rationale?: string;
  nutrients: NutritionCandidate[];
};

type ModelResponse = {
  candidates: CandidatePayload[];
  clarifying_questions: string[];
  overall_confidence: number;
  next_step?: "follow_up" | "review";
  notes?: string;
};

type InferencePath = "openai";
type InferenceProvider = "openai";

type InferenceResult = {
  provider: InferenceProvider;
  path: InferencePath;
  model: string;
  parsed: ModelResponse;
  notes: Record<string, unknown>;
};

interface Env {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_REQUEST_TIMEOUT_MS?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
}

interface PagesFunctionContext {
  env: Env;
  request: Request;
  waitUntil: (promise: Promise<unknown>) => void;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_OPENAI_MODEL = "gpt-5.4-nano";
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });

const toNumberOrNull = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
};

const normalizeModelName = (value: unknown) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, 120);
};

const parseModelResponse = (content: string): ModelResponse => {
  const parsed = JSON.parse(content) as Partial<ModelResponse>;

  const candidates: CandidatePayload[] = Array.isArray(parsed.candidates)
    ? (parsed.candidates
        .map((candidate) => {
          const itemName =
            typeof candidate?.item_name === "string"
              ? candidate.item_name.trim()
              : "";
          if (itemName === "") {
            return null;
          }

          const servingQty = toNumberOrNull(candidate.serving_qty);
          if (servingQty === null) {
            return null;
          }

          const servingUnit =
            typeof candidate.serving_unit === "string" &&
            candidate.serving_unit.trim() !== ""
              ? candidate.serving_unit.trim()
              : "oz";

          const confidence = toNumberOrNull(candidate.confidence) ?? 0.5;
          const nutrients = Array.isArray(candidate.nutrients)
            ? candidate.nutrients
                .map((nutrient) => {
                  const code =
                    typeof nutrient.code === "string"
                      ? nutrient.code.trim().toLowerCase()
                      : "";
                  const amount = toNumberOrNull(nutrient.amount);
                  const unit =
                    typeof nutrient.unit === "string" &&
                    nutrient.unit.trim() !== ""
                      ? nutrient.unit.trim()
                      : "";

                  if (
                    code === "" ||
                    amount === null ||
                    amount < 0 ||
                    unit === ""
                  ) {
                    return null;
                  }

                  return {
                    code,
                    amount,
                    unit,
                    confidence:
                      toNumberOrNull(nutrient.confidence) ?? confidence,
                  };
                })
                .filter(Boolean)
            : [];

          return {
            item_name: itemName,
            serving_qty: servingQty,
            serving_unit: servingUnit,
            confidence: Math.max(0, Math.min(1, confidence)),
            rationale:
              typeof candidate.rationale === "string"
                ? candidate.rationale
                : undefined,
            nutrients,
          } as CandidatePayload;
        })
        .filter(Boolean) as CandidatePayload[])
    : [];

  const clarifyingQuestions = Array.isArray(parsed.clarifying_questions)
    ? parsed.clarifying_questions
        .map((question) =>
          typeof question === "string" ? question.trim() : "",
        )
        .filter((question) => question.length > 0)
    : [];

  const overallConfidence = toNumberOrNull(parsed.overall_confidence);

  return {
    candidates,
    clarifying_questions: clarifyingQuestions,
    overall_confidence:
      overallConfidence === null
        ? 0.5
        : Math.max(0, Math.min(1, overallConfidence)),
    next_step:
      parsed.next_step === "review"
        ? "review"
        : parsed.next_step === "follow_up"
          ? "follow_up"
          : clarifyingQuestions.length > 0
            ? "follow_up"
            : "review",
    notes: typeof parsed.notes === "string" ? parsed.notes : undefined,
  };
};

const buildOpenAIPayload = (
  imageUrl: string,
  previousMessages: Array<{ actor: string; payload: Record<string, unknown> }>,
  action: "analyze" | "follow_up",
  message: string,
  round: number,
  model: string,
) => {
  const systemPrompt = [
    "You are a nutrition assistant. The user wants an estimate for a food item shown in a photo.",
    "Return strict JSON only.",
    "For every candidate include likely nutrient values from the candidate list below.",
    "Use grams for grams, kcal for calories, mg for sodium/potassium/cholesterol/calcium, and mcg for vitamin_b12_ug.",
    "Confidence is 0 to 1. Higher means stronger confidence.",
    "Use the metric list exactly when possible: calories, protein_g, total_fat_g, saturated_fat_g, trans_fat_g, carbs_g, fiber_g, sugar_g, added_sugar_g, sodium_mg, potassium_mg, cholesterol_mg, calcium_mg, vitamin_b12_ug, alcohol_g.",
  ].join(" ");

  const baseMessages: Array<{
    role: string;
    content: Array<Record<string, string>> | string;
  }> = previousMessages.slice(-8).map((item) => {
    if (item.actor === "user") {
      return {
        role: "user",
        content: [
          {
            type: "text",
            text: `User clarification: ${JSON.stringify(item.payload)}`,
          },
        ],
      };
    }

    return {
      role: "assistant",
      content: [
        {
          type: "text",
          text: `Assistant turn: ${JSON.stringify(item.payload)}`,
        },
      ],
    };
  });

  const userTurn =
    action === "analyze"
      ? "Analyze this food image and return JSON with fields candidates, clarifying_questions, overall_confidence, next_step."
      : `Clarify this entry with the following user note: ${message}`;

  return {
    model,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      ...baseMessages,
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: imageUrl,
              detail: "low",
            },
          },
          {
            type: "text",
            text: `${userTurn} Round ${round}. ${message}`.trim(),
          },
        ],
      },
    ],
    temperature: 0.2,
    response_format: {
      type: "json_object",
    },
  };
};

const timeout = (ms: number) =>
  new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Request timed out after ${ms}ms`)), ms);
  });

const readWithTimeout = async (
  responsePromise: Promise<Response>,
  ms: number,
): Promise<Response> =>
  (await Promise.race([responsePromise, timeout(ms)])) as Response;

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> => readWithTimeout(fetch(url, init), ms);

const parseEnvFloat = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
};

const callOpenAIInference = async ({
  action,
  imageUrl,
  message,
  model,
  openAiKey,
  previousMessages,
  round,
  timeoutMs,
}: {
  action: "analyze" | "follow_up";
  imageUrl: string;
  message: string;
  model: string;
  openAiKey: string;
  previousMessages: Array<{ actor: string; payload: Record<string, unknown> }>;
  round: number;
  timeoutMs: number;
}): Promise<InferenceResult> => {
  const response = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildOpenAIPayload(
          imageUrl,
          previousMessages,
          action,
          message,
          round,
          model,
        ),
      ),
    },
    timeoutMs,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`openai failed: ${response.status} ${text}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("openai bad response");
  }

  return {
    provider: "openai",
    path: "openai",
    model,
    parsed: parseModelResponse(content),
    notes: {
      usage: payload?.usage ?? null,
      model: payload?.model ?? model,
    },
  };
};

const assertAdminLikeAccess = async (
  supabase: SupabaseClient,
  userId: string,
  memberId: string,
) => {
  const { data, error } = await supabase.rpc("can_access_member", {
    p_user_id: userId,
    p_member_id: memberId,
  });

  if (error) {
    return false;
  }

  return Boolean(data);
};

const parseBody = async (request: Request): Promise<AnalyzeBody | null> => {
  try {
    const raw = await request.json();
    if (!raw || typeof raw.entryId !== "string") {
      return null;
    }
    return raw as AnalyzeBody;
  } catch {
    return null;
  }
};

const logInferenceEvent = async (params: {
  entryId: string;
  model: string;
  notes: Record<string, unknown>;
  parsed: ModelResponse;
  path: InferencePath;
  provider: InferenceProvider;
  sessionId: string | null;
  supabase: SupabaseClient;
  userId: string;
}) => {
  const {
    entryId,
    model,
    notes,
    parsed,
    path,
    provider,
    sessionId,
    supabase,
    userId,
  } = params;

  await supabase.from("food_ai_inference_events").insert({
    entry_id: entryId,
    session_id: sessionId,
    actor_user_id: userId,
    inference_provider: provider,
    model,
    path,
    candidate_count: parsed.candidates.length,
    overall_confidence: parsed.overall_confidence,
    notes,
  });
};

export const onRequest = async ({
  env,
  request,
  waitUntil,
}: PagesFunctionContext) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const body = await parseBody(request);
  if (!body?.entryId) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const token = (request.headers.get("authorization") ?? "")
    .replace("Bearer ", "")
    .trim();
  const supabaseUrl = env.SUPABASE_URL;
  const publishableKey =
    request.headers.get("apikey")?.trim() || env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    return jsonResponse({ error: "missing_supabase_env" }, 500);
  }

  if (!token) {
    return jsonResponse({ error: "missing_auth" }, 401);
  }

  const supabase = createClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: publishableKey,
      },
    },
  }) as SupabaseClient;

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return jsonResponse({ error: "invalid_user" }, 401);
  }

  const { data: entry, error: entryError } = await supabase
    .from("food_entries")
    .select("id, member_id, photo_storage_path")
    .eq("id", body.entryId)
    .single();

  if (entryError || !entry) {
    return jsonResponse({ error: "entry_not_found" }, 404);
  }

  const hasAccess = await assertAdminLikeAccess(
    supabase,
    user.id,
    entry.member_id,
  );
  if (!hasAccess) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const action: "analyze" | "follow_up" =
    body.action === "follow_up" ? "follow_up" : "analyze";
  const actionMessage =
    action === "analyze"
      ? "Return top candidates with confidence values and nutrients."
      : (body.message ?? "").trim();

  const { data: existingSession } = await supabase
    .from("food_ai_sessions")
    .select("id, current_round, model")
    .eq("entry_id", entry.id)
    .maybeSingle();

  if (!entry.photo_storage_path && action === "analyze") {
    return jsonResponse(
      {
        error: "entry_has_no_photo",
        detail: "No photo path stored for this entry.",
      },
      400,
    );
  }

  let signedUrl = "";
  if (entry.photo_storage_path) {
    const { data: signedUrlData, error: signedUrlError } =
      await supabase.storage
        .from("food-photos")
        .createSignedUrl(entry.photo_storage_path, 60 * 20);
    if (signedUrlError || !signedUrlData?.signedUrl) {
      return jsonResponse({ error: "photo_unavailable" }, 400);
    }
    signedUrl = signedUrlData.signedUrl;
  }

  const openAiKey = env.OPENAI_API_KEY;
  const requestedModel = normalizeModelName(body.model);
  const defaultModel =
    existingSession?.model ||
    requestedModel ||
    env.OPENAI_MODEL ||
    DEFAULT_OPENAI_MODEL;
  const currentRound =
    action === "analyze" ? 1 : (existingSession?.current_round ?? 0) + 1;

  const { data: historyMessages } = await supabase
    .from("food_ai_messages")
    .select("actor, payload")
    .eq("session_id", existingSession?.id)
    .order("created_at", { ascending: true });

  const messageHistory = (historyMessages ?? []).map((row) => ({
    actor: row.actor,
    payload: (row.payload ?? {}) as Record<string, unknown>,
  }));

  if (!openAiKey) {
    return jsonResponse({ error: "missing_openai_key" }, 500);
  }

  const inference = await callOpenAIInference({
    action,
    imageUrl: signedUrl,
    message: actionMessage,
    model: defaultModel,
    openAiKey,
    previousMessages: messageHistory,
    round: currentRound,
    timeoutMs: parseEnvFloat(env.OPENAI_REQUEST_TIMEOUT_MS, 8000),
  });

  let sessionId = existingSession?.id ?? null;

  if (action === "analyze") {
    if (sessionId) {
      await supabase
        .from("food_ai_messages")
        .delete()
        .eq("session_id", sessionId);
      await supabase
        .from("food_ai_candidates")
        .delete()
        .eq("session_id", sessionId);
      await supabase
        .from("food_ai_sessions")
        .update({
          current_round: 1,
          state:
            inference.parsed.next_step === "follow_up"
              ? "follow_up"
              : "ready_for_review",
          overall_confidence: inference.parsed.overall_confidence,
          clarifying_questions: inference.parsed.clarifying_questions,
          model: inference.model,
        })
        .eq("id", sessionId);
    } else {
      const inserted = await supabase
        .from("food_ai_sessions")
        .insert({
          entry_id: entry.id,
          starter_user_id: user.id,
          current_round: 1,
          state:
            inference.parsed.next_step === "follow_up"
              ? "follow_up"
              : "ready_for_review",
          model: inference.model,
          overall_confidence: inference.parsed.overall_confidence,
          clarifying_questions: inference.parsed.clarifying_questions,
        })
        .select("id")
        .single();

      if (inserted.error || !inserted.data) {
        return jsonResponse({ error: "session_save_error" }, 500);
      }

      sessionId = inserted.data.id;
    }
  } else {
    if (!sessionId) {
      return jsonResponse({ error: "missing_session_for_followup" }, 400);
    }

    await supabase
      .from("food_ai_sessions")
      .update({
        current_round: currentRound,
        state:
          inference.parsed.next_step === "follow_up"
            ? "follow_up"
            : "ready_for_review",
        overall_confidence: inference.parsed.overall_confidence,
        clarifying_questions: inference.parsed.clarifying_questions,
        model: inference.model,
      })
      .eq("id", sessionId);
  }

  if (!sessionId) {
    return jsonResponse({ error: "session_missing" }, 500);
  }

  if (actionMessage.length > 0) {
    await supabase.from("food_ai_messages").insert({
      session_id: sessionId,
      actor: "user",
      payload: {
        action,
        text: actionMessage,
        response_confidence: inference.parsed.overall_confidence,
      },
    });
  }

  await supabase.from("food_ai_messages").insert({
    session_id: sessionId,
    actor: "assistant",
    payload: inference.parsed,
  });

  if (inference.parsed.candidates.length > 0) {
    const candidateRows = inference.parsed.candidates
      .slice(0, 5)
      .map((candidate, index) => ({
        session_id: sessionId,
        position: index + 1,
        item_name: candidate.item_name,
        serving_qty: candidate.serving_qty,
        serving_unit: candidate.serving_unit,
        confidence: candidate.confidence,
        rationale: candidate.rationale,
        payload: {
          nutrients: candidate.nutrients,
          notes: inference.parsed.notes,
        },
      }));

    const candidatesInsert = await supabase
      .from("food_ai_candidates")
      .insert(candidateRows);
    if (candidatesInsert.error) {
      return jsonResponse({ error: "candidate_save_error" }, 500);
    }
  }

  const { data: candidates } = await supabase
    .from("food_ai_candidates")
    .select(
      "id, session_id, position, item_name, serving_qty, serving_unit, confidence, rationale, payload, is_selected",
    )
    .eq("session_id", sessionId)
    .order("position", { ascending: true });

  const { data: stateData } = await supabase
    .from("food_ai_sessions")
    .select(
      "id, state, overall_confidence, clarifying_questions, current_round, model",
    )
    .eq("id", sessionId)
    .maybeSingle();

  waitUntil(
    logInferenceEvent({
      entryId: entry.id,
      model: inference.model,
      notes: {
        ...inference.notes,
        entry_action: action,
        candidate_count: inference.parsed.candidates.length,
        openai_model_requested: defaultModel,
      },
      parsed: inference.parsed,
      path: inference.path,
      provider: inference.provider,
      sessionId,
      supabase,
      userId: user.id,
    }).catch(() => undefined),
  );

  return jsonResponse({
    session: stateData,
    candidates: candidates ?? [],
    openai_notes: inference.parsed.notes,
    inference_provider: inference.provider,
    inference_path: inference.path,
    inference_model: inference.model,
  });
};
