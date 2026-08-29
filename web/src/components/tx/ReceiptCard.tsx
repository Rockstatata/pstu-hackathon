import { Check, Copy, X } from "lucide-react";
import { AmountDisplay } from "@/components/money/AmountDisplay";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import type { Transfer } from "@/lib/types";

function receiptStatus(transfer: Transfer) {
  return transfer.status === "REVERSED" ? "REVERSED" : "COMPLETED";
}

export function ReceiptCard({ transfer, allowCopy = true }: { transfer: Transfer; allowCopy?: boolean }) {
  const completed = transfer.status === "COMPLETED";
  const timestamp = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(transfer.createdAt));

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(transfer.reference);
    } catch {
      // The reference remains visible and selectable if the Clipboard API is unavailable.
    }
  }

  return (
    <section className="card overflow-hidden" aria-label="Transfer receipt">
      <div className="flex flex-col items-center px-5 pb-6 pt-7 text-center">
        <span className={`mb-3 flex size-12 items-center justify-center rounded-full ${completed ? "bg-success-surface text-success-text" : "bg-purple-soft text-primary-text"}`}>
          {completed ? <Check aria-hidden className="size-6" /> : <X aria-hidden className="size-6" />}
        </span>
        <p className="text-[13px] font-medium text-text-secondary">{completed ? "Transfer complete" : "Transfer reversed"}</p>
        <AmountDisplay minor={transfer.amountMinor} kind={transfer.direction === "IN" ? "IN" : "OUT"} size="lg" className="mt-1" />
        <div className="mt-3"><StatusBadge status={receiptStatus(transfer)} /></div>
      </div>

      <dl className="border-t border-divider px-5 py-1">
        <ReceiptRow label={transfer.direction === "IN" ? "From" : "To"} value={transfer.counterpartyName} />
        <ReceiptRow label="Phone" value={transfer.counterpartyMaskedPhone} />
        {transfer.note && <ReceiptRow label="Note" value={transfer.note} />}
        <ReceiptRow label="Date & time" value={timestamp} />
        <div className="flex items-center justify-between gap-3 border-t border-divider py-3">
          <dt className="text-[13px] font-medium text-text-secondary">Transaction ID</dt>
          <dd className="flex items-center gap-1.5 text-right text-[13px] font-semibold text-text">
            <span className="tnum">{transfer.reference}</span>
            {allowCopy && <Button variant="ghost" className="size-9 !px-0" onClick={copyReference} aria-label="Copy transaction ID"><Copy aria-hidden className="size-4" /></Button>}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-divider py-3 last:border-0">
      <dt className="shrink-0 text-[13px] font-medium text-text-secondary">{label}</dt>
      <dd className="text-right text-[15px] text-text">{value}</dd>
    </div>
  );
}
