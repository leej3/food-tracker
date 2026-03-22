import { beforeEach, describe, expect, it } from "vitest";
import {
  clearQueue,
  enqueueManualEntry,
  getQueuedManualEntries,
  removeQueuedEntry,
} from "../../src/lib/queue";

describe("offline queue", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearQueue();
  });

  it("stores and returns queued manual entries", () => {
    const queued = enqueueManualEntry({
      member_id: "member-1",
      item_name: "Greek yogurt",
      consumed_at: "2026-03-22T07:30:00.000Z",
      meal_type: "breakfast",
      serving_qty: 4,
      serving_unit: "oz",
      manual_notes: "",
      nutrients: { protein_g: 15 },
    });

    expect(getQueuedManualEntries()).toEqual([
      expect.objectContaining({
        id: queued.id,
        kind: "manual_entry",
        payload: expect.objectContaining({
          item_name: "Greek yogurt",
          nutrients: { protein_g: 15 },
        }),
      }),
    ]);
  });

  it("removes queued entries by id", () => {
    const first = enqueueManualEntry({
      member_id: "member-1",
      item_name: "Toast",
      consumed_at: "2026-03-22T07:30:00.000Z",
      meal_type: "breakfast",
      serving_qty: 2,
      serving_unit: "oz",
      manual_notes: "",
      nutrients: {},
    });
    enqueueManualEntry({
      member_id: "member-1",
      item_name: "Coffee",
      consumed_at: "2026-03-22T07:40:00.000Z",
      meal_type: "breakfast",
      serving_qty: 1,
      serving_unit: "cup",
      manual_notes: "",
      nutrients: {},
    });

    removeQueuedEntry(first.id);

    expect(getQueuedManualEntries()).toHaveLength(1);
    expect(getQueuedManualEntries()[0]?.payload.item_name).toBe("Coffee");
  });

  it("ignores malformed storage content", () => {
    window.localStorage.setItem("foodTrackerOfflineQueueV1", "{broken");
    expect(getQueuedManualEntries()).toEqual([]);
  });
});
