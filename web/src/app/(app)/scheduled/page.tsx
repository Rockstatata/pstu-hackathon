"use client";

import { CalendarClock, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AmountDisplay } from "@/components/money/AmountDisplay";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ApiError, api } from "@/lib/api";
import type { ScheduledTransfer } from "@/lib/types";
import { useOnlineStatus } from "@/lib/use-online-status";

function scheduledTime(value: string) {
  return new Intl.DateTimeFormat("en-BD", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function ScheduledTransfersPage() {
  const router = useRouter();
  const [items, setItems] = useState<ScheduledTransfer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const online = useOnlineStatus();

  useEffect(() => {
    let active = true;
    api.scheduledTransfers()
      .then((result) => active && setItems(result))
      .catch((cause) => active && setError(
        cause instanceof ApiError ? cause.sentence : "We could not load Scheduled Transfers.",
      ));
    return () => { active = false; };
  }, []);

  const [upcoming, past] = useMemo(() => {
    const all = items ?? [];
    return [
      all.filter((item) => item.status === "SCHEDULED"),
      all.filter((item) => item.status !== "SCHEDULED"),
    ];
  }, [items]);

  async function cancel(id: string) {
    if (!online) return;
    setCancelling(id);
    setError(null);
    try {
      const updated = await api.cancelScheduledTransfer(id);
      setItems((current) => current?.map((item) => item.id === id ? updated : item) ?? null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.sentence : "We could not cancel this schedule.");
    } finally {
      setCancelling(null);
    }
  }

  function transferRow(item: ScheduledTransfer) {
    return (
      <article key={item.id} className="border-b border-divider py-5 last:border-b-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">{item.recipientName}</p>
            <p className="tnum mt-0.5 text-[13px] text-text-secondary">{item.recipientMaskedPhone}</p>
          </div>
          <AmountDisplay minor={item.amountMinor} size="md" />
        </div>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[13px] text-text-secondary">
              {item.status === "SCHEDULED" ? "Scheduled for " : "Execution time: "}
              {scheduledTime(item.executeAt)}
            </p>
            {item.failureMessage && <p className="mt-1 max-w-md text-[13px] leading-5 text-danger-text">{item.failureMessage}</p>}
            {item.note && <p className="mt-1 text-[13px] text-text-tertiary">{item.note}</p>}
          </div>
          <StatusBadge status={item.status} />
        </div>
        <div className="mt-2 flex flex-wrap gap-3">
          {item.status === "SCHEDULED" && (
            <Button variant="ghost" className="px-0" loading={cancelling === item.id} disabled={!online || cancelling !== null} onClick={() => void cancel(item.id)}>
              Cancel schedule
            </Button>
          )}
          {item.transferReference && (
            <Link href={`/history/${item.transferReference}`} className="inline-flex min-h-11 items-center text-[13px] font-semibold text-primary-text hover:underline">
              View Transfer
            </Link>
          )}
        </div>
      </article>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      {!online && <OfflineBanner />}
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-text-secondary">Future instructions, checked when due</p>
          <h1 className="mt-1 text-[24px] font-semibold leading-8">Scheduled Transfers</h1>
        </div>
        <ButtonLink href="/scheduled/new"><Plus aria-hidden className="size-4" />Schedule</ButtonLink>
      </header>
      {error && <p role="alert" className="mb-5 rounded-md bg-danger-surface px-3 py-2.5 text-[13px] font-medium text-danger-text">{error}</p>}
      {items === null ? (
        <div className="space-y-3"><Skeleton className="h-36 w-full" /><Skeleton className="h-36 w-full" /></div>
      ) : items.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No Scheduled Transfers" detail="Set up a future instruction; balance and policy checks happen when it becomes due." action={online ? { label: "Schedule Transfer", onClick: () => router.push("/scheduled/new") } : undefined} />
      ) : (
        <>
          <section><h2 className="text-[15px] font-semibold">Upcoming</h2>{upcoming.length ? <div className="mt-2">{upcoming.map(transferRow)}</div> : <p className="mt-3 text-[13px] text-text-secondary">Nothing is scheduled to send.</p>}</section>
          <section className="mt-9"><h2 className="text-[15px] font-semibold">Past</h2>{past.length ? <div className="mt-2">{past.map(transferRow)}</div> : <p className="mt-3 text-[13px] text-text-secondary">Executed, failed, and cancelled schedules appear here.</p>}</section>
        </>
      )}
    </div>
  );
}
