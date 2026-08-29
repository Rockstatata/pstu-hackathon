"use client";

import { AmountDisplay } from "@/components/money/AmountDisplay";
import { useI18n } from "@/components/i18n/LanguageProvider";
import type { Locale } from "@/lib/i18n/locale";
import type { FinancialOutlook } from "@/lib/types";

interface Props {
  history: FinancialOutlook["history"];
}

function monthLabel(month: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "bn" ? "bn-BD" : "en-BD", { month: "short" }).format(
    new Date(`${month}-01T00:00:00+06:00`),
  );
}

export function MoneyOutHistory({ history }: Props) {
  const { t, locale } = useI18n();
  const maximum = Math.max(...history.map((month) => month.outgoingMinor), 1);

  return (
    <div className="space-y-4" role="list" aria-label={t("Money out over the last six months")}>
      {history.map((month) => {
        const width = Math.max(Math.round((month.outgoingMinor / maximum) * 100), month.outgoingMinor ? 3 : 0);
        return (
          <div
            key={month.month}
            role="listitem"
            className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 sm:grid-cols-[3rem_minmax(0,1fr)_7.75rem]"
          >
            <span className="text-[13px] font-semibold text-text-secondary">
              {monthLabel(month.month, locale)}
            </span>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-subtle">
              <span
                aria-hidden
                className="block h-full rounded-full bg-primary transition-transform duration-300"
                style={{ width: `${width}%` }}
              />
            </div>
            <AmountDisplay
              minor={month.outgoingMinor}
              kind="OUT"
              className="col-start-2 justify-self-start sm:col-start-3 sm:row-start-1 sm:justify-self-end"
            />
          </div>
        );
      })}
    </div>
  );
}
