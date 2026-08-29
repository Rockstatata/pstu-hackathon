"use client";

import { Calculator, RotateCcw, ShieldCheck, Target } from "lucide-react";
import { useMemo, useState } from "react";
import { AmountDisplay } from "@/components/money/AmountDisplay";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { formatTakaBare, parseTakaToPoisha } from "@/lib/money";
import { calculateGoalProjection } from "@/lib/projection";
import type { FinancialOutlook } from "@/lib/types";
import { useI18n } from "@/components/i18n/LanguageProvider";
import type { Locale } from "@/lib/i18n/locale";

const REDUCTION_OPTIONS = [0, 500, 1_000, 1_500, 2_000];
const DEFAULT_GOAL_INCREASE = 5_000_000;
const DEFAULT_MONTHLY_SET_ASIDE = 500_000;

interface Props {
  outlook: FinancialOutlook;
}

function percentLabel(bps: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "bn" ? "bn-BD" : "en-BD", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(bps / 10_000);
}

function projectedMonth(asOf: string, months: number | null, locale: Locale): string | null {
  if (months === null) return null;
  const date = new Date(asOf);
  date.setUTCMonth(date.getUTCMonth() + months);
  return new Intl.DateTimeFormat(locale === "bn" ? "bn-BD" : "en-BD", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Dhaka",
  }).format(date);
}

export function GoalSimulator({ outlook }: Props) {
  const { t, locale, formatNumber } = useI18n();
  const initialTarget = outlook.balanceMinor + DEFAULT_GOAL_INCREASE;
  const [targetInput, setTargetInput] = useState(() => formatTakaBare(initialTarget, locale));
  const [monthlyInput, setMonthlyInput] = useState(() => formatTakaBare(DEFAULT_MONTHLY_SET_ASIDE, locale));
  const [reductionBps, setReductionBps] = useState(0);

  const targetMinor = parseTakaToPoisha(targetInput);
  const monthlySetAsideMinor = parseTakaToPoisha(monthlyInput);
  const targetError = targetMinor === null ? t("Enter a valid goal amount.") : null;
  const monthlyError = monthlySetAsideMinor === null ? t("Enter a valid monthly amount.") : null;

  const projection = useMemo(
    () => calculateGoalProjection({
      startingMinor: outlook.balanceMinor,
      targetMinor: targetMinor ?? 0,
      monthlySetAsideMinor: monthlySetAsideMinor ?? 0,
      reductionBps,
      typicalOutgoingMinor: outlook.typicalMoneyOut.averageMinor,
    }),
    [monthlySetAsideMinor, outlook, reductionBps, targetMinor],
  );

  const target = targetMinor ?? 0;
  const currentProgress = target > 0
    ? Math.min(10_000, Math.round((outlook.balanceMinor * 10_000) / target))
    : 0;
  const yearProgress = target > 0
    ? Math.min(10_000, Math.round((projection.projectedAfterYearMinor * 10_000) / target))
    : 0;
  const reachMonth = projectedMonth(outlook.asOf, projection.monthsToGoal, locale);

  function reset() {
    setTargetInput(formatTakaBare(initialTarget, locale));
    setMonthlyInput(formatTakaBare(DEFAULT_MONTHLY_SET_ASIDE, locale));
    setReductionBps(0);
  }

  return (
    <section className="card overflow-hidden" aria-labelledby="goal-simulator-title">
      <div className="grid lg:grid-cols-[minmax(0,0.92fr)_minmax(22rem,1.08fr)]">
        <div className="p-5 sm:p-7 lg:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-primary-text">
                <Calculator aria-hidden className="size-4" /> {t("What-if simulator")}
              </p>
              <h2 id="goal-simulator-title" className="mt-2 text-[clamp(1.5rem,4vw,2rem)] font-semibold leading-tight">
                {t("Change the assumptions. See the path.")}
              </h2>
            </div>
            <Button variant="ghost" className="shrink-0 px-3" onClick={reset}>
              <RotateCcw aria-hidden className="size-4" /> {t("Reset")}
            </Button>
          </div>

          <p className="mt-3 max-w-xl text-[15px] leading-6 text-text-secondary">
            {t("Start from your current Account Balance, choose a target, and test how keeping more each month changes the estimate.")}
          </p>

          <div className="mt-7 space-y-5">
            <Field
              label={t("Goal amount")}
              prefix="৳"
              inputMode="decimal"
              value={targetInput}
              onChange={(event) => setTargetInput(event.target.value)}
              error={targetError}
              hint={t("This is a private estimate. It does not reserve money.")}
            />
            <Field
              label={t("Set aside each month")}
              prefix="৳"
              inputMode="decimal"
              value={monthlyInput}
              onChange={(event) => setMonthlyInput(event.target.value)}
              error={monthlyError}
            />

            <fieldset>
              <legend className="text-[13px] font-medium text-text-secondary">
                {t("Reduce Typical Money Out")}
              </legend>
              <div className="mt-2 grid grid-cols-5 gap-2">
                {REDUCTION_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option}
                    onClick={() => setReductionBps(option)}
                    aria-pressed={reductionBps === option}
                    disabled={outlook.typicalMoneyOut.averageMinor === null && option > 0}
                    className={`min-h-11 rounded-md border text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                      reductionBps === option
                        ? "border-primary bg-purple-soft text-primary-text"
                        : "border-divider bg-surface text-text-secondary hover:border-control"
                    }`}
                  >
                    {percentLabel(option, locale)}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[12px] leading-5 text-text-secondary">
                {outlook.typicalMoneyOut.averageMinor === null
                  ? t("Reduction scenarios unlock after one complete month of Account activity.")
                  : t("Applied to your disclosed Typical Money Out baseline—not to individual Transfers.")}
              </p>
            </fieldset>
          </div>
        </div>

        <div className="flex flex-col bg-purple-soft p-5 sm:p-7 lg:p-8">
          <div className="flex items-center gap-2 text-primary-text">
            <Target aria-hidden className="size-5" />
            <h3 className="text-[15px] font-semibold">{t("Goal projection")}</h3>
          </div>

          <div className="mt-7">
            <p className="text-[13px] font-medium text-text-secondary">{t("Estimated time")}</p>
            {targetError || monthlyError ? (
              <p className="mt-2 text-[20px] font-semibold text-text">{t("Check the amounts to continue")}</p>
            ) : projection.monthsToGoal === null ? (
              <p className="mt-2 text-[20px] font-semibold text-text">{t("Add a monthly amount to create a path")}</p>
            ) : projection.monthsToGoal === 0 ? (
              <p className="mt-2 text-[28px] font-semibold leading-tight text-text">{t("Goal already reached")}</p>
            ) : (
              <>
                <p className="mt-1 text-[clamp(2.25rem,8vw,4rem)] font-semibold leading-none tracking-[-0.04em] text-text tnum">
                  {formatNumber(projection.monthsToGoal)} <span className="text-[18px] tracking-normal text-text-secondary">{t("months")}</span>
                </p>
                <p className="mt-2 text-[14px] text-text-secondary">{t("Around {month}", { month: reachMonth ?? "" })}</p>
              </>
            )}
          </div>

          <div className="mt-8">
            <div className="relative h-3 overflow-hidden rounded-full bg-surface">
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 rounded-full bg-purple-border"
                style={{ width: `${currentProgress / 100}%` }}
              />
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 rounded-full bg-primary"
                style={{ width: `${yearProgress / 100}%` }}
              />
            </div>
            <div className="mt-3 flex items-start justify-between gap-4 text-[12px] text-text-secondary">
              <span>{t("Now")}<br /><AmountDisplay minor={outlook.balanceMinor} /></span>
              <span className="text-right">{t("After {months} months", { months: formatNumber(12) })}<br /><AmountDisplay minor={projection.projectedAfterYearMinor} /></span>
            </div>
          </div>

          <dl className="mt-8 space-y-4 border-t border-purple-border pt-5">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-[13px] text-text-secondary">{t("Monthly amount kept")}</dt>
              <dd><AmountDisplay minor={projection.monthlyProgressMinor} /></dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-[13px] text-text-secondary">{t("From reduced money out")}</dt>
              <dd><AmountDisplay minor={projection.additionalKeptMinor} /></dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-[13px] text-text-secondary">{t("Still needed")}</dt>
              <dd><AmountDisplay minor={projection.remainingMinor} /></dd>
            </div>
          </dl>

          <details className="mt-auto pt-7">
            <summary className="min-h-11 cursor-pointer text-[13px] font-semibold text-primary-text">
              {t("See the exact formula")}
            </summary>
            <div className="rounded-md bg-surface p-4 text-[13px] leading-5 text-text-secondary">
              <p>{t("Monthly progress = monthly set-aside + (Typical Money Out × selected reduction).")}</p>
              <p className="mt-2">{t("Months = remaining goal ÷ monthly progress, rounded up.")}</p>
              <p className="mt-2 flex items-start gap-2">
                <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success-text" />
                {t("No interest, investment return, fees, or future Transfers are assumed. This estimate never changes your Account.")}
              </p>
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}
