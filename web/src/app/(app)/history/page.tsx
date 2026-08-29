"use client";

import { Filter, ReceiptText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { TransactionList } from "@/components/tx/TransactionList";
import { EmptyState } from "@/components/ui/EmptyState";
import { FixtureNotice } from "@/components/ui/FixtureNotice";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { TransactionListSkeleton } from "@/components/ui/Skeleton";
import { ApiError, api } from "@/lib/api";
import { displayCache } from "@/lib/display-cache";
import { useOnlineStatus } from "@/lib/use-online-status";
import type { Transfer } from "@/lib/types";

type FilterKey = "ALL" | "SENT" | "RECEIVED" | "REVERSED";
const FILTERS: { key: FilterKey; label: string }[] = [{ key: "ALL", label: "All" }, { key: "SENT", label: "Sent" }, { key: "RECEIVED", label: "Received" }, { key: "REVERSED", label: "Reversed" }];

export default function HistoryPage() {
  const [transfers, setTransfers] = useState<Transfer[] | null>(null);
  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [error, setError] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const offline = !useOnlineStatus();

  useEffect(() => {
    let active = true;
    api.transfers()
      .then((result) => {
        if (!active) return;
        displayCache.saveTransfers(result.items);
        setTransfers(result.items);
      })
      .catch((cause) => {
        if (!active) return;
        const cached = displayCache.transfers();
        if (cached) {
          setTransfers(cached.value);
          setCachedAt(cached.asOf);
        } else {
          setTransfers([]);
        }
        setError(cause instanceof ApiError ? cause.sentence : "We could not load your transfer history.");
      });
    return () => { active = false; };
  }, []);

  const visible = useMemo(() => (transfers ?? []).filter((transfer) => {
    if (filter === "SENT") return transfer.direction === "OUT" && transfer.status !== "REVERSED";
    if (filter === "RECEIVED") return transfer.direction === "IN" && transfer.status !== "REVERSED";
    if (filter === "REVERSED") return transfer.status === "REVERSED";
    return true;
  }), [filter, transfers]);

  return (
    <div className="mx-auto max-w-2xl">
      <FixtureNotice />
      {offline && <OfflineBanner />}
      <header className="mb-5"><p className="text-[13px] font-medium text-text-secondary">Your account activity</p><h1 className="mt-1 text-[24px] font-semibold leading-8">Transaction history</h1></header>
      <div className="mb-5 flex items-center gap-2 overflow-x-auto pb-1" aria-label="Transaction filters">
        <Filter aria-hidden className="size-4 shrink-0 text-text-secondary" />
        {FILTERS.map(({ key, label }) => <button type="button" key={key} onClick={() => setFilter(key)} aria-pressed={filter === key} className={`min-h-11 shrink-0 rounded-full px-4 text-[13px] font-semibold transition-colors ${filter === key ? "bg-purple-soft text-primary-text" : "text-text-secondary hover:bg-surface-subtle"}`}>{label}</button>)}
      </div>
      {error && <p role="alert" className="mb-5 rounded-md bg-danger-surface px-3 py-2.5 text-[13px] font-medium text-danger-text">{error}</p>}
      <section className="card p-3 sm:p-4">
        {transfers === null ? <TransactionListSkeleton /> : visible.length ? <TransactionList transfers={visible} /> : <EmptyState icon={ReceiptText} title="Nothing matches this filter" detail={filter === "ALL" ? "Your completed transfers will appear here." : "Try another filter to see more activity."} />}
        {cachedAt && <p className="border-t border-divider px-2 pt-3 text-[12px] text-text-muted">Cached copy · last updated {new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(cachedAt))}</p>}
      </section>
    </div>
  );
}
