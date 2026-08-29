"use client";

import { HandCoins, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { RequestCard } from "@/components/requests/RequestCard";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { FixtureNotice } from "@/components/ui/FixtureNotice";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { TransactionListSkeleton } from "@/components/ui/Skeleton";
import { ApiError, api } from "@/lib/api";
import { useOnlineStatus } from "@/lib/use-online-status";
import type { MoneyRequest, RequestDirection } from "@/lib/types";

export default function RequestsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<MoneyRequest[] | null>(null);
  const [tab, setTab] = useState<RequestDirection>("INCOMING");
  const [error, setError] = useState<string | null>(null);
  const online = useOnlineStatus();

  useEffect(() => {
    let active = true;
    api.moneyRequests().then((result) => active && setRequests(result.items)).catch((cause) => active && setError(cause instanceof ApiError ? cause.sentence : "We could not load your money requests."));
    return () => { active = false; };
  }, []);

  const visible = useMemo(() => requests?.filter((request) => request.direction === tab) ?? [], [requests, tab]);

  return <div className="mx-auto max-w-2xl"><FixtureNotice />{!online && <OfflineBanner />}<header className="mb-5 flex items-end justify-between gap-4"><div><p className="text-[13px] font-medium text-text-secondary">Money that needs a response</p><h1 className="mt-1 text-[24px] font-semibold leading-8">Requests</h1></div><Link href="/requests/new"><Button><Plus aria-hidden className="size-4" />Request money</Button></Link></header><div className="grid grid-cols-2 rounded-md bg-surface-subtle p-1" aria-label="Request direction"><button type="button" onClick={() => setTab("INCOMING")} aria-pressed={tab === "INCOMING"} className={`min-h-11 rounded-sm text-[13px] font-semibold ${tab === "INCOMING" ? "bg-surface text-primary-text shadow-sm" : "text-text-secondary"}`}>Incoming</button><button type="button" onClick={() => setTab("OUTGOING")} aria-pressed={tab === "OUTGOING"} className={`min-h-11 rounded-sm text-[13px] font-semibold ${tab === "OUTGOING" ? "bg-surface text-primary-text shadow-sm" : "text-text-secondary"}`}>Outgoing</button></div>{error && <p role="alert" className="mt-5 rounded-md bg-danger-surface px-3 py-2.5 text-[13px] font-medium text-danger-text">{error}</p>}<section className="mt-5 space-y-3">{requests === null ? <TransactionListSkeleton /> : visible.length ? visible.map((request) => <RequestCard key={request.id} request={request} />) : <EmptyState icon={HandCoins} title={tab === "INCOMING" ? "No incoming requests" : "No outgoing requests"} detail={tab === "INCOMING" ? "When someone asks you for money, it will appear here." : "Create a request when someone owes you money."} action={tab === "OUTGOING" ? { label: "Request money", onClick: () => router.push("/requests/new") } : undefined} />}</section></div>;
}
