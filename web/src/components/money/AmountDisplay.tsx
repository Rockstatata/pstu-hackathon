"use client";

import { ArrowDownLeft, ArrowUpRight, AlertTriangle, RotateCcw } from "lucide-react";
import { useI18n } from "@/components/i18n/LanguageProvider";
import { cn } from "@/lib/cn";
import { formatTaka } from "@/lib/money";

export type AmountKind = "IN" | "OUT" | "REVERSAL" | "FAILED" | "PLAIN";

/**
 * THE single component for every amount rendered anywhere in the app.
 * No screen formats money itself and no screen calls toFixed.
 *
 * Colour law: an outgoing or negative movement is red. Direction is carried
 * by the sign, icon, and colour together, so it remains understandable in
 * greyscale and is immediately noticeable in a transaction list.
 */
const KIND = {
  IN: { cls: "text-success-text", sign: "+" as const, Icon: ArrowDownLeft, sr: "Received" },
  OUT: { cls: "text-danger-text", sign: "-" as const, Icon: ArrowUpRight, sr: "Sent" },
  REVERSAL: { cls: "text-text-secondary", sign: null, Icon: RotateCcw, sr: "Reversed" },
  FAILED: { cls: "text-danger-text line-through", sign: null, Icon: AlertTriangle, sr: "Failed" },
  PLAIN: { cls: "text-text", sign: null, Icon: null, sr: "" },
};

interface Props {
  minor: number;
  kind?: AmountKind;
  size?: "sm" | "md" | "lg" | "xl";
  showIcon?: boolean;
  className?: string;
}

const SIZES = {
  sm: "text-[15px] font-semibold",
  md: "text-[18px] font-semibold",
  lg: "text-[36px] leading-10 font-bold",
  xl: "text-[40px] leading-11 font-bold",
};

export function AmountDisplay({
  minor,
  kind = "PLAIN",
  size = "sm",
  showIcon = false,
  className,
}: Props) {
  const effectiveKind = kind === "PLAIN" && minor < 0 ? "OUT" : kind;
  const { cls, sign, Icon, sr } = KIND[effectiveKind];
  const { locale, t } = useI18n();

  return (
    <span className={cn("inline-flex items-center gap-1.5 tnum", cls, SIZES[size], className)}>
      {showIcon && Icon && <Icon aria-hidden className="size-4 shrink-0" />}
      {sr && <span className="sr-only">{t(sr)} </span>}
      {formatTaka(minor, { sign, locale })}
    </span>
  );
}
