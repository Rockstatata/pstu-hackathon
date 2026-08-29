"use client";

import { ArrowLeft, ChevronRight, Plus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AmountDisplay } from "@/components/money/AmountDisplay";
import { AmountInput } from "@/components/money/AmountInput";
import { RecipientChip } from "@/components/money/RecipientChip";
import { ConfirmationSheet } from "@/components/send/ConfirmationSheet";
import { StepUpDialog } from "@/components/send/StepUpDialog";
import { Button } from "@/components/ui/Button";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { ApiError, api, newIdempotencyKey } from "@/lib/api";
import { parseTakaToPoisha } from "@/lib/money";
import { useOnlineStatus } from "@/lib/use-online-status";
import type { AccountSummary, RecipientPreview } from "@/lib/types";

type SplitMode = "EACH" | "TOTAL";

export default function GroupSendPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [lookup, setLookup] = useState<{ phone: string; recipient: RecipientPreview | null; error: string | null } | null>(null);
  const [recipients, setRecipients] = useState<RecipientPreview[]>([]);
  const [mode, setMode] = useState<SplitMode>("EACH");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [stepUpReason, setStepUpReason] = useState<string | null>(null);
  const offline = !useOnlineStatus();

  const candidate = lookup?.phone === phone ? lookup.recipient : null;
  const phoneError = lookup?.phone === phone ? lookup.error : null;
  const lookingUp = phone.length === 11 && lookup?.phone !== phone;
  const parsedMinor = useMemo(() => parseTakaToPoisha(amount), [amount]);
  const perPersonMinor = mode === "TOTAL" && parsedMinor !== null && recipients.length ? parsedMinor / recipients.length : parsedMinor;
  const totalMinor = mode === "TOTAL" ? parsedMinor : parsedMinor !== null ? parsedMinor * recipients.length : null;
  const amountError = useMemo(() => {
    if (!amount) return null;
    if (parsedMinor === null || parsedMinor <= 0) return "Enter an amount greater than zero.";
    if (mode === "TOTAL" && recipients.length > 0 && parsedMinor % recipients.length !== 0) return "Choose a total that splits evenly between every recipient.";
    if (totalMinor !== null && account && totalMinor > account.balanceMinor) return "You do not have enough balance for this group transfer.";
    return null;
  }, [account, amount, mode, parsedMinor, recipients.length, totalMinor]);

  useEffect(() => {
    let active = true;
    api.account().then((result) => active && setAccount(result)).catch(() => active && setError("Your balance is unavailable. Reconnect before sending money."));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (phone.length !== 11) return;
    let active = true;
    api.recipientPreview(phone).then((recipient) => active && setLookup({ phone, recipient, error: null })).catch((cause) => active && setLookup({ phone, recipient: null, error: cause instanceof ApiError ? cause.sentence : "We could not find that recipient." }));
    return () => { active = false; };
  }, [phone]);

  function addRecipient() {
    if (!candidate) { setError("Find a registered recipient before adding them."); return; }
    if (recipients.some((item) => item.phone === candidate.phone)) { setError("That recipient is already in this group."); return; }
    setRecipients((current) => [...current, candidate]);
    setPhone("");
    setError(null);
  }

  function review() {
    if (recipients.length < 2) { setError("Add at least two recipients for a group transfer."); return; }
    if (amountError || perPersonMinor === null || perPersonMinor <= 0 || totalMinor === null) { setError(amountError ?? "Enter the group amount before continuing."); return; }
    setError(null);
    setReviewing(true);
  }

  async function confirm(pin?: string) {
    if (perPersonMinor === null) return;
    setSubmitting(true);
    try {
      const receipt = await api.createGroupTransfer({ recipients: recipients.map((recipient) => ({ phone: recipient.phone, amountMinor: perPersonMinor })), note: note.trim() || undefined, pin }, idempotencyKey);
      router.replace(`/send/receipt/${receipt.reference}`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "STEP_UP_REQUIRED") {
        setStepUpReason(cause.stepUpReason ?? cause.sentence);
        return;
      }
      if (cause instanceof ApiError && cause.code === "STEP_UP_FAILED") throw cause;
      setError(cause instanceof ApiError ? cause.sentence : "The group transfer could not be completed. No money has moved.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md pb-40">
      
      {offline && <OfflineBanner />}
      <Link href="/send" className="mb-3 inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-primary-text hover:underline"><ArrowLeft aria-hidden className="size-4" />Send money</Link>
      <h1 className="text-[24px] font-semibold leading-8">Group send</h1>
      <p className="mt-1 text-[15px] leading-6 text-text-secondary">Every recipient is checked before one atomic group transfer is sent.</p>

      <section className="mt-7" aria-labelledby="group-recipients"><div className="flex items-center gap-2"><Users aria-hidden className="size-5 text-primary-text" /><h2 id="group-recipients" className="text-[18px] font-semibold">Recipients</h2></div><div className="mt-4 flex flex-wrap gap-2">{recipients.map((recipient) => <RecipientChip key={recipient.phone} recipient={recipient} onRemove={() => setRecipients((current) => current.filter((item) => item.phone !== recipient.phone))} />)}</div><div className="mt-4"><PhoneInput value={phone} onChange={setPhone} error={phoneError} label="Add by phone number" disabled={offline} />{lookingUp && <p className="mt-2 text-[13px] text-text-secondary">Looking up recipient</p>}{candidate && <Button variant="secondary" className="mt-3" onClick={addRecipient}><Plus aria-hidden className="size-4" />Add {candidate.fullName}</Button>}</div></section>

      <section className="mt-8 border-t border-divider pt-7" aria-labelledby="group-amount"><h2 id="group-amount" className="text-[18px] font-semibold">Amount</h2><div className="mt-4 grid grid-cols-2 rounded-md bg-surface-subtle p-1"><button type="button" onClick={() => setMode("EACH")} aria-pressed={mode === "EACH"} className={`min-h-11 rounded-sm text-[13px] font-semibold ${mode === "EACH" ? "bg-surface text-primary-text shadow-sm" : "text-text-secondary"}`}>Each person</button><button type="button" onClick={() => setMode("TOTAL")} aria-pressed={mode === "TOTAL"} className={`min-h-11 rounded-sm text-[13px] font-semibold ${mode === "TOTAL" ? "bg-surface text-primary-text shadow-sm" : "text-text-secondary"}`}>Split total</button></div><div className="mt-4"><AmountInput value={amount} onChange={setAmount} minor={parsedMinor} balanceMinor={account?.balanceMinor ?? null} error={amountError} disabled={offline} /></div>{totalMinor !== null && recipients.length > 0 && !amountError && <div className="mt-4 flex items-center justify-between rounded-lg bg-surface-subtle px-4 py-3"><span className="text-[13px] font-medium text-text-secondary">Total to send</span><AmountDisplay minor={totalMinor} size="md" /></div>}</section>

      <section className="mt-7"><label htmlFor="group-note" className="text-[13px] font-medium text-text-secondary">Note <span className="font-normal">(optional)</span></label><textarea id="group-note" value={note} onChange={(event) => setNote(event.target.value.slice(0, 140))} disabled={offline} rows={3} className="mt-1.5 w-full resize-none rounded-md border border-control bg-surface px-3 py-2.5 text-[15px] text-text outline-none focus:border-primary disabled:opacity-55" placeholder="What is this group transfer for?" /></section>
      {error && <p aria-live="polite" className="mt-5 rounded-md bg-danger-surface px-3 py-2.5 text-[13px] font-medium text-danger-text">{error}</p>}
      <div className="safe-bottom fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-20 border-t border-divider bg-bg px-4 py-3 lg:bottom-0 lg:left-[15rem]"><div className="mx-auto max-w-md"><Button full onClick={review} disabled={offline || recipients.length < 2 || Boolean(amountError) || totalMinor === null}>Review group transfer <ChevronRight aria-hidden className="size-4" /></Button></div></div>
      {reviewing && recipients.length > 1 && totalMinor !== null && <ConfirmationSheet amountMinor={totalMinor} recipient={recipients[0]} recipients={recipients} note={note.trim()} confirming={submitting} disabled={offline} error={error} onCancel={() => !submitting && setReviewing(false)} onConfirm={() => void confirm()} />}
      {stepUpReason && <StepUpDialog reason={stepUpReason} onCancel={() => setStepUpReason(null)} onVerify={(pin) => confirm(pin)} />}
    </div>
  );
}
