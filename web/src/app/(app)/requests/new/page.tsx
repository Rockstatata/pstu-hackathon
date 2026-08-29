"use client";

import { ArrowLeft, CheckCircle2, Send } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AmountDisplay } from "@/components/money/AmountDisplay";
import { AmountInput } from "@/components/money/AmountInput";
import { RecipientCard } from "@/components/money/RecipientCard";
import { Button } from "@/components/ui/Button";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { ApiError, api, newIdempotencyKey } from "@/lib/api";
import { parseTakaToPoisha } from "@/lib/money";
import { useOnlineStatus } from "@/lib/use-online-status";
import type { RecipientPreview } from "@/lib/types";

export default function CreateRequestPage() {
  const [phone, setPhone] = useState("");
  const [lookup, setLookup] = useState<{ phone: string; recipient: RecipientPreview | null; error: string | null } | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<{ amountMinor: number; name: string } | null>(null);
  const [idempotencyKey] = useState(newIdempotencyKey);
  const online = useOnlineStatus();
  const amountMinor = useMemo(() => parseTakaToPoisha(amount), [amount]);
  const recipient = lookup?.phone === phone ? lookup.recipient : null;
  const phoneError = lookup?.phone === phone ? lookup.error : null;
  const amountError = amount && (amountMinor === null || amountMinor <= 0) ? "Enter an amount greater than zero." : null;

  useEffect(() => {
    if (phone.length !== 11) return;
    let active = true;
    api.recipientPreview(phone).then((preview) => active && setLookup({ phone, recipient: preview, error: null })).catch((cause) => active && setLookup({ phone, recipient: null, error: cause instanceof ApiError ? cause.sentence : "We could not find that person." }));
    return () => { active = false; };
  }, [phone]);

  async function submit() {
    if (!recipient || amountMinor === null || amountMinor <= 0 || amountError || !reason.trim()) { setError(!recipient ? "Choose the person you are requesting from." : !reason.trim() ? "Add a short reason for this request." : amountError ?? "Enter an amount greater than zero."); return; }
    setSubmitting(true);
    setError(null);
    try {
      await api.createMoneyRequest({ payerPhone: recipient.phone, amountMinor, reason: reason.trim() }, idempotencyKey);
      setCreated({ amountMinor, name: recipient.fullName });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.sentence : "We could not create this money request.");
    } finally { setSubmitting(false); }
  }

  if (created) return <div className="mx-auto max-w-md"><section className="card mt-14 p-7 text-center" aria-live="polite"><span className="mx-auto flex size-12 items-center justify-center rounded-full bg-success-surface text-success-text"><CheckCircle2 aria-hidden className="size-6" /></span><p className="mt-4 text-[13px] font-medium text-text-secondary">Money request created</p><AmountDisplay minor={created.amountMinor} size="lg" className="mt-1" /><p className="mt-3 text-[15px] leading-6 text-text-secondary">{created.name} has 24 hours to respond.</p><Link href="/requests" className="mt-6 block"><Button full>View requests</Button></Link></section></div>;

  return <div className="mx-auto max-w-md pb-10">{!online && <OfflineBanner />}<Link href="/requests" className="mb-3 inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-primary-text hover:underline"><ArrowLeft aria-hidden className="size-4" />Requests</Link><h1 className="text-[24px] font-semibold leading-8">Request money</h1><p className="mt-1 text-[15px] leading-6 text-text-secondary">Ask someone to send you a specific amount. It expires after 24 hours.</p><div className="mt-7 space-y-5"><PhoneInput value={phone} onChange={setPhone} error={phoneError} label="Request from" disabled={!online} autoFocus />{recipient && <RecipientCard recipient={recipient} />}<AmountInput value={amount} onChange={setAmount} minor={amountMinor} balanceMinor={null} error={amountError} disabled={!online} /><div><label htmlFor="request-reason" className="text-[13px] font-medium text-text-secondary">Reason</label><textarea id="request-reason" value={reason} onChange={(event) => setReason(event.target.value.slice(0, 140))} disabled={!online} rows={3} className="mt-1.5 w-full resize-none rounded-md border border-control bg-surface px-3 py-2.5 text-[15px] text-text outline-none focus:border-primary disabled:opacity-55" placeholder="What is this for?" /><p className="mt-1 text-[12px] text-text-secondary">Expires 24 hours after it is sent.</p></div></div>{error && <p aria-live="polite" className="mt-5 rounded-md bg-danger-surface px-3 py-2.5 text-[13px] font-medium text-danger-text">{error}</p>}<Button full className="mt-7" loading={submitting} disabled={!online || !recipient || Boolean(amountError) || amountMinor === null || amountMinor <= 0 || !reason.trim()} onClick={submit}><Send aria-hidden className="size-4" />Send request</Button></div>;
}
