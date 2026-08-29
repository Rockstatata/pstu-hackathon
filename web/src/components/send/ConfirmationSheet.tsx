"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { AmountDisplay } from "@/components/money/AmountDisplay";
import { RecipientCard } from "@/components/money/RecipientCard";
import { Button } from "@/components/ui/Button";
import { formatTaka } from "@/lib/money";
import type { RecipientPreview } from "@/lib/types";

interface Props {
  amountMinor: number;
  recipient: RecipientPreview;
  recipients?: RecipientPreview[];
  note: string;
  confirming: boolean;
  disabled?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  title?: string;
  eyebrow?: string;
  confirmLabel?: string;
  children?: ReactNode;
}

/** C2 is deliberately a confirmation gate, never a shortcut around recipient verification. */
export function ConfirmationSheet({ amountMinor, recipient, recipients, note, confirming, disabled = false, error, onCancel, onConfirm, title = "Send money", eyebrow = "Check the recipient carefully", confirmLabel, children }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/35 sm:items-center sm:justify-center sm:p-5" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        className="sheet-enter w-full rounded-t-xl bg-surface px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3 shadow-[var(--shadow-sheet)] sm:max-w-md sm:rounded-xl sm:p-6"
      >
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-divider sm:hidden" />
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[13px] font-medium text-text-secondary">{eyebrow}</p>
            <h1 id="confirmation-title" className="mt-1 text-[24px] font-semibold leading-8">{title}</h1>
          </div>
          <button type="button" onClick={onCancel} className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-surface-subtle" aria-label="Cancel confirmation">
            <X aria-hidden className="size-5" />
          </button>
        </div>

        <div className="my-6 text-center">
          <AmountDisplay minor={amountMinor} size="lg" />
        </div>
        {recipients && recipients.length > 1 ? <div className="max-h-52 space-y-2 overflow-y-auto pr-1">{recipients.map((item) => <RecipientCard key={item.userId} recipient={item} />)}</div> : <RecipientCard recipient={recipient} />}
        {note && <p className="mt-4 border-l-2 border-purple-border pl-3 text-[13px] leading-5 text-text-secondary">{note}</p>}
        {children}
        {error && <p aria-live="polite" className="mt-4 rounded-md bg-danger-surface px-3 py-2 text-[13px] font-medium text-danger-text">{error}</p>}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button variant="ghost" onClick={onCancel} disabled={confirming}>Cancel</Button>
          <Button onClick={onConfirm} loading={confirming} disabled={disabled}>{confirmLabel ?? `Confirm ${formatTaka(amountMinor)}`}</Button>
        </div>
      </section>
    </div>
  );
}
