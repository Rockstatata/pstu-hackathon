"use client";

import { ArrowLeft, CalendarClock, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AmountInput } from "@/components/money/AmountInput";
import { RecipientCard } from "@/components/money/RecipientCard";
import { ConfirmationSheet } from "@/components/send/ConfirmationSheet";
import { StepUpDialog } from "@/components/send/StepUpDialog";
import { Button } from "@/components/ui/Button";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { ApiError, api, newIdempotencyKey } from "@/lib/api";
import { parseTakaToPoisha } from "@/lib/money";
import type { AccountSummary, RecipientPreview } from "@/lib/types";
import { useOnlineStatus } from "@/lib/use-online-status";
import { useI18n } from "@/components/i18n/LanguageProvider";

function localDateTime(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function CreateScheduledTransferPage() {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const online = useOnlineStatus();
  const [phone, setPhone] = useState("");
  const [lookup, setLookup] = useState<{ phone: string; recipient: RecipientPreview | null; error: string | null } | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [amount, setAmount] = useState("");
  const [executeAt, setExecuteAt] = useState(() => localDateTime(new Date(Date.now() + 3_600_000)));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stepUpReason, setStepUpReason] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [now] = useState(() => Date.now());
  const [minimumDateTime] = useState(() => localDateTime(new Date()));
  const amountMinor = useMemo(() => parseTakaToPoisha(amount), [amount]);
  const recipient = lookup?.phone === phone ? lookup.recipient : null;
  const phoneError = lookup?.phone === phone ? lookup.error : null;
  const scheduleDate = useMemo(() => new Date(executeAt), [executeAt]);
  const scheduleError = !executeAt || Number.isNaN(scheduleDate.getTime()) || scheduleDate.getTime() <= now
    ? t("Choose a future date and time.")
    : null;
  const amountError = amount && (amountMinor === null || amountMinor <= 0)
    ? t("Enter an amount greater than zero.")
    : null;
  const balanceWarning = amountMinor !== null && account && amountMinor > account.balanceMinor;

  useEffect(() => {
    let active = true;
    api.account()
      .then((value) => active && setAccount(value))
      .catch(() => active && setError(t("Your balance is unavailable. Reconnect before scheduling money.")));
    return () => { active = false; };
  }, [t]);

  useEffect(() => {
    if (phone.length !== 11) return;
    let active = true;
    api.recipientPreview(phone)
      .then((value) => active && setLookup({ phone, recipient: value, error: null }))
      .catch((cause) => active && setLookup({
        phone,
        recipient: null,
        error: cause instanceof ApiError ? cause.sentence : t("We could not find that recipient."),
      }));
    return () => { active = false; };
  }, [phone, t]);

  function openReview() {
    setIdempotencyKey(newIdempotencyKey());
    setError(null);
    setReviewing(true);
  }

  async function schedule(pin?: string) {
    if (!recipient || amountMinor === null || scheduleError) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createScheduledTransfer({
        recipientPhone: recipient.phone,
        amountMinor,
        executeAt: scheduleDate.toISOString(),
        note: note.trim() || undefined,
        pin,
      }, idempotencyKey);
      router.replace("/scheduled");
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "STEP_UP_REQUIRED") {
        setStepUpReason(cause.stepUpReason ?? cause.sentence);
        return;
      }
      if (cause instanceof ApiError && cause.code === "STEP_UP_FAILED") throw cause;
      setError(cause instanceof ApiError ? cause.sentence : t("We could not schedule this Transfer."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md pb-24">
      {!online && <OfflineBanner />}
      <Link href="/scheduled" className="mb-3 inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-primary-text hover:underline"><ArrowLeft aria-hidden className="size-4" />{t("Scheduled Transfers")}</Link>
      <h1 className="text-[24px] font-semibold leading-8">{t("Schedule a Transfer")}</h1>
      <p className="mt-1 text-[15px] leading-6 text-text-secondary">{t("Your PIN authorizes the future instruction. Balance, limits, and recipient checks run again when it is due.")}</p>
      <div className="mt-7 space-y-5">
        <PhoneInput value={phone} onChange={setPhone} error={phoneError} label={t("Recipient phone number")} disabled={!online} autoFocus />
        {recipient && <RecipientCard recipient={recipient} />}
        <AmountInput value={amount} onChange={setAmount} minor={amountMinor} balanceMinor={account?.balanceMinor ?? null} error={amountError} disabled={!online} />
        {balanceWarning && <p className="-mt-3 text-[13px] leading-5 text-warning-text">{t("Your current balance is lower than this amount. You can still authorize the instruction; the final balance check happens when it is due.")}</p>}
        <div>
          <label htmlFor="execute-at" className="text-[13px] font-medium text-text-secondary">{t("Date and time")}</label>
          <input id="execute-at" type="datetime-local" value={executeAt} onChange={(event) => setExecuteAt(event.target.value)} min={minimumDateTime} disabled={!online} className="mt-1.5 min-h-11 w-full rounded-md border border-control bg-surface px-3 text-[15px] text-text outline-none focus:border-primary disabled:opacity-55" />
          {scheduleError && <p className="mt-1 text-[13px] font-medium text-danger-text">{scheduleError}</p>}
        </div>
        <div>
          <label htmlFor="schedule-note" className="text-[13px] font-medium text-text-secondary">{t("Note")} <span className="font-normal">{t("(optional)")}</span></label>
          <textarea id="schedule-note" value={note} onChange={(event) => setNote(event.target.value.slice(0, 140))} rows={3} disabled={!online} className="mt-1.5 w-full resize-none rounded-md border border-control bg-surface px-3 py-2.5 text-[15px] text-text outline-none focus:border-primary disabled:opacity-55" placeholder={t("What is this for?")} />
        </div>
      </div>
      {error && <p aria-live="polite" className="mt-5 rounded-md bg-danger-surface px-3 py-2.5 text-[13px] font-medium text-danger-text">{error}</p>}
      <div className="safe-bottom fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-20 border-t border-divider bg-bg/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:left-[15rem]">
        <div className="mx-auto max-w-md"><Button full onClick={openReview} disabled={!online || !recipient || amountMinor === null || amountMinor <= 0 || Boolean(amountError) || Boolean(scheduleError)}>{t("Review schedule")} <ChevronRight aria-hidden className="size-4" /></Button></div>
      </div>
      {reviewing && recipient && amountMinor !== null && (
        <ConfirmationSheet amountMinor={amountMinor} recipient={recipient} note={note.trim()} title={t("Schedule Transfer")} eyebrow={t("Check the future instruction")} confirmLabel={t("Authorize schedule")} confirming={submitting} disabled={!online} error={error} onCancel={() => !submitting && setReviewing(false)} onConfirm={() => void schedule()}>
          <p className="mt-4 flex items-start gap-2 text-[13px] leading-5 text-text-secondary"><CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0 text-primary-text" />{t("Will be attempted on {date}. This does not reserve money.", { date: formatDate(scheduleDate, { dateStyle: "medium", timeStyle: "short" }) })}</p>
        </ConfirmationSheet>
      )}
      {stepUpReason && <StepUpDialog reason={stepUpReason} onCancel={() => setStepUpReason(null)} onVerify={(pin) => schedule(pin)} />}
    </div>
  );
}
