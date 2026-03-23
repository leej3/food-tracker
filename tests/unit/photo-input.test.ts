import { describe, expect, it } from "vitest";
import {
  getPhotoInputBehavior,
  shouldPreferCameraCapture,
} from "../../src/lib/photo-input";

describe("photo input behavior", () => {
  it("prefers camera capture for coarse-pointer mobile browsers", () => {
    expect(
      shouldPreferCameraCapture({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1",
        hasCaptureSupport: true,
        hasCoarsePointer: true,
      }),
    ).toBe(true);
  });

  it("falls back to file picking for desktop browsers", () => {
    const behavior = getPhotoInputBehavior({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
      hasCaptureSupport: true,
      hasCoarsePointer: false,
    });

    expect(behavior.capture).toBeUndefined();
    expect(behavior.helperText).toMatch(/choose a photo/i);
  });
});
