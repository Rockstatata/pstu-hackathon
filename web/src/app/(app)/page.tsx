"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Send, WalletCards, X } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { BalanceCard } from "@/components/money/BalanceCard";
import { AmountDisplay } from "@/components/money/AmountDisplay";
import { TransactionList } from "@/components/tx/TransactionList";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { TransactionListSkeleton } from "@/components/ui/Skeleton";
import { ApiError, api } from "@/lib/api";
import { displayCache } from "@/lib/display-cache";
import { shippedQuickActions } from "@/lib/nav";
import { useOnlineStatus } from "@/lib/use-online-status";
import type { AccountSummary, Transfer } from "@/lib/types";

export default function HomePage() {
  return <Suspense fallback={<HomePageSkeleton />}><HomeContent /></Suspense>;
}

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [transfers, setTransfers] = useState<Transfer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const offline = !useOnlineStatus();
  const welcome = searchParams.get("welcome") === "1";

  useEffect(() => {
    let active = true;
    Promise.all([api.account(), api.transfers()])
      .then(([nextAccount, result]) => {
        if (!active) return;
        displayCache.saveAccount(nextAccount);
        displayCache.saveTransfers(result.items);
        setAccount(nextAccount);
        setTransfers(result.items.slice(0, 5));
      })
      .catch((cause) => {
        if (!active) return;
        const cachedAccount = displayCache.account();
        const cachedTransfers = displayCache.transfers();
        if (cachedAccount) setAccount(cachedAccount.value);
        if (cachedTransfers) setTransfers(cachedTransfers.value.slice(0, 5));
        setCachedAt(cachedAccount?.asOf ?? cachedTransfers?.asOf ?? null);
        setError(cause instanceof ApiError ? cause.sentence : "We could not load your account right now.");
        if (!cachedTransfers) setTransfers([]);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      
      {offline && <OfflineBanner />}
      <header className="mb-6 flex items-end justify-between gap-4">
        <div><p className="text-[13px] font-medium text-text-secondary">Your account</p><h1 className="mt-1 text-[24px] font-semibold leading-8">Good to see you</h1></div>
        <Link href="/history" className="hidden min-h-11 items-center text-[13px] font-semibold text-primary-text hover:underline sm:inline-flex">View history</Link>
      </header>
      {error && <p role="alert" className="mb-5 rounded-md bg-danger-surface px-3 py-2.5 text-[13px] font-medium text-danger-text">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(20rem,1.1fr)] lg:items-start">
        <section>
          <BalanceCard balanceMinor={account?.balanceMinor ?? null} asOf={account?.asOf ?? cachedAt} offline={offline || Boolean(cachedAt)} />
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {shippedQuickActions().map(({ href, label, icon: Icon }, index) => (
              <Link key={href} href={href} className={`flex min-h-12 items-center justify-center gap-2 rounded-md border px-5 text-[15px] font-semibold transition-[background-color,color,border-color,transform] duration-150 active:translate-y-px ${offline ? "pointer-events-none border-divider bg-surface-subtle text-text-muted" : index === 0 ? "border-primary bg-primary text-primary-fg hover:bg-primary-hover" : "border-purple-border bg-surface text-primary-text hover:bg-purple-soft"}`} aria-disabled={offline || undefined}>
                <Icon aria-hidden className="size-5" />{label}
              </Link>
            ))}
            {offline && <p className="mt-2 text-center text-[12px] text-text-secondary">Reconnect to securely send money.</p>}
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 pb-3 pt-5">
            <h2 className="text-[18px] font-semibold">Recent transactions</h2>
            <Link href="/history" className="inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-primary-text hover:underline">See all <ArrowRight aria-hidden className="size-4" /></Link>
          </div>
          {transfers === null ? <TransactionListSkeleton /> : transfers.length ? <TransactionList transfers={transfers} /> : <EmptyState icon={WalletCards} title="No transactions yet" detail="When money moves in or out, you will see it here." action={offline ? undefined : { label: "Send money", onClick: () => router.push("/send") }} />}
          {cachedAt && <p className="border-t border-divider px-5 py-3 text-[12px] text-text-muted">Last updated {new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(cachedAt))}</p>}
        </section>
      </div>

      {welcome && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-5" role="presentation">
          <section className="sheet-enter relative w-full max-w-sm rounded-xl bg-surface p-6 text-center shadow-[var(--shadow-sheet)]" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-purple-soft text-primary-text"><Send aria-hidden className="size-6" /></span>
            <p className="mt-4 text-[13px] font-medium text-text-secondary">Your account is ready</p>
            <h2 id="welcome-title" className="mt-1 text-[24px] font-semibold leading-8">Welcome to Chorui!</h2>
            <p className="mt-3 text-[15px] leading-6 text-text-secondary">Your welcome balance is ready to use.</p>
            <AmountDisplay minor={10_000_000} size="md" className="mt-1" />
            <Button full className="mt-6" onClick={() => router.replace("/")}>Continue</Button>
            <button type="button" className="absolute right-6 top-6 inline-flex size-11 items-center justify-center text-text-secondary" onClick={() => router.replace("/")} aria-label="Close welcome message"><X aria-hidden className="size-5" /></button>
          </section>
        </div>
      )}
    </>
  );
}

function HomePageSkeleton() {
  return <div className="space-y-6" aria-busy="true" aria-label="Loading home"><div><div className="h-4 w-24 animate-pulse rounded bg-surface-subtle" /><div className="mt-2 h-8 w-40 animate-pulse rounded bg-surface-subtle" /></div><div className="h-48 animate-pulse rounded-lg bg-surface-subtle" /></div>;
}
