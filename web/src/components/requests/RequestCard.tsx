"use client";

import Link from "next/link";
import { ArrowRight, Clock3, RotateCcw } from "lucide-react";
import { useState } from "react";
import { AmountDisplay } from "@/components/money/AmountDisplay";
import { useI18n } from "@/components/i18n/LanguageProvider";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { BadgeStatus, MoneyRequest } from "@/lib/types";

function badgeFor(status: MoneyRequest["status"]): BadgeStatus {
  return status;
}

export function RequestCard({ request }: { request: MoneyRequest }) {
  const [now] = useState(() => Date.now());
  const { t, formatDate, formatNumber } = useI18n();
  const expiry = new Date(request.expiresAt).getTime() - now;
  const expiresIn = expiry > 0 ? t("Expires in {hours}h", { hours: formatNumber(Math.ceil(expiry / 3_600_000)) }) : t("Expired");

  return (
    <Link href={`/requests/${request.id}`} className="block rounded-lg border border-divider bg-surface p-4 transition-colors hover:bg-surface-subtle">
      {request.requestKind === "REVERSAL" && <p className="mb-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary-text"><RotateCcw aria-hidden className="size-3.5" />{t("Reversal request")}</p>}
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-[15px] font-semibold text-text">{request.counterpartyName}</p><p className="mt-0.5 text-[13px] text-text-secondary">{request.counterpartyMaskedPhone}</p></div><AmountDisplay minor={request.amountMinor} size="md" /></div>
      <p className="mt-3 line-clamp-2 text-[13px] leading-5 text-text-secondary">{request.reason}</p>
      <div className="mt-4 flex items-center justify-between gap-3"><span className="inline-flex items-center gap-1.5 text-[12px] text-text-secondary"><Clock3 aria-hidden className="size-3.5" />{request.status === "PENDING" ? expiresIn : formatDate(request.createdAt, { dateStyle: "medium" })}</span><span className="flex items-center gap-2"><StatusBadge status={badgeFor(request.status)} /><ArrowRight aria-hidden className="size-4 text-primary-text" /></span></div>
    </Link>
  );
}
