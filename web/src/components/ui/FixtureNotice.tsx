import { FlaskConical } from "lucide-react";

/** The mock service is opt-in and visibly labelled; it is never financial truth. */
export function FixtureNotice() {
  if (process.env.NEXT_PUBLIC_USE_FIXTURES !== "1") return null;
  return (
    <div role="status" className="mb-5 flex items-start gap-2 rounded-md bg-warning-surface px-3 py-2.5 text-[13px] leading-5 text-warning-text">
      <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p>Preview mode uses local mock data. It is not connected to the financial service.</p>
    </div>
  );
}
