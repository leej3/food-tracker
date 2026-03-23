import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  AVAILABLE_METRICS,
  type FoodAccessLevel,
  type FoodEntryWithNutrients,
  type FamilyMember,
  type ManualDraftPayload,
  type MealTime,
  type NutrientCode,
  type NutrientDefinition,
  type AiSession,
  type AiCandidate,
} from "../lib/types";
import { supabase } from "../lib/supabase";
import { buildHistorySuggestions, buildNutrientMap } from "../lib/fuzzy";
import {
  buildEmptyValueMap,
  getAppErrorMessage,
  isTransientNetworkError,
  loadAiStatesForEntries,
  loadBootstrapData,
  loadFoodEntries,
} from "../lib/backend";
import {
  DEFAULT_OPENAI_MODEL,
  VERIFIED_OPENAI_MODELS,
  type VerifiedOpenAIModel,
  invokeFoodAnalyze,
} from "../lib/food-analyze";
import {
  buildEditedNutrientPayload,
  buildManualDraftPayload,
  toLocalMinuteInput,
  toIsoMinute,
  validateEditableEntryDraft,
  validateManualDraftPayload,
} from "../lib/food-entry";
import {
  type QueuedManualEntry,
  enqueueManualEntry,
  getQueuedManualEntries,
  removeQueuedEntry,
} from "../lib/queue";
import { getPhotoInputBehavior } from "../lib/photo-input";
import { OfflineBanner } from "./OfflineBanner";
import { TrendChart } from "./TrendChart";
import { AdminPanel } from "./AdminPanel";

type EntryMode = "manual" | "photo";

interface AiFlowState {
  loading: boolean;
  session: AiSession | null;
  clarifyingQuestions: string[];
  candidates: AiCandidate[];
  followUp: string;
}

interface ManualFormState {
  itemName: string;
  consumedAt: string;
  mealType: MealTime;
  servingQty: string;
  servingUnit: string;
  manualNotes: string;
}

interface EditEntryFormState {
  entryId: string;
  itemName: string;
  consumedAt: string;
  mealType: MealTime;
  servingQty: string;
  servingUnit: string;
  manualNotes: string;
  nutrients: Record<string, string>;
}

const initialFormState = (): ManualFormState => ({
  itemName: "",
  consumedAt: toLocalMinuteInput(new Date()),
  mealType: "other",
  servingQty: "1",
  servingUnit: "oz",
  manualNotes: "",
});

const METRIC_NAMES: Record<NutrientCode, string> = {
  calories: "Calories",
  protein_g: "Protein (g)",
  total_fat_g: "Fat (g)",
  saturated_fat_g: "Saturated Fat (g)",
  trans_fat_g: "Trans Fat (g)",
  carbs_g: "Carbs (g)",
  fiber_g: "Fiber (g)",
  sugar_g: "Sugar (g)",
  added_sugar_g: "Added Sugar (g)",
  sodium_mg: "Sodium (mg)",
  potassium_mg: "Potassium (mg)",
  cholesterol_mg: "Cholesterol (mg)",
  calcium_mg: "Calcium (mg)",
  vitamin_b12_ug: "Vitamin B12 (mcg)",
  alcohol_g: "Alcohol (g)",
};

const getNutrientAmount = (
  entry: FoodEntryWithNutrients,
  code: NutrientCode,
): number => {
  const row = entry.food_entry_nutrients.find(
    (nutrient) => nutrient.nutrient_code === code,
  );
  return row ? row.amount : 0;
};

const buildEditDraftFromEntry = (
  entry: FoodEntryWithNutrients,
  nutrientDefinitions: NutrientDefinition[],
): EditEntryFormState => {
  const nutrients = nutrientDefinitions.reduce<Record<string, string>>(
    (acc, nutrient) => {
      const found = entry.food_entry_nutrients.find(
        (row) => row.nutrient_code === nutrient.code,
      );
      acc[nutrient.code] = found ? String(found.amount) : "";
      return acc;
    },
    {},
  );

  return {
    entryId: entry.id,
    itemName: entry.item_name,
    consumedAt: toLocalMinuteInput(new Date(entry.consumed_at)),
    mealType: entry.meal_type,
    servingQty: String(entry.serving_qty),
    servingUnit: entry.serving_unit,
    manualNotes: entry.manual_notes ?? "",
    nutrients,
  };
};

export const FoodTrackerPage = ({ session }: { session: Session }) => {
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [entries, setEntries] = useState<FoodEntryWithNutrients[]>([]);
  const [nutrientDefinitions, setNutrientDefinitions] = useState<
    NutrientDefinition[]
  >([]);
  const [historyItemNames, setHistoryItemNames] = useState<string[]>([]);
  const [queued, setQueued] = useState<QueuedManualEntry[]>([]);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [role, setRole] = useState<FoodAccessLevel>("logger");
  const [entryMode, setEntryMode] = useState<EntryMode>("manual");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoAnalyzeModel, setPhotoAnalyzeModel] =
    useState<VerifiedOpenAIModel>(DEFAULT_OPENAI_MODEL);
  const [form, setForm] = useState<ManualFormState>(initialFormState);
  const [nutrientValues, setNutrientValues] = useState<Record<string, string>>(
    {},
  );
  const [selectedMetric, setSelectedMetric] =
    useState<NutrientCode>("calories");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reviewEntryId, setReviewEntryId] = useState("");
  const [editingEntryId, setEditingEntryId] = useState("");
  const [editDraft, setEditDraft] = useState<EditEntryFormState | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [aiByEntry, setAiByEntry] = useState<Record<string, AiFlowState>>({});
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const nutrientMap = useMemo(
    () => buildNutrientMap(nutrientDefinitions),
    [nutrientDefinitions],
  );
  const historySuggestions = buildHistorySuggestions(
    form.itemName,
    historyItemNames,
  );
  const isAdmin = role === "admin";
  const photoInputBehavior = useMemo(
    () =>
      getPhotoInputBehavior({
        userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
        hasCaptureSupport:
          typeof document === "undefined"
            ? false
            : "capture" in document.createElement("input"),
        hasCoarsePointer:
          typeof window === "undefined" ||
          typeof window.matchMedia !== "function"
            ? false
            : window.matchMedia("(pointer: coarse)").matches,
      }),
    [],
  );

  useEffect(() => {
    const onLine = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onLine);
    window.addEventListener("offline", onOffline);

    void (async () => {
      setError("");
      setLoading(true);
      try {
        const bootstrap = await loadBootstrapData(supabase, session.user.id);
        setRole(bootstrap.role);
        setNutrientDefinitions(bootstrap.nutrients);
        setNutrientValues(
          buildEmptyValueMap(bootstrap.nutrients.map((row) => row.code)),
        );
        setMembers(bootstrap.members);
        if (!selectedMemberId && bootstrap.members.length > 0) {
          setSelectedMemberId(bootstrap.members[0].id);
        }
        await loadQueued();
      } catch (err) {
        setError(getAppErrorMessage(err, "Unable to load Food Tracker."));
      }
      setLoading(false);
    })();

    return () => {
      window.removeEventListener("online", onLine);
      window.removeEventListener("offline", onOffline);
    };
  }, [selectedMemberId, session.user.id]);

  useEffect(() => {
    if (entryMode === "manual") {
      setPhotoFile(null);
      if (photoInputRef.current) {
        photoInputRef.current.value = "";
      }
    }
  }, [entryMode]);

  const loadMembers = useCallback(async () => {
    try {
      const bootstrap = await loadBootstrapData(supabase, session.user.id);
      setRole(bootstrap.role);
      setMembers(bootstrap.members);
      if (!selectedMemberId && bootstrap.members.length > 0) {
        setSelectedMemberId(bootstrap.members[0].id);
      }
    } catch (err) {
      setError(getAppErrorMessage(err, "Unable to refresh tracked people."));
    }
  }, [selectedMemberId, session.user.id]);

  const loadQueued = async () => {
    setQueued(getQueuedManualEntries());
  };

  const syncQueued = async () => {
    if (syncingQueue || queued.length === 0 || !navigator.onLine) {
      return;
    }

    setSyncingQueue(true);
    for (const item of queued) {
      try {
        await insertManualEntry(item.payload);
        removeQueuedEntry(item.id);
      } catch (err) {
        if (!isTransientNetworkError(err)) {
          setError(getAppErrorMessage(err, "Unable to sync queued entries."));
        }
        break;
      }
    }
    await loadQueued();
    await loadEntriesForMember(selectedMemberId);
    setSyncingQueue(false);
  };

  const loadEntriesForMember = useCallback(
    async (memberId: string) => {
      try {
        const normalized = await loadFoodEntries(supabase, memberId);
        setEntries(normalized);

        if (
          editingEntryId &&
          !normalized.some((entry) => entry.id === editingEntryId)
        ) {
          setEditingEntryId("");
          setEditDraft(null);
        }

        if (
          reviewEntryId &&
          !normalized.some((entry) => entry.id === reviewEntryId)
        ) {
          setReviewEntryId("");
        }

        const names = Array.from(
          new Set(
            normalized.map((entry) => entry.item_name.trim()).filter(Boolean),
          ),
        );
        setHistoryItemNames(names);

        const nextAi = await loadAiStatesForEntries(
          supabase,
          normalized.map((entry) => entry.id),
        );

        setAiByEntry(
          Object.fromEntries(
            Object.entries(nextAi).map(([entryId, snapshot]) => [
              entryId,
              {
                loading: false,
                session: snapshot.session,
                clarifyingQuestions: snapshot.clarifyingQuestions,
                candidates: snapshot.candidates,
                followUp: "",
              } satisfies AiFlowState,
            ]),
          ),
        );
      } catch (err) {
        setError(
          getAppErrorMessage(err, "Unable to load entries for this person."),
        );
      }
    },
    [editingEntryId, reviewEntryId],
  );

  useEffect(() => {
    if (!selectedMemberId) {
      setEntries([]);
      setHistoryItemNames([]);
      setReviewEntryId("");
      setEditingEntryId("");
      setEditDraft(null);
      return;
    }

    void loadEntriesForMember(selectedMemberId);
  }, [loadEntriesForMember, selectedMemberId]);

  const insertManualEntry = async (
    payload: ManualDraftPayload,
  ): Promise<void> => {
    const entryPayload = {
      member_id: payload.member_id,
      item_name: payload.item_name.trim() || "Manual entry",
      consumed_at: payload.consumed_at,
      meal_type: payload.meal_type,
      serving_qty: payload.serving_qty,
      serving_unit: payload.serving_unit || "oz",
      workflow_state: "finalized",
      manual_notes: payload.manual_notes || null,
    };

    const { data: newEntry, error: entryError } = await supabase
      .from("food_entries")
      .insert(entryPayload)
      .select("id")
      .single();

    if (entryError || !newEntry) {
      throw new Error(getAppErrorMessage(entryError, "Unable to save entry."));
    }

    const nutrients = Object.entries(payload.nutrients)
      .map(([nutrientCode, amount]) => {
        if (!(amount >= 0)) {
          return null;
        }

        if (!nutrientCode) {
          return null;
        }

        const definition = nutrientMap[nutrientCode];
        if (!definition) {
          return null;
        }

        return {
          entry_id: newEntry.id,
          nutrient_code: nutrientCode,
          amount,
          unit: definition.unit,
          source: "manual" as const,
          source_confidence: 1,
        };
      })
      .filter(Boolean) as Array<{
      entry_id: string;
      nutrient_code: string;
      amount: number;
      unit: string;
      source: "manual";
      source_confidence: number;
    }>;

    if (nutrients.length > 0) {
      const { error: nutrientError } = await supabase
        .from("food_entry_nutrients")
        .insert(nutrients);
      if (nutrientError) {
        throw new Error(
          getAppErrorMessage(
            nutrientError,
            "Saved entry, but failed to store nutrients.",
          ),
        );
      }
    }
  };

  const saveManual = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedMemberId || submitting) {
      return;
    }

    setError("");
    setMessage("");
    setSubmitting(true);

    const payload = buildManualDraftPayload({
      memberId: selectedMemberId,
      itemName: form.itemName,
      consumedAt: form.consumedAt,
      mealType: form.mealType,
      servingQty: form.servingQty,
      servingUnit: form.servingUnit,
      manualNotes: form.manualNotes,
      nutrientValues,
    });

    const validationError = validateManualDraftPayload(payload);
    if (validationError) {
      setError(validationError);
      setSubmitting(false);
      return;
    }

    if (!navigator.onLine) {
      enqueueManualEntry(payload);
      setMessage("Saved locally. It will sync when online.");
      setQueued(getQueuedManualEntries());
      setSubmitting(false);
      setForm(initialFormState());
      setNutrientValues((prev) => buildEmptyValueMap(Object.keys(prev)));
      return;
    }

    try {
      await insertManualEntry(payload);
      setMessage("Entry saved.");
      setForm(initialFormState());
      setNutrientValues((prev) => buildEmptyValueMap(Object.keys(prev)));
      await loadEntriesForMember(selectedMemberId);
    } catch (err) {
      if (!navigator.onLine || isTransientNetworkError(err)) {
        enqueueManualEntry(payload);
        setMessage("Saved offline due to network issue; queued for retry.");
        setQueued(getQueuedManualEntries());
      } else {
        setError(getAppErrorMessage(err, "Unable to save entry."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const callAiAnalyze = async (
    entryId: string,
    action: "analyze" | "follow_up",
    messageText: string,
    modelOverride?: string,
  ) => {
    const requestedModel = modelOverride?.trim() ?? "";
    const result = await invokeFoodAnalyze(session, {
      entryId,
      action,
      message: messageText,
      ...(action === "analyze" && requestedModel
        ? { model: requestedModel }
        : {}),
    });

    const nextSession = result.session;
    if (!nextSession) {
      return;
    }

    setAiByEntry((prev) => ({
      ...prev,
      [entryId]: {
        ...prev[entryId],
        loading: false,
        session: {
          id: nextSession.id,
          entry_id: entryId,
          current_round: nextSession.current_round ?? 1,
          state:
            (nextSession.state as unknown as AiSession["state"]) ?? "candidate",
          model:
            nextSession.model ??
            result.inference_model ??
            (requestedModel || DEFAULT_OPENAI_MODEL),
          overall_confidence: nextSession.overall_confidence,
          clarifying_questions: nextSession.clarifying_questions ?? [],
        },
        clarifyingQuestions: nextSession.clarifying_questions ?? [],
        candidates: result.candidates ?? [],
        followUp: "",
      },
    }));

    if (result.candidates) {
      await loadEntriesForMember(selectedMemberId);
    }
  };

  const submitPhoto = async (event: FormEvent) => {
    event.preventDefault();
    if (
      entryMode !== "photo" ||
      !selectedMemberId ||
      !photoFile ||
      submitting
    ) {
      return;
    }

    setSubmitting(true);
    setError("");
    setMessage("");

    const photoServingQty = Number.parseFloat(form.servingQty);
    if (!Number.isFinite(photoServingQty) || photoServingQty <= 0) {
      setError("Serving quantity must be a positive number.");
      setSubmitting(false);
      return;
    }

    if (!form.servingUnit.trim()) {
      setError("Serving unit is required.");
      setSubmitting(false);
      return;
    }

    const cleanedFileName = form.itemName.trim() || "photo";
    const extension = photoFile.name.split(".").pop() ?? "jpg";
    const path = `${session.user.id}/${selectedMemberId}/${Date.now()}-${cleanedFileName.replace(/[^a-z0-9]/gi, "_").slice(0, 20)}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("food-photos")
      .upload(path, photoFile, {
        upsert: false,
        contentType: photoFile.type || "image/jpeg",
      });
    if (uploadError) {
      setError(getAppErrorMessage(uploadError, "Unable to upload photo."));
      setSubmitting(false);
      return;
    }

    const { data: entryData, error: entryError } = await supabase
      .from("food_entries")
      .insert({
        member_id: selectedMemberId,
        item_name: cleanedFileName,
        consumed_at: toIsoMinute(form.consumedAt),
        meal_type: form.mealType,
        serving_qty: photoServingQty,
        serving_unit: form.servingUnit.trim() || "oz",
        photo_storage_path: path,
        workflow_state: "analysis_pending",
        manual_notes: form.manualNotes || null,
      })
      .select("id")
      .single();

    if (entryError || !entryData?.id) {
      setError(getAppErrorMessage(entryError, "Unable to create entry."));
      setSubmitting(false);
      return;
    }

    try {
      await callAiAnalyze(entryData.id, "analyze", "", photoAnalyzeModel);
      setReviewEntryId(entryData.id);
      setMessage("Photo uploaded. AI candidates generated.");
    } catch (analyzeError) {
      setError(getAppErrorMessage(analyzeError, "Unable to analyze image."));
    }

    setPhotoFile(null);
    if (photoInputRef.current) {
      photoInputRef.current.value = "";
    }
    setSubmitting(false);
    await loadEntriesForMember(selectedMemberId);
  };

  const handlePhotoInput = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }

    setPhotoFile(files[0]);
    if (!form.itemName) {
      setForm((current) => ({
        ...current,
        itemName:
          files[0].name.split(".").slice(0, -1).join(".") || "Photo item",
      }));
    }
  };

  const applyCandidate = async (entryId: string, candidateId: string) => {
    const { error } = await supabase.rpc("apply_food_entry_ai_candidate", {
      p_entry_id: entryId,
      p_candidate_id: candidateId,
    });
    if (error) {
      setError(getAppErrorMessage(error, "Unable to apply candidate."));
      return;
    }

    setMessage(
      "Candidate applied. You can still edit values before finalizing.",
    );
    await loadEntriesForMember(selectedMemberId);
  };

  const finalizeEntry = async (entryId: string) => {
    const { error } = await supabase.rpc("finalize_food_entry", {
      p_entry_id: entryId,
    });
    if (error) {
      setError(getAppErrorMessage(error, "Unable to finalize entry."));
      return;
    }

    await loadEntriesForMember(selectedMemberId);
    setMessage("Entry finalized.");
  };

  const openReview = (entryId: string) => {
    setReviewEntryId(entryId === reviewEntryId ? "" : entryId);
  };

  const openEdit = (entry: FoodEntryWithNutrients) => {
    setEditDraft(buildEditDraftFromEntry(entry, nutrientDefinitions));
    setEditingEntryId(entry.id);
    setReviewEntryId("");
    setMessage("");
    setError("");
  };

  const closeEdit = () => {
    setEditDraft(null);
    setEditingEntryId("");
  };

  const saveEditedEntry = async (event: FormEvent) => {
    event.preventDefault();
    if (!editDraft || editSubmitting) {
      return;
    }

    const validationError = validateEditableEntryDraft(editDraft);
    if (validationError) {
      setError(validationError);
      return;
    }

    const editedServingQty = Number.parseFloat(editDraft.servingQty);
    setError("");
    setMessage("");
    setEditSubmitting(true);

    try {
      const nutrients = buildEditedNutrientPayload(
        editDraft.nutrients,
        nutrientMap,
      );

      const { error } = await supabase.rpc("update_food_entry_with_values", {
        p_entry_id: editDraft.entryId,
        p_item_name: editDraft.itemName.trim(),
        p_consumed_at: toIsoMinute(editDraft.consumedAt),
        p_meal_type: editDraft.mealType,
        p_serving_qty: editedServingQty,
        p_serving_unit: editDraft.servingUnit.trim(),
        p_manual_notes: editDraft.manualNotes || "",
        p_nutrients: nutrients,
      });

      if (error) {
        setError(getAppErrorMessage(error, "Unable to update entry."));
        return;
      }

      setMessage("Entry updated.");
      await loadEntriesForMember(selectedMemberId);
      closeEdit();
    } catch (err) {
      setError(getAppErrorMessage(err, "Unable to save edited entry."));
    } finally {
      setEditSubmitting(false);
    }
  };

  const sendFollowUp = async (entryId: string) => {
    const entryAi = aiByEntry[entryId];
    if (!entryAi || !entryAi.followUp.trim()) {
      return;
    }
    setAiByEntry((prev) => ({
      ...prev,
      [entryId]: { ...prev[entryId], loading: true },
    }));

    try {
      await callAiAnalyze(entryId, "follow_up", entryAi.followUp.trim());
      setAiByEntry((prev) => ({
        ...prev,
        [entryId]: { ...prev[entryId], followUp: "" },
      }));
    } catch (err) {
      setError(getAppErrorMessage(err, "Follow-up failed."));
      setAiByEntry((prev) => ({
        ...prev,
        [entryId]: { ...prev[entryId], loading: false },
      }));
    }
  };

  const resetForm = () => {
    setForm(initialFormState());
    setNutrientValues((prev) => buildEmptyValueMap(Object.keys(prev)));
    setPhotoFile(null);
    if (photoInputRef.current) {
      photoInputRef.current.value = "";
    }
  };

  const activeAi = reviewEntryId ? aiByEntry[reviewEntryId] : null;
  const activeEntry = reviewEntryId
    ? (entries.find((entry) => entry.id === reviewEntryId) ?? null)
    : null;

  if (loading) {
    return <p className="page-status">Loading food tracker...</p>;
  }

  return (
    <main className="page">
      <header className="topbar">
        <h1>Food Tracker</h1>
        <div className="userline">
          <span>{session.user.email}</span>
          <button type="button" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <OfflineBanner
        queued={queued}
        isOnline={online}
        onRetry={() => void syncQueued()}
        syncing={syncingQueue}
      />

      <section className="panel">
        <div className="member-select-row">
          <label htmlFor="member">Tracking for</label>
          <select
            id="member"
            value={selectedMemberId}
            onChange={(event) => setSelectedMemberId(event.target.value)}
          >
            <option value="">Select person</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          {isAdmin ? (
            <button onClick={() => void syncQueued()}>Sync queue</button>
          ) : null}
        </div>

        <TrendChart
          entries={entries}
          metricCode={selectedMetric}
          metricLabel={METRIC_NAMES[selectedMetric]}
        />
        <div className="metric-select">
          <label htmlFor="metric">Trend metric</label>
          <select
            id="metric"
            value={selectedMetric}
            onChange={(event) =>
              setSelectedMetric(event.target.value as NutrientCode)
            }
          >
            {AVAILABLE_METRICS.map((metric) => (
              <option key={metric} value={metric}>
                {METRIC_NAMES[metric]}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="panel">
        <h2>New entry</h2>
        <div className="mode-switch">
          <button
            type="button"
            className={entryMode === "manual" ? "active" : ""}
            onClick={() => setEntryMode("manual")}
          >
            Manual
          </button>
          <button
            type="button"
            className={entryMode === "photo" ? "active" : ""}
            onClick={() => setEntryMode("photo")}
          >
            Photo
          </button>
        </div>

        <form
          className="entry-form"
          onSubmit={entryMode === "manual" ? saveManual : submitPhoto}
        >
          <div className="field-row">
            <label>Item name</label>
            <input
              list="history-items"
              value={form.itemName}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  itemName: event.target.value,
                }))
              }
              placeholder="Apple, toast, chicken breast..."
            />
            <datalist id="history-items">
              {historySuggestions.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          </div>

          <div className="form-grid">
            <label>
              Time
              <input
                type="datetime-local"
                step={60}
                value={form.consumedAt}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    consumedAt: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Meal
              <select
                value={form.mealType}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    mealType: event.target.value as MealTime,
                  }))
                }
              >
                <option value="breakfast">Breakfast</option>
                <option value="lunch">Lunch</option>
                <option value="dinner">Dinner</option>
                <option value="snack">Snack</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Serving
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={form.servingQty}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    servingQty: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Serving unit
              <input
                value={form.servingUnit}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    servingUnit: event.target.value,
                  }))
                }
                placeholder="oz"
              />
            </label>
          </div>

          {entryMode === "photo" ? (
            <div className="photo-control">
              <input
                ref={photoInputRef}
                className="visually-hidden"
                data-testid="photo-input"
                type="file"
                accept="image/*"
                capture={photoInputBehavior.capture}
                onChange={handlePhotoInput}
              />
              <div className="photo-picker-row">
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                >
                  Add photo
                </button>
                <span className="photo-file-name">
                  {photoFile ? photoFile.name : "No photo selected yet."}
                </span>
              </div>
              <label>
                OpenAI model
                <select
                  value={photoAnalyzeModel}
                  onChange={(event) =>
                    setPhotoAnalyzeModel(
                      event.target.value as VerifiedOpenAIModel,
                    )
                  }
                >
                  {VERIFIED_OPENAI_MODELS.map((modelOption) => (
                    <option key={modelOption.id} value={modelOption.id}>
                      {modelOption.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="photo-help">{photoInputBehavior.helperText}</p>
            </div>
          ) : null}

          <label>
            Notes
            <textarea
              value={form.manualNotes}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  manualNotes: event.target.value,
                }))
              }
            />
          </label>

          {entryMode === "manual" ? (
            <details>
              <summary>Nutrients (oz-based entry, optional)</summary>
              <div className="nutrient-grid">
                {nutrientDefinitions.map((nutrient) => (
                  <label key={nutrient.code}>
                    {nutrient.name} ({nutrient.unit})
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={nutrientValues[nutrient.code] ?? ""}
                      onChange={(event) =>
                        setNutrientValues((current) => ({
                          ...current,
                          [nutrient.code]: event.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            </details>
          ) : null}

          {error ? <p className="error">{error}</p> : null}
          {message ? <p className="success">{message}</p> : null}
          <div className="button-row">
            <button
              type="submit"
              disabled={submitting || (entryMode === "photo" && !photoFile)}
            >
              {submitting
                ? "Saving..."
                : entryMode === "manual"
                  ? "Save entry"
                  : "Upload + analyze"}
            </button>
            <button type="button" onClick={resetForm}>
              Reset
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>Recent entries</h2>
        {entries.length === 0 ? (
          <p className="empty-state">No entries yet for this person.</p>
        ) : (
          <table className="entry-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Item</th>
                <th>Serving</th>
                <th>Calories</th>
                <th>Protein</th>
                <th>Confidence</th>
                <th>State</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.consumed_at).toLocaleString()}</td>
                  <td>{entry.item_name}</td>
                  <td>
                    {entry.serving_qty} {entry.serving_unit}
                  </td>
                  <td>{getNutrientAmount(entry, "calories").toFixed(1)}</td>
                  <td>{getNutrientAmount(entry, "protein_g").toFixed(1)}</td>
                  <td>
                    {entry.source_confidence !== null
                      ? `${Math.round(entry.source_confidence * 100)}%`
                      : "—"}
                  </td>
                  <td>{entry.workflow_state}</td>
                  <td>
                    <button type="button" onClick={() => openReview(entry.id)}>
                      Review
                    </button>
                    <button type="button" onClick={() => openEdit(entry)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {editDraft ? (
        <section className="panel">
          <h2>Edit entry</h2>
          <form className="entry-form" onSubmit={saveEditedEntry}>
            <div className="field-row">
              <label>Item name</label>
              <input
                value={editDraft.itemName}
                onChange={(event) =>
                  setEditDraft((current) =>
                    current
                      ? { ...current, itemName: event.target.value }
                      : null,
                  )
                }
              />
            </div>
            <div className="form-grid">
              <label>
                Time
                <input
                  type="datetime-local"
                  step={60}
                  value={editDraft.consumedAt}
                  onChange={(event) =>
                    setEditDraft((current) =>
                      current
                        ? { ...current, consumedAt: event.target.value }
                        : null,
                    )
                  }
                />
              </label>
              <label>
                Meal
                <select
                  value={editDraft.mealType}
                  onChange={(event) =>
                    setEditDraft((current) =>
                      current
                        ? {
                            ...current,
                            mealType: event.target.value as MealTime,
                          }
                        : current,
                    )
                  }
                >
                  <option value="breakfast">Breakfast</option>
                  <option value="lunch">Lunch</option>
                  <option value="dinner">Dinner</option>
                  <option value="snack">Snack</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                Serving
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={editDraft.servingQty}
                  onChange={(event) =>
                    setEditDraft((current) =>
                      current
                        ? { ...current, servingQty: event.target.value }
                        : null,
                    )
                  }
                />
              </label>
              <label>
                Serving unit
                <input
                  value={editDraft.servingUnit}
                  onChange={(event) =>
                    setEditDraft((current) =>
                      current
                        ? { ...current, servingUnit: event.target.value }
                        : null,
                    )
                  }
                />
              </label>
            </div>
            <label>
              Notes
              <textarea
                value={editDraft.manualNotes}
                onChange={(event) =>
                  setEditDraft((current) =>
                    current
                      ? { ...current, manualNotes: event.target.value }
                      : null,
                  )
                }
              />
            </label>

            <details>
              <summary>Edit nutrient values</summary>
              <div className="nutrient-grid">
                {nutrientDefinitions.map((nutrient) => (
                  <label key={nutrient.code}>
                    {nutrient.name} ({nutrient.unit})
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={editDraft.nutrients[nutrient.code] ?? ""}
                      onChange={(event) =>
                        setEditDraft((current) => {
                          if (!current) {
                            return current;
                          }
                          return {
                            ...current,
                            nutrients: {
                              ...current.nutrients,
                              [nutrient.code]: event.target.value,
                            },
                          };
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </details>

            <div className="button-row">
              <button type="submit" disabled={editSubmitting}>
                {editSubmitting ? "Saving..." : "Save edited entry"}
              </button>
              <button type="button" onClick={closeEdit}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {activeEntry ? (
        <section className="panel">
          <h2>Review AI candidate for {activeEntry.item_name}</h2>
          <p>
            {activeAi?.loading
              ? "Running AI analysis..."
              : "Adjust candidate choice and continue."}
          </p>
          {activeAi?.session ? (
            <>
              <p>
                Overall confidence:{" "}
                {Math.round((activeAi.session.overall_confidence ?? 0) * 100)}%
              </p>
              <p>OpenAI model: {activeAi.session.model}</p>
              <ol className="candidate-list">
                {activeAi.candidates.map((candidate) => (
                  <li
                    key={candidate.id}
                    className={
                      candidate.is_selected ? "candidate-selected" : ""
                    }
                  >
                    <strong>{candidate.item_name}</strong> —{" "}
                    {candidate.serving_qty} {candidate.serving_unit}
                    <p>
                      Confidence: {(candidate.confidence * 100).toFixed(0)}%
                    </p>
                    <p>{candidate.rationale || "No rationale provided."}</p>
                    <button
                      type="button"
                      onClick={() =>
                        void applyCandidate(activeEntry.id, candidate.id)
                      }
                    >
                      Apply this candidate
                    </button>
                  </li>
                ))}
              </ol>
              {activeAi.candidates.length === 0 ? (
                <p className="empty-state">No candidates yet.</p>
              ) : null}
            </>
          ) : (
            <p className="empty-state">No AI session for this entry.</p>
          )}

          {activeAi && activeAi.clarifyingQuestions.length > 0 ? (
            <div className="clarifying">
              <h3>Model questions</h3>
              <ul>
                {activeAi.clarifyingQuestions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <label>
            Ask a follow-up to improve this estimate
            <input
              value={activeAi?.followUp ?? ""}
              onChange={(event) =>
                setAiByEntry((prev) => ({
                  ...prev,
                  [activeEntry.id]: {
                    ...(prev[activeEntry.id] ?? ({} as AiFlowState)),
                    followUp: event.target.value,
                  },
                }))
              }
            />
          </label>
          <div className="button-row">
            <button
              type="button"
              onClick={() => void sendFollowUp(activeEntry.id)}
              disabled={activeAi?.loading}
            >
              {activeAi?.loading ? "Working..." : "Send follow-up"}
            </button>
            <button
              type="button"
              onClick={() => void finalizeEntry(activeEntry.id)}
              disabled={activeEntry.workflow_state === "finalized"}
            >
              Finalize
            </button>
          </div>
          <button type="button" onClick={() => setReviewEntryId("")}>
            Close review
          </button>
        </section>
      ) : null}

      {isAdmin ? (
        <AdminPanel members={members} onMembersChanged={loadMembers} />
      ) : null}
    </main>
  );
};
