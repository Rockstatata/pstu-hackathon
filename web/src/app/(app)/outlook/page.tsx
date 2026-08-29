"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  CircleGauge,
  Info,
  Minus,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { GoalSimulator } from "@/components/outlook/GoalSimulator";
import { MoneyOutHistory } from "@/components/outlook/MoneyOutHistory";
import { AmountDisplay } from "@/components/money/AmountDisplay";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { Skeleton } from "@/components/ui/Skeleton";
import { ApiError, api } from "@/lib/api";
import type { FinancialOutlook, OutlookTrendBand } from "@/lib/types";
import { useOnlineStatus } from "@/lib/use-online-status";
import { useI18n } from "@/components/i18n/LanguageProvider";
import type { Locale } from "@/lib/i18n/locale";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

function monthLabel(month: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "bn" ? "bn-BD" : "en-BD", { month: "long", year: "numeric" }).format(
    new Date(`${month}-01T00:00:00+06:00`),
  );
}

function percentFromBps(bps: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "bn" ? "bn-BD" : "en-BD", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(Math.abs(bps) / 10_000);
}

function trendCopy(band: OutlookTrendBand, bps: number | null, locale: Locale, t: Translate): { title: string; detail: string; Icon: LucideIcon; className: string } {
  if (band === "HIGHER" && bps !== null) return {
    title: t("{percent} higher", { percent: percentFromBps(bps, locale) }),
    detail: t("Money out is above the same point last month."),
    Icon: ArrowUpRight,
    className: "text-warning-text",
  };
  if (band === "LOWER" && bps !== null) return {
    title: t("{percent} lower", { percent: percentFromBps(bps, locale) }),
    detail: t("Money out is below the same point last month."),
    Icon: ArrowDownRight,
    className: "text-success-text",
  };
  if (band === "STEADY" && bps !== null) return {
    title: t("Within the usual range"),
    detail: t("Money out changed {percent} from the same point last month.", { percent: percentFromBps(bps, locale) }),
    Icon: Minus,
    className: "text-primary-text",
  };
  return {
    title: t("Building a comparison"),
    detail: t("A previous comparable period is needed before showing a trend."),
    Icon: Minus,
    className: "text-text-secondary",
  };
}

function bufferCopy(outlook: FinancialOutlook, locale: Locale, t: Translate): { title: string; detail: string } {
  const months = outlook.buffer.monthsHundredths;
  if (months === null) return {
    title: t("Building your baseline"),
    detail: t("Complete Account months are needed before estimating a balance buffer."),
  };
  const value = new Intl.NumberFormat(locale === "bn" ? "bn-BD" : "en-BD", { maximumFractionDigits: 1 }).format(months / 100);
  return {
    title: t("About {months} months", { months: value }),
    detail: t("Current Balance divided by Typical Money Out."),
  };
}

export default function OutlookPage() {
  const { t, locale, formatNumber } = useI18n();
  const [outlook, setOutlook] = useState<FinancialOutlook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const offline = !useOnlineStatus();

  useEffect(() => {
    let active = true;
    api.financialOutlook()
      .then((result) => {
        if (active) setOutlook(result);
      })
      .catch((cause) => {
        if (!active) return;
        setError(cause instanceof ApiError ? cause.sentence : t("We could not calculate your outlook right now."));
      });
    return () => { active = false; };
  }, [t]);

  if (outlook === null && !error) return <OutlookSkeleton offline={offline} />;

  return (
    <div className="mx-auto max-w-5xl">
      {offline && <OfflineBanner />}
      <header className="mb-7 grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-primary-text">{t("Financial Outlook")}</p>
          <h1 className="mt-2 max-w-2xl text-[clamp(2rem,6vw,3.5rem)] font-semibold leading-[1.02] tracking-[-0.035em]">
            {t("See the pattern.")}<br className="hidden sm:block" /> {t("Change the plan.")}
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-6 text-text-secondary">
            {t("A clear view of Account activity and a private place to test goals—without a hidden score or AI.")}
          </p>
        </div>
        <div className="inline-flex min-h-11 items-center gap-2 rounded-full border border-purple-border bg-purple-soft px-4 text-[13px] font-semibold text-primary-text md:mb-1">
          <ShieldCheck aria-hidden className="size-4" /> {t("Deterministic calculation")}
        </div>
      </header>

      {error ? (
        <section role="alert" className="card p-6">
          <h2 className="text-[18px] font-semibold">{t("Outlook unavailable")}</h2>
          <p className="mt-2 text-[15px] leading-6 text-text-secondary">{error}</p>
          <p className="mt-1 text-[13px] text-text-muted">{t("Your Account and Transfer history are unaffected.")}</p>
        </section>
      ) : outlook ? (
        <>
          <section className="border-y border-divider py-6 sm:py-8" aria-labelledby="month-heading">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)] lg:items-end">
              <div>
                <p id="month-heading" className="text-[14px] font-medium text-text-secondary">
                  {monthLabel(outlook.period.currentMonth, locale)} · {t("month to date")}
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-5">
                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-text-muted">{t("Money out")}</p>
                    <AmountDisplay minor={outlook.current.outgoingMinor} kind="OUT" size="xl" className="mt-1" />
                  </div>
                  <div className="pb-1">
                    <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-text-muted">{t("Money in")}</p>
                    <AmountDisplay minor={outlook.current.incomingMinor} kind="IN" size="md" className="mt-1" />
                  </div>
                </div>
                <p className="mt-4 text-[14px] text-text-secondary">
                  {outlook.current.transferCount === 0
                    ? t("No non-issuance Account activity yet this month.")
                    : t("{count} completed Transfers involving your Account in this period.", { count: formatNumber(outlook.current.transferCount) })}
                </p>
              </div>
              <div className="rounded-lg bg-surface-subtle p-5">
                <p className="text-[13px] font-medium text-text-secondary">{t("Net flow this month")}</p>
                <AmountDisplay
                  minor={Math.abs(outlook.current.netMinor)}
                  kind={outlook.current.netMinor >= 0 ? "IN" : "OUT"}
                  size="lg"
                  className="mt-2"
                />
                <p className="mt-2 text-[13px] leading-5 text-text-secondary">
                  {t(outlook.current.netMinor >= 0 ? "More came in than went out." : "More went out than came in.")} {t("Issuance is excluded.")}
                </p>
              </div>
            </div>
          </section>

          <section className="py-8 sm:py-10" aria-labelledby="lenses-title">
            <div className="grid gap-8 lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.28fr)]">
              <div>
                <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-primary-text">{t("Three transparent lenses")}</p>
                <h2 id="lenses-title" className="mt-2 text-[28px] font-semibold leading-tight">{t("Facts, not a health score.")}</h2>
                <p className="mt-3 text-[15px] leading-6 text-text-secondary">
                  {t("Each observation names the history it uses. No hidden weighting decides whether you are “good” or “bad.”")}
                </p>
              </div>
              <OutlookLenses outlook={outlook} />
            </div>
          </section>

          <section className="card mb-8 p-5 sm:p-7" aria-labelledby="history-title">
            <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-primary-text">{t("Six-month view")}</p>
                <h2 id="history-title" className="mt-1 text-[22px] font-semibold">{t("Money out, month by month")}</h2>
              </div>
              <p className="text-[12px] text-text-muted">{t("Completed Transfers · registration issuance excluded")}</p>
            </div>
            <MoneyOutHistory history={outlook.history} />
          </section>

          <GoalSimulator outlook={outlook} />

          <details className="mt-6 border-y border-divider py-2">
            <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-[13px] font-semibold text-primary-text">
              <Info aria-hidden className="size-4" /> {t("How the outlook is calculated")}
            </summary>
            <div className="grid gap-4 pb-5 pt-2 text-[13px] leading-5 text-text-secondary sm:grid-cols-3">
              <p><strong className="text-text">{t("Comparison:")}</strong> {t(outlook.rules.comparison)}.</p>
              <p><strong className="text-text">{t("Trend bands:")}</strong> {t("20% or more is higher, 10% or more below is lower; the middle is steady.")}</p>
              <p><strong className="text-text">{t("Typical Money Out:")}</strong> {t(outlook.rules.typicalMoneyOut)}. {t("Account buffer is Balance ÷ that baseline.")}</p>
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}

function OutlookLenses({ outlook }: { outlook: FinancialOutlook }) {
  const { t, locale } = useI18n();
  const trend = trendCopy(outlook.comparison.band, outlook.comparison.changeBps, locale, t);
  const buffer = bufferCopy(outlook, locale, t);
  const lenses = [
    {
      label: t("Comparable trend"),
      title: trend.title,
      detail: trend.detail,
      Icon: trend.Icon,
      iconClass: trend.className,
    },
    {
      label: t("Estimated Account buffer"),
      title: buffer.title,
      detail: buffer.detail,
      Icon: CircleGauge,
      iconClass: "text-primary-text",
    },
    {
      label: t("Largest recipient this month"),
      title: outlook.largestRecipient?.name ?? t("No outgoing recipient yet"),
      detail: outlook.largestRecipient
        ? t("{percent} of this month's money out.", { percent: percentFromBps(outlook.largestRecipient.shareBps, locale) })
        : t("A recipient view appears after an outgoing Transfer."),
      Icon: UserRound,
      iconClass: "text-primary-text",
    },
  ];

  return (
    <div className="divide-y divide-divider border-y border-divider">
      {lenses.map(({ label, title, detail, Icon, iconClass }) => (
        <article key={label} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3 py-5">
          <span className={`flex size-11 items-center justify-center rounded-full bg-surface-subtle ${iconClass}`}>
            <Icon aria-hidden className="size-5" />
          </span>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-muted">{label}</p>
            <h3 className="mt-1 text-[18px] font-semibold">{title}</h3>
            <p className="mt-1 text-[13px] leading-5 text-text-secondary">{detail}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function OutlookSkeleton({ offline }: { offline: boolean }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-5xl" aria-label={t("Calculating financial outlook")} aria-busy="true">
      {offline && <OfflineBanner />}
      <div className="space-y-3"><Skeleton className="h-4 w-36" /><Skeleton className="h-12 w-3/4 max-w-lg" /><Skeleton className="h-5 w-full max-w-xl" /></div>
      <div className="mt-8 border-y border-divider py-8"><Skeleton className="h-5 w-40" /><Skeleton className="mt-4 h-14 w-64" /></div>
      <div className="mt-8 grid gap-5 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
    </div>
  );
}
