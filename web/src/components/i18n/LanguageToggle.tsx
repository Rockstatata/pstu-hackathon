"use client";

import { Languages } from "lucide-react";
import { useI18n } from "@/components/i18n/LanguageProvider";
import { cn } from "@/lib/cn";

export function LanguageToggle({ compact, full = false, className }: { compact?: boolean; full?: boolean; className?: string }) {
  compact = compact ?? !full;
  const { locale, setLocale, t } = useI18n();
  const next = locale === "en" ? "bn" : "en";
  const nextLabel = next === "bn" ? "বাংলা" : "English";

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => setLocale(next)}
        aria-label={t("Change language")}
        className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-[13px] font-semibold text-text-secondary transition-colors hover:bg-surface-subtle hover:text-text", className)}
      >
        <Languages aria-hidden className="size-4" /> {nextLabel}
      </button>
    );
  }

  return (
    <div className={cn("grid grid-cols-2 gap-2", className)} role="group" aria-label={t("Language")}>
      {(["bn", "en"] as const).map((option) => (
        <button
          type="button"
          key={option}
          onClick={() => setLocale(option)}
          aria-pressed={locale === option}
          className={`min-h-11 rounded-md border px-4 text-[14px] font-semibold transition-colors ${locale === option ? "border-primary bg-purple-soft text-primary-text" : "border-control bg-surface text-text-secondary hover:bg-surface-subtle"}`}
        >
          {option === "bn" ? "বাংলা" : "English"}
        </button>
      ))}
    </div>
  );
}
