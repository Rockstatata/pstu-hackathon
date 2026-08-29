import { initialsOf } from "@/lib/money";
import type { RecipientPreview } from "@/lib/types";

/**
 * The masked phone here is the safety-critical string on C2 — it is what stops
 * the right amount reaching the wrong person. It uses --text-secondary and
 * never --text-muted, which is barred from this component by the design system.
 */
export function RecipientCard({ recipient }: { recipient: RecipientPreview }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface-subtle p-3">
      <span
        aria-hidden
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-purple-soft text-[15px] font-semibold text-primary-text"
      >
        {initialsOf(recipient.fullName)}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold text-text">{recipient.fullName}</p>
        <p className="tnum text-[13px] text-text-secondary">{recipient.maskedPhone}</p>
      </div>
    </div>
  );
}
