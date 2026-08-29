"use client";

import { ArrowLeft, CheckCircle2, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AmountInput } from "@/components/money/AmountInput";
import { RecipientCard } from "@/components/money/RecipientCard";
import { ConfirmationSheet } from "@/components/send/ConfirmationSheet";
import { Button } from "@/components/ui/Button";
import { FixtureNotice } from "@/components/ui/FixtureNotice";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { ApiError, api, newIdempotencyKey } from "@/lib/api";
import { formatTaka, parseTakaToPoisha } from "@/lib/money";
import { useOnlineStatus } from "@/lib/use-online-status";
import type { AccountSummary, RecipientPreview } from "@/lib/types";

const RECENT_RECIPIENTS = [
  { name: "Rahim Uddin", phone: "01798765432", initials: "RU" },
  { name: "Nusrat Jahan", phone: "01611122233", initials: "NJ" },
  { name: "Chayon Das", phone: "01855566677", initials: "CD" },
];

const TRANSFER_LIMIT_MINOR = 10_000_000;

export default function SendPage() {
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
  const offline = !useOnlineStatus();
  const recipient = lookup?.phone === phone ? lookup.recipient : null;
  const recipientError = lookup?.phone === phone ? lookup.error : null;
  const lookingUp = phone.length === 11 && lookup?.phone !== phone;

  const amountMinor = useMemo(() => parseTakaToPoisha(amount), [amount]);
  const amountError = useMemo(() => {
    if (!amount) return null;
    if (amountMinor === null || amountMinor <= 0) return "Enter an amount greater than zero.";
    if (amountMinor > TRANSFER_LIMIT_MINOR) return `You can send up to ${formatTaka(TRANSFER_LIMIT_MINOR)} per transfer.`;
    // This is only immediate form feedback. The service rechecks the balance under its lock.
    if (balance && amountMinor > balance.balanceMinor) return "You do not have enough balance for this transfer.";
    return null;
  }, [amount, amountMinor, balance]);

  useEffect(() => {
    let active = true;
    api.account().then((account) => active && setBalance(account)).catch(() => active && setFormError("Your balance is unavailable. Reconnect before sending money."));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (phone.length !== 11) return;
    let active = true;
    api.recipientPreview(phone)
      .then((preview) => { if (active) setLookup({ phone, recipient: preview, error: null }); })
      .catch((cause) => { if (active) setLookup({ phone, recipient: null, error: cause instanceof ApiError ? cause.sentence : "We could not find that recipient." }); });
    return () => { active = false; };
  }, [phone]);

  function continueToConfirmation() {
    if (offline) return;
    if (!recipient) { setFormError("Enter a registered recipient before continuing."); return; }
    if (amountError || amountMinor === null || amountMinor <= 0) { setFormError(amountError ?? "Enter an amount before continuing."); return; }
    setFormError(null);
    setShowConfirmation(true);
  }

  async function confirmTransfer() {
    if (!recipient || amountMinor === null) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const transfer = await api.createTransfer({ recipientUserId: recipient.userId, amountMinor, note: note.trim() || undefined }, idempotencyKey);
      router.replace(`/send/receipt/${transfer.reference}`);
    } catch (cause) {
      const sentence = cause instanceof ApiError ? cause.sentence : "Something went wrong. No money has moved.";
      // A network outcome can be ambiguous. Keep the idempotency key and the confirmation
      // sheet so the person can check history rather than seeing a false failure receipt.
      if (cause instanceof ApiError && cause.code === "NETWORK") {
        setFormError(sentence);
      } else {
        router.replace(`/send/receipt/failed?reason=${encodeURIComponent(sentence)}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md pb-24">
      <FixtureNotice />
      {offline && <OfflineBanner />}
      <Link href="/" className="mb-3 inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-primary-text hover:underline"><ArrowLeft aria-hidden className="size-4" />Home</Link>
      <h1 className="text-[24px] font-semibold leading-8">Send money</h1>
      <p className="mt-1 text-[15px] leading-6 text-text-secondary">Check who you are paying before confirming.</p>

      <section className="mt-7 space-y-5" aria-labelledby="recipient-heading">
        <div><p className="text-[13px] font-medium text-primary-text">Step 1 of 2</p><h2 id="recipient-heading" className="mt-1 text-[18px] font-semibold">Choose a recipient</h2></div>
        <PhoneInput value={phone} onChange={setPhone} error={recipientError} label="Recipient phone number" autoFocus />
        {lookingUp && <p className="flex items-center gap-2 text-[13px] text-text-secondary"><span className="size-3 animate-spin rounded-full border-2 border-purple-border border-t-primary" />Looking up recipient</p>}
        {recipient && <div className="space-y-2"><p className="flex items-center gap-1.5 text-[13px] font-medium text-success-text"><CheckCircle2 aria-hidden className="size-4" />Recipient found</p><RecipientCard recipient={recipient} /></div>}
        <div>
          <p className="mb-2 text-[13px] font-medium text-text-secondary">Recent recipients</p>
          <div className="grid grid-cols-3 gap-2">
            {RECENT_RECIPIENTS.map((item) => <button key={item.phone} type="button" onClick={() => setPhone(item.phone)} className="min-h-20 rounded-md border border-divider bg-surface px-2 py-2 text-center transition-colors hover:border-purple-border hover:bg-surface-subtle"><span aria-hidden className="mx-auto flex size-8 items-center justify-center rounded-full bg-purple-soft text-[11px] font-semibold text-primary-text">{item.initials}</span><span className="mt-1 block truncate text-[12px] font-medium text-text">{item.name.split(" ")[0]}</span></button>)}
          </div>
        </div>
      </section>

      <section className="mt-9 space-y-5 border-t border-divider pt-7" aria-labelledby="amount-heading">
        <div><p className="text-[13px] font-medium text-primary-text">Step 2 of 2</p><h2 id="amount-heading" className="mt-1 text-[18px] font-semibold">Set the amount</h2></div>
        <AmountInput value={amount} onChange={setAmount} minor={amountMinor} balanceMinor={balance?.balanceMinor ?? null} error={amountError} disabled={offline} />
        <div className="flex flex-col gap-1.5"><label htmlFor="note" className="text-[13px] font-medium text-text-secondary">Note <span className="font-normal">(optional)</span></label><textarea id="note" value={note} onChange={(event) => setNote(event.target.value.slice(0, 140))} rows={3} disabled={offline} className="resize-none rounded-md border border-control bg-surface px-3 py-2.5 text-[15px] text-text outline-none transition-colors placeholder:text-text-muted focus:border-primary disabled:opacity-55" placeholder="What is this for?" /><p className="text-right text-[12px] text-text-muted">{note.length}/140</p></div>
      </section>

      {formError && <p aria-live="polite" className="mt-5 rounded-md bg-danger-surface px-3 py-2.5 text-[13px] font-medium text-danger-text">{formError}</p>}
      <div className="safe-bottom fixed inset-x-0 bottom-[56px] z-20 border-t border-divider bg-bg/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:left-[15rem] sm:px-6">
        <div className="mx-auto max-w-md"><Button full onClick={continueToConfirmation} disabled={offline || !recipient || Boolean(amountError) || amountMinor === null || amountMinor <= 0}>Review transfer <ChevronRight aria-hidden className="size-4" /></Button></div>
      </div>

      {showConfirmation && recipient && amountMinor !== null && <ConfirmationSheet amountMinor={amountMinor} recipient={recipient} note={note.trim()} confirming={submitting} disabled={offline} error={offline ? "Reconnect to securely send money." : formError} onCancel={() => { if (!submitting) { setShowConfirmation(false); setFormError(null); } }} onConfirm={confirmTransfer} />}
    </div>
  );
}
