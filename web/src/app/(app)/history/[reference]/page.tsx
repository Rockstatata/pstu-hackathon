"use client";

import { ArrowLeft, CircleAlert } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ReceiptCard } from "@/components/tx/ReceiptCard";
import { FixtureNotice } from "@/components/ui/FixtureNotice";
import { Skeleton } from "@/components/ui/Skeleton";
import { ApiError, api } from "@/lib/api";
import type { Transfer } from "@/lib/types";

export default function TransactionDetailPage() {
  const params = useParams<{ reference: string }>();
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.transfer(params.reference).then((result) => active && setTransfer(result)).catch((cause) => active && setError(cause instanceof ApiError ? cause.sentence : "We could not load this transaction."));
    return () => { active = false; };
  }, [params.reference]);

  return (
    <div className="mx-auto max-w-md">
      <FixtureNotice />
      <Link href="/history" className="mb-3 inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-primary-text hover:underline"><ArrowLeft aria-hidden className="size-4" />Transaction history</Link>
      <h1 className="mb-6 text-[24px] font-semibold leading-8">Transfer details</h1>
      {transfer ? <><ReceiptCard transfer={transfer} allowCopy={false} />{transfer.riskReason && <section className="mt-4 rounded-md bg-warning-surface p-4"><h2 className="text-[15px] font-semibold text-warning-text">Extra verification was required</h2><p className="mt-1 text-[13px] leading-5 text-warning-text">{transfer.riskReason}</p></section>}</> : error ? <section className="card p-6 text-center"><CircleAlert aria-hidden className="mx-auto size-7 text-danger-text" /><h2 className="mt-3 text-[18px] font-semibold">Transaction unavailable</h2><p className="mt-1 text-[15px] leading-6 text-text-secondary">{error}</p></section> : <div className="card space-y-4 p-5" aria-busy="true" aria-label="Loading transfer"><Skeleton className="mx-auto size-12 rounded-full" /><Skeleton className="mx-auto h-10 w-48" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>}
    </div>
  );
}
