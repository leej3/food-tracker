import type { ManualDraftPayload } from "./types";

export interface QueuedManualEntry {
  id: string;
  kind: "manual_entry";
  created_at: string;
  payload: ManualDraftPayload;
}

const STORAGE_KEY = "foodTrackerOfflineQueueV1";

const readStoredQueue = (): QueuedManualEntry[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (item): item is QueuedManualEntry =>
        typeof item === "object" &&
        item !== null &&
        (item as QueuedManualEntry).kind === "manual_entry",
    );
  } catch {
    return [];
  }
};

const writeStoredQueue = (queue: QueuedManualEntry[]) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
};

export const getQueuedManualEntries = (): QueuedManualEntry[] => readStoredQueue();

export const enqueueManualEntry = (payload: ManualDraftPayload): QueuedManualEntry => {
  const current = readStoredQueue();
  const queued: QueuedManualEntry = {
    id: crypto.randomUUID(),
    kind: "manual_entry",
    created_at: new Date().toISOString(),
    payload,
  };
  current.push(queued);
  writeStoredQueue(current);
  return queued;
};

export const removeQueuedEntry = (id: string) => {
  const next = readStoredQueue().filter((entry) => entry.id !== id);
  writeStoredQueue(next);
};

export const clearQueue = () => writeStoredQueue([]);
