"use client";

import { ArrowLeft, CircleAlert, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ReceiptCard } from "@/components/tx/ReceiptCard";
import { Button } from "@/components/ui/Button";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { Skeleton } from "@/components/ui/Skeleton";
import { ApiError, api, newIdempotencyKey } from "@/lib/api";
import type { Transfer } from "@/lib/types";
import { useOnlineStatus } from "@/lib/use-online-status";

export default function TransactionDetailPage() {
  const params = useParams<{ reference: string }>();
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [reversalKey] = useState(newIdempotencyKey);
  const online = useOnlineStatus();

  useEffect(() => {
    let active = true;
    api.transfer(params.reference).then((result) => active && setTransfer(result)).catch((cause) => active && setError(cause instanceof ApiError ? cause.sentence : "We could not load this transaction."));
    return () => { active = false; };
  }, [params.reference]);

  async function requestReversal() {
    if (!transfer || !online) return;
    setWorking(true);
    setError(null);
    try {
      const request = await api.requestReversal(transfer.reference, reversalKey);
      setRequestId(request.id);
      setConfirming(false);
      setTransfer({
        ...transfer,
        reversible: false,
        notReversibleReason: "A Reversal request is now pending.",
        reversalRequestId: request.id,
        reversalRequestStatus: request.status,
      });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.sentence : "The Reversal request could not be created.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      {!online && <OfflineBanner />}
      <Link href="/history" className="mb-3 inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-primary-text hover:underline"><ArrowLeft aria-hidden className="size-4" />Transaction history</Link>
      <h1 className="mb-6 text-[24px] font-semibold leading-8">Transfer details</h1>
      {transfer ? <><ReceiptCard transfer={transfer} allowCopy={false} />{transfer.riskReason && <section className="mt-4 rounded-md bg-warning-surface p-4"><h2 className="text-[15px] font-semibold text-warning-text">Extra verification was required</h2><p className="mt-1 text-[13px] leading-5 text-warning-text">{transfer.riskReason}</p></section>}{transfer.originalTransferReference && <Link href={`/history/${transfer.originalTransferReference}`} className="mt-5 inline-flex min-h-11 items-center gap-2 text-[13px] font-semibold text-primary-text hover:underline"><RotateCcw aria-hidden className="size-4" />View original Transfer</Link>}{requestId && <p className="mt-5 rounded-md bg-success-surface px-3 py-2.5 text-[13px] font-medium text-success-text">Reversal request created. <Link href={`/requests/${requestId}`} className="underline">View request</Link></p>}{transfer.reversible ? <section className="mt-7 border-t border-divider pt-6"><h2 className="text-[16px] font-semibold">Need the money returned?</h2><p className="mt-1 text-[13px] leading-5 text-text-secondary">A Reversal asks the recipient to approve a new compensating Transfer. Nothing is pulled from their Account.</p>{confirming ? <div className="mt-4 rounded-md bg-warning-surface p-4"><p className="text-[13px] font-medium text-warning-text">Send this consent request to the recipient?</p><div className="mt-4 grid grid-cols-2 gap-3"><Button variant="secondary" onClick={() => setConfirming(false)} disabled={working}>Cancel</Button><Button onClick={() => void requestReversal()} loading={working} disabled={!online}>Send request</Button></div></div> : <Button variant="secondary" className="mt-4" onClick={() => setConfirming(true)} disabled={!online}><RotateCcw aria-hidden className="size-4" />Request Reversal</Button>}</section> : transfer.notReversibleReason && <section className="mt-7 border-t border-divider pt-6"><p className="text-[13px] leading-5 text-text-secondary">{transfer.notReversibleReason}</p>{transfer.reversalRequestId && <Link href={`/requests/${transfer.reversalRequestId}`} className="mt-2 inline-flex min-h-11 items-center text-[13px] font-semibold text-primary-text hover:underline">View Reversal request</Link>}</section>}{error && <p role="alert" className="mt-5 rounded-md bg-danger-surface px-3 py-2.5 text-[13px] font-medium text-danger-text">{error}</p>}</> : error ? <section className="card p-6 text-center"><CircleAlert aria-hidden className="mx-auto size-7 text-danger-text" /><h2 className="mt-3 text-[18px] font-semibold">Transaction unavailable</h2><p className="mt-1 text-[15px] leading-6 text-text-secondary">{error}</p></section> : <div className="card space-y-4 p-5" aria-busy="true" aria-label="Loading transfer"><Skeleton className="mx-auto size-12 rounded-full" /><Skeleton className="mx-auto h-10 w-48" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>}
    </div>
  );
}
