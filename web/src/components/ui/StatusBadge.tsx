"use client";

import { AlertTriangle, Check, Clock, RotateCcw, X, type LucideIcon } from "lucide-react";
import { useI18n } from "@/components/i18n/LanguageProvider";
import type { BadgeStatus } from "@/lib/types";

/**
 * Every pair here is measured in both themes (docs/design-system.md). The chip
 * fill is nearly invisible against the page on purpose — a badge is read from
 * its text and icon, never its edge, so it survives greyscale.
 */
const STYLES: Record<BadgeStatus, { cls: string; icon: LucideIcon; label: string }> = {
  COMPLETED: { cls: "bg-success-surface text-success-text", icon: Check, label: "Completed" },
  EXECUTED: { cls: "bg-success-surface text-success-text", icon: Check, label: "Executed" },
  PAID: { cls: "bg-success-surface text-success-text", icon: Check, label: "Paid" },
  PENDING: { cls: "bg-warning-surface text-warning-text", icon: Clock, label: "Pending" },
  SCHEDULED: { cls: "bg-warning-surface text-warning-text", icon: Clock, label: "Scheduled" },
  FAILED: { cls: "bg-danger-surface text-danger-text", icon: AlertTriangle, label: "Failed" },
  DECLINED: { cls: "bg-danger-surface text-danger-text", icon: X, label: "Declined" },
  REVERSED: { cls: "bg-purple-soft text-primary-text", icon: RotateCcw, label: "Reversed" },
  EXPIRED: { cls: "bg-neutral-surface text-text-secondary", icon: Clock, label: "Expired" },
  CANCELLED: { cls: "bg-neutral-surface text-text-secondary", icon: X, label: "Cancelled" },
};

export function StatusBadge({ status }: { status: BadgeStatus }) {
  const { t } = useI18n();
  const { cls, icon: Icon, label } = STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold ${cls}`}
    >
      <Icon aria-hidden className="size-3.5" />
      {t(label)}
    </span>
  );
}
