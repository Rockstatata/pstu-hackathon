"use client";

import { ArrowLeft, Clock3, ReceiptText, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AmountDisplay } from "@/components/money/AmountDisplay";
import { ConfirmationSheet } from "@/components/send/ConfirmationSheet";
import { StepUpDialog } from "@/components/send/StepUpDialog";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ApiError, api, newIdempotencyKey } from "@/lib/api";
import { useOnlineStatus } from "@/lib/use-online-status";
import type { MoneyRequest, RecipientPreview } from "@/lib/types";

function remainingLabel(expiresAt: string, now: number) {
  const remaining = new Date(expiresAt).getTime() - now;
  if (remaining <= 0) return "This request has expired.";
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.ceil((remaining % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m remaining` : `${minutes}m remaining`;
}

function currentTimestamp() {
  return Date.now();
}

export default function RequestDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const online = useOnlineStatus();
  const [request, setRequest] = useState<MoneyRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [stepUpReason, setStepUpReason] = useState<string | null>(null);
  const [now] = useState(currentTimestamp);

  useEffect(() => {
    let active = true;
    api.moneyRequest(params.id)
      .then((value) => active && setRequest(value))
      .catch((cause) => active && setError(cause instanceof ApiError ? cause.sentence : "We could not load this money request."));
    return () => { active = false; };
  }, [params.id]);

  // Only the masked number is ever known here, which is all the confirmation
  // sheet renders. The payer never learns the requester's full number.
  const recipient = useMemo<RecipientPreview | null>(() => request ? {
    phone: request.counterpartyMaskedPhone,
    fullName: request.counterpartyName,
    maskedPhone: request.counterpartyMaskedPhone,
  } : null, [request]);
  const canAct = request?.status === "PENDING" && new Date(request.expiresAt).getTime() > now;

  async function update(action: "decline" | "cancel") {
    if (!request || !online) return;
    setWorking(true);
    setError(null);
    try {
      const updated = action === "decline"
        ? await api.declineMoneyRequest(request.id)
        : await api.cancelMoneyRequest(request.id);
      setRequest(updated);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.sentence : "We could not update this money request.");
    } finally {
      setWorking(false);
    }
  }

  /**
   * The same key is reused for every attempt, including the Step-Up retry: the
   * PIN is another proof of the same intention, not a different payment.
   */
  async function pay(pin?: string) {
    if (!request || !online) return;
    setWorking(true);
    setError(null);
    try {
      const receipt = await api.payMoneyRequest(request.id, idempotencyKey, pin);
      router.replace(`/send/receipt/${receipt.reference}`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "STEP_UP_REQUIRED") {
        setStepUpReason(cause.stepUpReason ?? cause.sentence);
        return;
      }
      if (cause instanceof ApiError && cause.code === "STEP_UP_FAILED") throw cause;
      setError(cause instanceof ApiError ? cause.sentence : "The request could not be paid. No money has moved.");
    } finally {
      setWorking(false);
    }
  }

  if (!request && !error) return <div className="mx-auto max-w-md"><Skeleton className="h-11 w-24" /><Skeleton className="mt-7 h-8 w-48" /><Skeleton className="mt-6 h-64 w-full" /></div>;
  if (!request) return <div className="mx-auto max-w-md"><EmptyState icon={ReceiptText} title="Request unavailable" detail={error ?? "This request is no longer available."} action={{ label: "Back to requests", onClick: () => router.push("/requests") }} /></div>;

  return (
    <div className="mx-auto max-w-md pb-10">
      
      {!online && <OfflineBanner />}
      <Link href="/requests" className="mb-3 inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-primary-text hover:underline"><ArrowLeft aria-hidden className="size-4" />Requests</Link>
      <div className="flex items-start justify-between gap-4"><div>{request.requestKind === "REVERSAL" && <p className="mb-1 inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary-text"><RotateCcw aria-hidden className="size-3.5" />Consent-based Reversal</p>}<h1 className="text-[24px] font-semibold leading-8">{request.requestKind === "REVERSAL" ? "Reversal request" : "Money request"}</h1><p className="mt-1 text-[15px] text-text-secondary">From {request.counterpartyName}</p></div><StatusBadge status={request.status} /></div>
      <section className="card mt-7 p-5">
        <AmountDisplay minor={request.amountMinor} size="lg" />
        <p className="mt-5 text-[13px] font-medium text-text-secondary">Reason</p>
        <p className="mt-1 text-[15px] leading-6 text-text">{request.reason}</p>
        <div className="mt-5 flex items-center gap-2 border-t border-divider pt-4 text-[13px] text-text-secondary"><Clock3 aria-hidden className="size-4" />{request.status === "PENDING" ? remainingLabel(request.expiresAt, now) : `Created ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(request.createdAt))}`}</div>
      </section>
      {request.transferReference && <Link href={`/history/${request.transferReference}`} className="mt-5 flex min-h-11 items-center gap-2 text-[13px] font-semibold text-primary-text hover:underline"><ReceiptText aria-hidden className="size-4" />View transfer receipt</Link>}
      {request.originalTransferReference && <Link href={`/history/${request.originalTransferReference}`} className="mt-2 flex min-h-11 items-center gap-2 text-[13px] font-semibold text-primary-text hover:underline"><RotateCcw aria-hidden className="size-4" />View original Transfer</Link>}
      {error && <p aria-live="polite" className="mt-5 rounded-md bg-danger-surface px-3 py-2.5 text-[13px] font-medium text-danger-text">{error}</p>}
      {canAct && <div className="mt-7 grid grid-cols-2 gap-3">{request.direction === "INCOMING" ? <><Button variant="ghost" onClick={() => update("decline")} disabled={!online || working}>Decline</Button><Button onClick={() => setReviewing(true)} disabled={!online || working}>Pay request</Button></> : <Button variant="ghost" full onClick={() => update("cancel")} disabled={!online || working}>Cancel request</Button>}</div>}
      {reviewing && recipient && <ConfirmationSheet amountMinor={request.amountMinor} recipient={recipient} note={request.reason} title="Pay money request" eyebrow="Check who you are paying" confirming={working} disabled={!online} error={error} onCancel={() => !working && setReviewing(false)} onConfirm={() => void pay()} />}
      {stepUpReason && <StepUpDialog reason={stepUpReason} onCancel={() => setStepUpReason(null)} onVerify={(pin) => pay(pin)} />}
    </div>
  );
}
