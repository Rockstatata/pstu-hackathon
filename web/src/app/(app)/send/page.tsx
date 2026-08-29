"use client";

import { ArrowLeft, CheckCircle2, ChevronRight, CircleAlert } from "lucide-react";
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
import { ApiError, api, isUncertainOutcome, newIdempotencyKey } from "@/lib/api";
import { formatTaka, initialsOf, parseTakaToPoisha } from "@/lib/money";
import { useOnlineStatus } from "@/lib/use-online-status";
import type { AccountSummary, RecipientPreview } from "@/lib/types";
import { useI18n } from "@/components/i18n/LanguageProvider";

const TRANSFER_LIMIT_MINOR = 10_000_000;

export default function SendPage() {
  const { t, locale, formatNumber } = useI18n();
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [lookup, setLookup] = useState<{ phone: string; recipient: RecipientPreview | null; error: string | null } | null>(null);
  const [balance, setBalance] = useState<AccountSummary | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [stepUpReason, setStepUpReason] = useState<string | null>(null);
  /** Set when the server never told us the outcome. Never a failure claim. */
  const [uncertain, setUncertain] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecipientPreview[]>([]);
  const offline = !useOnlineStatus();
  const recipient = lookup?.phone === phone ? lookup.recipient : null;
  const recipientError = lookup?.phone === phone ? lookup.error : null;
  const lookingUp = phone.length === 11 && lookup?.phone !== phone;

  const amountMinor = useMemo(() => parseTakaToPoisha(amount), [amount]);
  const amountError = useMemo(() => {
    if (!amount) return null;
    if (amountMinor === null || amountMinor <= 0) return t("Enter an amount greater than zero.");
    if (amountMinor > TRANSFER_LIMIT_MINOR) return t("You can send up to {amount} per transfer.", { amount: formatTaka(TRANSFER_LIMIT_MINOR, { locale }) });
    // This is only immediate form feedback. The service rechecks the balance under its lock.
    if (balance && amountMinor > balance.balanceMinor) return t("You do not have enough balance for this transfer.");
    return null;
  }, [amount, amountMinor, balance, locale, t]);

  useEffect(() => {
    let active = true;
    api.account().then((account) => active && setBalance(account)).catch(() => active && setFormError(t("Your balance is unavailable. Reconnect before sending money.")));
    return () => { active = false; };
  }, [t]);

  useEffect(() => {
    let active = true;
    // People this Account has actually paid, from the Ledger. Never a seeded list.
    api.recentRecipients().then((list) => active && setRecents(list)).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (phone.length !== 11) return;
    let active = true;
    api.recipientPreview(phone)
      .then((preview) => { if (active) setLookup({ phone, recipient: preview, error: null }); })
      .catch((cause) => { if (active) setLookup({ phone, recipient: null, error: cause instanceof ApiError ? cause.sentence : t("We could not find that recipient.") }); });
    return () => { active = false; };
  }, [phone, t]);

  function continueToConfirmation() {
    if (offline) return;
    if (!recipient) { setFormError(t("Enter a registered recipient before continuing.")); return; }
    if (amountError || amountMinor === null || amountMinor <= 0) { setFormError(amountError ?? t("Enter an amount before continuing.")); return; }
    setFormError(null);
    setShowConfirmation(true);
  }

  /**
   * One idempotency key for this compose session, resent unchanged on every
   * attempt — including the Step-Up retry, because a PIN is further proof of the
   * same intention rather than a second transfer.
   */
  async function confirmTransfer(pin?: string) {
    if (!recipient || amountMinor === null) return;
    setSubmitting(true);
    setFormError(null);
    setUncertain(null);
    try {
      const receipt = await api.createTransfer(
        { recipientPhone: recipient.phone, amountMinor, note: note.trim() || undefined, pin },
        idempotencyKey,
      );
      router.replace(`/send/receipt/${receipt.reference}`);
    } catch (cause) {
      // The server wants another identity check. This is not a failure, and no
      // money has moved, so the compose state is kept exactly as it is.
      if (cause instanceof ApiError && cause.code === "STEP_UP_REQUIRED") {
        setStepUpReason(cause.stepUpReason ?? cause.sentence);
        return;
      }
      // Let the dialog report a wrong PIN in place, so the person can retype it.
      if (cause instanceof ApiError && cause.code === "STEP_UP_FAILED") throw cause;

      // An unknown outcome is not a failure, and saying "no transaction ID was
      // issued" when a replica died mid-commit would be a confident lie about
      // someone's money. Those cases keep the compose screen and the same
      // Idempotency-Key, so the safe recovery — check history, resubmit the
      // identical request — is still available. Only a decision the server
      // actually made and committed to gets a failure receipt.
      if (cause instanceof ApiError && isUncertainOutcome(cause.code)) {
        setUncertain(cause.sentence);
        return;
      }

      const sentence = cause instanceof ApiError ? cause.sentence : t("Something went wrong. No money has moved.");
      router.replace(`/send/receipt/failed?reason=${encodeURIComponent(sentence)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md pb-40">
      
      {offline && <OfflineBanner />}
      <Link href="/" className="mb-3 inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-primary-text hover:underline"><ArrowLeft aria-hidden className="size-4" />{t("Home")}</Link>
      <h1 className="text-[24px] font-semibold leading-8">{t("Send money")}</h1>
      <p className="mt-1 text-[15px] leading-6 text-text-secondary">{t("Check who you are paying before confirming.")}</p>

      <section className="mt-7 space-y-5" aria-labelledby="recipient-heading">
        <div><p className="text-[13px] font-medium text-primary-text">{t("Step {step} of {total}", { step: formatNumber(1), total: formatNumber(2) })}</p><h2 id="recipient-heading" className="mt-1 text-[18px] font-semibold">{t("Choose a recipient")}</h2></div>
        <PhoneInput value={phone} onChange={setPhone} error={recipientError} label={t("Recipient phone number")} autoFocus />
        {lookingUp && <p className="flex items-center gap-2 text-[13px] text-text-secondary"><span className="size-3 animate-spin rounded-full border-2 border-purple-border border-t-primary" />{t("Looking up recipient")}</p>}
        {recipient && <div className="space-y-2"><p className="flex items-center gap-1.5 text-[13px] font-medium text-success-text"><CheckCircle2 aria-hidden className="size-4" />{t("Recipient found")}</p><RecipientCard recipient={recipient} /></div>}
        {recents.length > 0 && (
          <div>
            <p className="mb-2 text-[13px] font-medium text-text-secondary">{t("Recent recipients")}</p>
            <div className="grid grid-cols-3 gap-2">
              {recents.map((item) => <button key={item.phone} type="button" onClick={() => setPhone(item.phone)} className="min-h-20 rounded-md border border-divider bg-surface px-2 py-2 text-center transition-colors hover:border-purple-border hover:bg-surface-subtle"><span aria-hidden className="mx-auto flex size-8 items-center justify-center rounded-full bg-purple-soft text-[11px] font-semibold text-primary-text">{initialsOf(item.fullName)}</span><span className="mt-1 block truncate text-[12px] font-medium text-text">{item.fullName.split(" ")[0]}</span></button>)}
            </div>
          </div>
        )}
      </section>

      <section className="mt-9 space-y-5 border-t border-divider pt-7" aria-labelledby="amount-heading">
        <div><p className="text-[13px] font-medium text-primary-text">{t("Step {step} of {total}", { step: formatNumber(2), total: formatNumber(2) })}</p><h2 id="amount-heading" className="mt-1 text-[18px] font-semibold">{t("Set the amount")}</h2></div>
        <AmountInput value={amount} onChange={setAmount} minor={amountMinor} balanceMinor={balance?.balanceMinor ?? null} error={amountError} disabled={offline} />
        <div className="flex flex-col gap-1.5"><label htmlFor="note" className="text-[13px] font-medium text-text-secondary">{t("Note")} <span className="font-normal">{t("(optional)")}</span></label><textarea id="note" value={note} onChange={(event) => setNote(event.target.value.slice(0, 140))} rows={3} disabled={offline} className="resize-none rounded-md border border-control bg-surface px-3 py-2.5 text-[15px] text-text outline-none transition-colors placeholder:text-text-muted focus:border-primary disabled:opacity-55" placeholder={t("What is this for?")} /><p className="text-right text-[12px] text-text-muted">{formatNumber(note.length)}/{formatNumber(140)}</p></div>
      </section>

      {formError && <p aria-live="polite" className="mt-5 rounded-md bg-danger-surface px-3 py-2.5 text-[13px] font-medium text-danger-text">{formError}</p>}
      {uncertain && (
        <section aria-live="assertive" className="mt-5 rounded-md bg-warning-surface p-4">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-warning-text">
            <CircleAlert aria-hidden className="size-4 shrink-0" />
            {t("We do not know whether this went through")}
          </p>
          <p className="mt-2 text-[13px] leading-5 text-text-secondary">{uncertain}</p>
          <p className="mt-2 text-[13px] leading-5 text-text-secondary">
            {t("Check your history first. If it is not there, confirm again — this app resends the same request rather than making a second one, so it cannot send twice.")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/history" className="inline-flex min-h-11 items-center rounded-md bg-surface px-4 text-[13px] font-semibold text-primary-text">
              {t("Check transaction history")}
            </Link>
          </div>
        </section>
      )}
      <div className="safe-bottom fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-20 border-t border-divider bg-bg px-4 py-3 lg:bottom-0 lg:left-[15rem] sm:px-6">
        <div className="mx-auto max-w-md"><Button full onClick={continueToConfirmation} disabled={offline || !recipient || Boolean(amountError) || amountMinor === null || amountMinor <= 0}>{t("Review transfer")} <ChevronRight aria-hidden className="size-4" /></Button></div>
      </div>

      {showConfirmation && recipient && amountMinor !== null && <ConfirmationSheet amountMinor={amountMinor} recipient={recipient} note={note.trim()} confirming={submitting} disabled={offline} error={offline ? t("Reconnect to securely send money.") : (formError ?? uncertain)} onCancel={() => { if (!submitting) { setShowConfirmation(false); setFormError(null); } }} onConfirm={() => void confirmTransfer()} />}
      {stepUpReason && <StepUpDialog reason={stepUpReason} onCancel={() => setStepUpReason(null)} onVerify={(pin) => confirmTransfer(pin)} />}
    </div>
  );
}
