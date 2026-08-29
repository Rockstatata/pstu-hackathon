"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n/LanguageProvider";
import { AmountDisplay, type AmountKind } from "@/components/money/AmountDisplay";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { initialsOf } from "@/lib/money";
import type { Transfer } from "@/lib/types";

export function kindOf(t: Transfer): AmountKind {
  if (t.status === "REVERSED") return "REVERSAL";
  return t.direction === "IN" ? "IN" : "OUT";
}

export function TransactionListItem({ transfer }: { transfer: Transfer }) {
  const { t, formatDate } = useI18n();
  const time = formatDate(transfer.createdAt, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Link
      href={`/history/${transfer.reference}`}
      className="flex min-h-[4.5rem] items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-subtle active:bg-purple-soft"
    >
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-purple-soft text-[13px] font-semibold text-primary-text"
      >
        {initialsOf(transfer.counterpartyName)}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-text">
          {t(transfer.direction === "IN" ? "From" : "To")} {transfer.counterpartyName}
        </p>
        <p className="text-[13px] text-text-secondary">{time}</p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <AmountDisplay minor={transfer.amountMinor} kind={kindOf(transfer)} showIcon />
        {transfer.status === "REVERSED" && <StatusBadge status="REVERSED" />}
      </div>
    </Link>
  );
}
