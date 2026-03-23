export interface PhotoInputBehavior {
  capture?: "environment";
  helperText: string;
}

interface PhotoInputContext {
  userAgent: string;
  hasCaptureSupport: boolean;
  hasCoarsePointer: boolean;
}

const MOBILE_CAMERA_RE = /iPhone|iPad|iPod|Android/i;

export const shouldPreferCameraCapture = ({
  userAgent,
  hasCaptureSupport,
  hasCoarsePointer,
}: PhotoInputContext): boolean =>
  hasCaptureSupport && hasCoarsePointer && MOBILE_CAMERA_RE.test(userAgent);

export const getPhotoInputBehavior = (
  context: PhotoInputContext,
): PhotoInputBehavior => {
  if (shouldPreferCameraCapture(context)) {
    return {
      capture: "environment",
      helperText:
        "On supported phones, Add photo opens the camera first. If your browser offers a chooser, you can still pick a saved image.",
    };
  }

  return {
    helperText: "Choose a photo from your device to upload and analyze.",
  };
};
