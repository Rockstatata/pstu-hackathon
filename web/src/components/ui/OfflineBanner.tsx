import { WifiOff } from "lucide-react";

export function OfflineBanner() {
  return (
    <div role="status" className="mb-5 flex items-center gap-2 rounded-md bg-warning-surface px-3 py-2.5 text-[13px] font-medium text-warning-text">
      <WifiOff aria-hidden className="size-4 shrink-0" />
      You are offline. Reconnect to securely send money.
    </div>
  );
}
