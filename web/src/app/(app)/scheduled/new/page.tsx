"use client";

import { ArrowLeft, CalendarClock, ChevronRight } from "lucide-react";
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
import { ApiError, api } from "@/lib/api";
import { parseTakaToPoisha } from "@/lib/money";
import { useOnlineStatus } from "@/lib/use-online-status";
import type { AccountSummary, RecipientPreview } from "@/lib/types";

function localDateTimeValue() {
  const date = new Date(Date.now() + 3_600_000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function currentTimestamp() {
  return Date.now();
}

export default function CreateScheduledTransferPage() {
  const router = useRouter();
  const online = useOnlineStatus();
  const [phone, setPhone] = useState("");
  const [lookup, setLookup] = useState<{ phone: string; recipient: RecipientPreview | null; error: string | null } | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [amount, setAmount] = useState("");
  const [scheduledFor, setScheduledFor] = useState(localDateTimeValue);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [now] = useState(currentTimestamp);
  const [minimumDateTime] = useState(localDateTimeValue);
  const amountMinor = useMemo(() => parseTakaToPoisha(amount), [amount]);
  const recipient = lookup?.phone === phone ? lookup.recipient : null;
  const phoneError = lookup?.phone === phone ? lookup.error : null;
  const scheduleDate = useMemo(() => new Date(scheduledFor), [scheduledFor]);
  const scheduleError = !scheduledFor || Number.isNaN(scheduleDate.getTime()) || scheduleDate.getTime() <= now ? "Choose a future date and time." : null;
  const amountError = amount && (amountMinor === null || amountMinor <= 0) ? "Enter an amount greater than zero." : amountMinor !== null && account && amountMinor > account.balanceMinor ? "You do not have enough balance today. The balance will be checked again when this is due." : null;

  useEffect(() => { let active = true; api.account().then((value) => active && setAccount(value)).catch(() => active && setError("Your balance is unavailable. Reconnect before scheduling money.")); return () => { active = false; }; }, []);
  useEffect(() => { if (phone.length !== 11) return; let active = true; api.recipientPreview(phone).then((value) => active && setLookup({ phone, recipient: value, error: null })).catch((cause) => active && setLookup({ phone, recipient: null, error: cause instanceof ApiError ? cause.sentence : "We could not find that recipient." })); return () => { active = false; }; }, [phone]);

  async function schedule() {
    if (!recipient || amountMinor === null || scheduleError || scheduleDate.getTime() <= Date.now()) {
      if (scheduleDate.getTime() <= Date.now()) setError("Choose a future date and time.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.createScheduledTransfer({ recipientUserId: recipient.userId, amountMinor, scheduledFor: scheduleDate.toISOString(), note: note.trim() || undefined });
      router.replace("/scheduled");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.sentence : "We could not schedule this transfer.");
    } finally { setSubmitting(false); }
  }

  return <div className="mx-auto max-w-md pb-24"><FixtureNotice />{!online && <OfflineBanner />}<Link href="/scheduled" className="mb-3 inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-primary-text hover:underline"><ArrowLeft aria-hidden className="size-4" />Scheduled transfers</Link><h1 className="text-[24px] font-semibold leading-8">Schedule a transfer</h1><p className="mt-1 text-[15px] leading-6 text-text-secondary">The recipient, balance, and policy are checked again when this transfer is due.</p><div className="mt-7 space-y-5"><PhoneInput value={phone} onChange={setPhone} error={phoneError} label="Recipient phone number" disabled={!online} autoFocus />{recipient && <RecipientCard recipient={recipient} />}<AmountInput value={amount} onChange={setAmount} minor={amountMinor} balanceMinor={account?.balanceMinor ?? null} error={amountError} disabled={!online} /><div><label htmlFor="scheduled-for" className="text-[13px] font-medium text-text-secondary">Date and time</label><input id="scheduled-for" type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} min={minimumDateTime} disabled={!online} className="mt-1.5 min-h-11 w-full rounded-md border border-control bg-surface px-3 text-[15px] text-text outline-none focus:border-primary disabled:opacity-55" />{scheduleError && <p className="mt-1 text-[13px] font-medium text-danger-text">{scheduleError}</p>}</div><div><label htmlFor="schedule-note" className="text-[13px] font-medium text-text-secondary">Note <span className="font-normal">(optional)</span></label><textarea id="schedule-note" value={note} onChange={(event) => setNote(event.target.value.slice(0, 140))} rows={3} disabled={!online} className="mt-1.5 w-full resize-none rounded-md border border-control bg-surface px-3 py-2.5 text-[15px] text-text outline-none focus:border-primary disabled:opacity-55" placeholder="What is this for?" /></div></div>{error && <p aria-live="polite" className="mt-5 rounded-md bg-danger-surface px-3 py-2.5 text-[13px] font-medium text-danger-text">{error}</p>}<div className="safe-bottom fixed inset-x-0 bottom-[56px] z-20 border-t border-divider bg-bg/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:left-[15rem]"><div className="mx-auto max-w-md"><Button full onClick={() => setReviewing(true)} disabled={!online || !recipient || amountMinor === null || amountMinor <= 0 || Boolean(amountError) || Boolean(scheduleError)}>Review schedule <ChevronRight aria-hidden className="size-4" /></Button></div></div>{reviewing && recipient && amountMinor !== null && <ConfirmationSheet amountMinor={amountMinor} recipient={recipient} note={note.trim()} title="Schedule transfer" eyebrow="Check the recipient carefully" confirmLabel="Confirm schedule" confirming={submitting} disabled={!online} error={error} onCancel={() => !submitting && setReviewing(false)} onConfirm={schedule}><p className="mt-4 flex items-center gap-2 text-[13px] text-text-secondary"><CalendarClock aria-hidden className="size-4 text-primary-text" />Will be attempted on {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(scheduleDate)}.</p></ConfirmationSheet>}</div>;
}
