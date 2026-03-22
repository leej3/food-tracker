import type { QueuedManualEntry } from "../lib/queue";

interface OfflineBannerProps {
  queued: QueuedManualEntry[];
  isOnline: boolean;
  onRetry: () => void;
  syncing: boolean;
}

export const OfflineBanner = ({
  queued,
  isOnline,
  onRetry,
  syncing,
}: OfflineBannerProps) => {
  const queuedCount = queued.length;

  if (isOnline && queuedCount === 0) {
    return null;
  }

  return (
    <section className="banner">
      <p>
        {isOnline
          ? `You have ${queuedCount} queued manual entries waiting to sync.`
          : "You are currently offline. Manual entries are queued for later sync."}
      </p>
      {isOnline && queuedCount > 0 ? (
        <button type="button" onClick={onRetry} disabled={syncing}>
          {syncing ? "Syncing queued entries..." : "Retry queued entries"}
        </button>
      ) : null}
    </section>
  );
};
