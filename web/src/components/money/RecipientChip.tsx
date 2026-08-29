import { X } from "lucide-react";
import { initialsOf } from "@/lib/money";
import type { RecipientPreview } from "@/lib/types";

export function RecipientChip({ recipient, onRemove }: { recipient: RecipientPreview; onRemove: () => void }) {
  return (
    <span className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full bg-purple-soft py-1 pl-1.5 pr-1 text-[13px] font-semibold text-primary-text">
      <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface text-[11px]">{initialsOf(recipient.fullName)}</span>
      <span className="truncate">{recipient.fullName}</span>
      <button type="button" onClick={onRemove} className="inline-flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-surface" aria-label={`Remove ${recipient.fullName}`}><X aria-hidden className="size-4" /></button>
    </span>
  );
}
