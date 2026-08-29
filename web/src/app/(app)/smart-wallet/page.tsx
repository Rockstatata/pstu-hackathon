"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  CircleDot,
  RefreshCcw,
  Scale,
  Unplug,
  WalletCards,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AmountDisplay } from "@/components/money/AmountDisplay";
import { AmountInput } from "@/components/money/AmountInput";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { Skeleton } from "@/components/ui/Skeleton";
import { ApiError, api, newIdempotencyKey } from "@/lib/api";
import { parseTakaToPoisha } from "@/lib/money";
import type { CashEvent, SmartWallet } from "@/lib/types";
import { useOnlineStatus } from "@/lib/use-online-status";
import { useI18n } from "@/components/i18n/LanguageProvider";

type ObservationKind = "CASH_IN" | "CASH_OUT";

function ActivityRow({ event }: { event: CashEvent }) {
  const { t, formatDate } = useI18n();
  const Icon =
    event.kind === "CASH_IN"
      ? ArrowDownToLine
      : event.kind === "CASH_OUT"
        ? ArrowUpFromLine
        : Scale;
  const amountKind =
    event.kind === "CASH_IN" ? "IN" : event.kind === "CASH_OUT" ? "OUT" : "PLAIN";

  return (
    <li className="flex min-h-16 items-center gap-3 border-b border-divider py-3 last:border-0">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-primary-text">
        <Icon aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold">{event.reason || t(event.kind === "CASH_IN" ? "Cash received" : event.kind === "CASH_OUT" ? "Cash removed" : event.amountMinor === 0 ? "Cash count matched" : "Cash count reconciled")}</p>
        <p className="mt-0.5 text-[12px] text-text-secondary">
          {t(event.kind === "RECONCILIATION" ? "Reconciliation" : "Sensor simulator")} · {formatDate(event.recordedAt, { dateStyle: "medium", timeStyle: "short" })}
        </p>
      </div>
      <AmountDisplay
        minor={Math.abs(event.amountMinor)}
        kind={amountKind}
        showIcon={event.kind !== "RECONCILIATION"}
      />
    </li>
  );
}

export default function SmartWalletPage() {
  const { t, formatDate, formatNumber } = useI18n();
  const online = useOnlineStatus();
  const [wallet, setWallet] = useState<SmartWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [kind, setKind] = useState<ObservationKind>("CASH_IN");
  const [amount, setAmount] = useState("");
  const [eventReason, setEventReason] = useState("");
  const [showReconcile, setShowReconcile] = useState(false);
  const [counted, setCounted] = useState("");
  const [reconcileReason, setReconcileReason] = useState("");

  const amountMinor = useMemo(() => parseTakaToPoisha(amount), [amount]);
  const countedMinor = useMemo(() => parseTakaToPoisha(counted), [counted]);
  const discrepancy =
    wallet && countedMinor !== null ? countedMinor - wallet.expectedCashMinor : null;
  const connected = wallet?.connectionStatus === "CONNECTED";
  const amountError = useMemo(() => {
    if (!amount) return null;
    if (amountMinor === null || amountMinor <= 0) return t("Enter an amount greater than zero.");
    if (kind === "CASH_OUT" && wallet && amountMinor > wallet.expectedCashMinor) {
      return t("That is more than the current Expected Cash. Reconcile the wallet first.");
    }
    return null;
  }, [amount, amountMinor, kind, t, wallet]);

  useEffect(() => {
    let active = true;
    api
      .smartWallet()
      .then((result) => active && setWallet(result))
      .catch((cause) =>
        active &&
        setError(cause instanceof ApiError ? cause.sentence : t("We could not load the Smart Wallet.")),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [t]);

  async function toggleConnection() {
    if (!wallet || !online) return;
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const next = await api.setSmartWalletConnection(!connected);
      setWallet(next);
      setNotice(t(next.connectionStatus === "CONNECTED" ? "Simulator connected." : "Simulator disconnected."));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.sentence : t("The connection state could not be changed."));
    } finally {
      setWorking(false);
    }
  }

  async function recordObservation() {
    if (!wallet || amountMinor === null || amountMinor <= 0 || amountError || !connected) return;
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.recordCashEvent(
        { kind, amountMinor, reason: eventReason.trim() || undefined },
        newIdempotencyKey(),
      );
      setWallet(result.wallet);
      setAmount("");
      setEventReason("");
      setNotice(t(kind === "CASH_IN" ? "Cash-in observation recorded." : "Cash-out observation recorded."));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.sentence : t("The cash observation could not be recorded."));
    } finally {
      setWorking(false);
    }
  }

  async function reconcile() {
    if (countedMinor === null || countedMinor < 0 || !reconcileReason.trim()) return;
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.reconcileCash(
        { countedCashMinor: countedMinor, reason: reconcileReason.trim() },
        newIdempotencyKey(),
      );
      setWallet(result.wallet);
      setCounted("");
      setReconcileReason("");
      setShowReconcile(false);
      setNotice(t("Cash Count Reconciliation recorded. Earlier history was preserved."));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.sentence : t("The cash count could not be reconciled."));
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl">
        <Skeleton className="h-24 w-full" />
        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(19rem,2fr)]">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl pb-8">
      {!online && <OfflineBanner />}
      <header className="max-w-2xl">
        <p className="text-[13px] font-medium text-primary-text">{t("Physical cash, accounted for")}</p>
        <h1 className="mt-1 text-[24px] font-semibold leading-8">{t("Smart wallet")}</h1>
        <p className="mt-2 text-[15px] leading-6 text-text-secondary">
          {t("A software interface for a future sensor-equipped wallet. Expected Cash stays separate from your digital Account Balance and Ledger.")}
        </p>
      </header>

      {error && (
        <p role="alert" className="mt-5 rounded-md bg-danger-surface px-3 py-2.5 text-[13px] font-medium text-danger-text">
          {error}
        </p>
      )}
      {notice && (
        <p aria-live="polite" className="mt-5 flex items-center gap-2 rounded-md bg-success-surface px-3 py-2.5 text-[13px] font-medium text-success-text">
          <Check aria-hidden className="size-4" /> {notice}
        </p>
      )}

      {wallet && (
        <div className="mt-7 grid items-start gap-7 lg:grid-cols-[minmax(0,3fr)_minmax(19rem,2fr)]">
          <div>
            <section aria-labelledby="expected-cash" className="border-y border-divider py-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p id="expected-cash" className="text-[13px] font-medium text-text-secondary">{t("Expected Cash")}</p>
                  <AmountDisplay minor={wallet.expectedCashMinor} size="xl" className="mt-2" />
                  <p className="mt-2 text-[13px] text-text-secondary">{t("Derived from {count} immutable Cash Events.", { count: formatNumber(wallet.lastSequence) })}</p>
                </div>
                <WalletCards aria-hidden className="mt-1 size-7 text-primary-text" />
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-4">
                <div>
                  <p className={`flex items-center gap-2 text-[13px] font-semibold ${connected ? "text-success-text" : "text-text-secondary"}`}>
                    {connected ? <CircleDot aria-hidden className="size-4" /> : <Unplug aria-hidden className="size-4" />}
                    {t(connected ? "Simulator connected" : "Simulator disconnected")}
                  </p>
                  <p className="mt-1 text-[12px] text-text-secondary">{wallet.lastSyncedAt ? t("Last sync: {date}", { date: formatDate(wallet.lastSyncedAt, { dateStyle: "medium", timeStyle: "short" }) }) : t("Not synced yet")}</p>
                </div>
                <Button variant="secondary" onClick={() => void toggleConnection()} disabled={!online} loading={working}>
                  {t(connected ? "Disconnect" : "Connect simulator")}
                </Button>
              </div>
            </section>

            <section className="mt-8" aria-labelledby="sensor-simulator">
              <div className="flex items-center gap-2">
                <RefreshCcw aria-hidden className="size-5 text-primary-text" />
                <h2 id="sensor-simulator" className="text-[18px] font-semibold">{t("Sensor simulator")}</h2>
              </div>
              <p className="mt-1 text-[13px] leading-5 text-text-secondary">{t("Record what future hardware would report. These controls never alter digital money.")}</p>

              <div className="mt-4 grid grid-cols-2 rounded-md bg-surface-subtle p-1">
                <button type="button" onClick={() => setKind("CASH_IN")} aria-pressed={kind === "CASH_IN"} className={`min-h-11 rounded-sm text-[13px] font-semibold ${kind === "CASH_IN" ? "bg-surface text-primary-text shadow-sm" : "text-text-secondary"}`}>{t("Cash in")}</button>
                <button type="button" onClick={() => setKind("CASH_OUT")} aria-pressed={kind === "CASH_OUT"} className={`min-h-11 rounded-sm text-[13px] font-semibold ${kind === "CASH_OUT" ? "bg-surface text-primary-text shadow-sm" : "text-text-secondary"}`}>{t("Cash out")}</button>
              </div>
              <div className="mt-4">
                <AmountInput value={amount} onChange={setAmount} minor={amountMinor} balanceMinor={kind === "CASH_OUT" ? wallet.expectedCashMinor : null} availableLabel={t("Expected Cash")} error={amountError} disabled={!online || !connected || working} />
              </div>
              <div className="mt-4">
                <Field label={t("Description (optional)")} value={eventReason} onChange={(event) => setEventReason(event.target.value.slice(0, 140))} placeholder={t(kind === "CASH_IN" ? "Cash received" : "Cash payment")} disabled={!online || !connected || working} />
              </div>
              {!connected && <p className="mt-3 text-[13px] font-medium text-warning-text">{t("Connect the simulator to record sensor events.")}</p>}
              <Button full className="mt-5" onClick={() => void recordObservation()} loading={working} disabled={!online || !connected || amountMinor === null || amountMinor <= 0 || Boolean(amountError)}>
                {kind === "CASH_IN" ? <ArrowDownToLine aria-hidden className="size-4" /> : <ArrowUpFromLine aria-hidden className="size-4" />}
                {t(kind === "CASH_IN" ? "Record simulated cash in" : "Record simulated cash out")}
              </Button>
            </section>

            <section className="mt-9 border-t border-divider pt-7" aria-labelledby="cash-reconciliation">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="cash-reconciliation" className="text-[18px] font-semibold">{t("Cash Count Reconciliation")}</h2>
                  <p className="mt-1 text-[13px] leading-5 text-text-secondary">{t("Count the banknotes. A difference becomes an explicit event; history is never rewritten.")}</p>
                </div>
                <Scale aria-hidden className="mt-1 size-5 shrink-0 text-primary-text" />
              </div>
              {!showReconcile ? (
                <Button variant="secondary" className="mt-4" onClick={() => setShowReconcile(true)}>{t("Reconcile cash")}</Button>
              ) : (
                <div className="mt-5 border-l-2 border-purple-border pl-4">
                  <AmountInput value={counted} onChange={setCounted} minor={countedMinor} balanceMinor={wallet.expectedCashMinor} label={t("Counted Cash")} availableLabel={t("expected")} disabled={!online || working} />
                  {discrepancy !== null && (
                    <div className={`mt-4 flex items-center justify-between rounded-md px-3 py-3 ${discrepancy === 0 ? "bg-success-surface text-success-text" : "bg-warning-surface text-warning-text"}`}>
                      <span className="text-[13px] font-semibold">{t(discrepancy === 0 ? "Count matches" : "Discrepancy")}</span>
                      <AmountDisplay minor={discrepancy} size="md" className="text-current" />
                    </div>
                  )}
                  <div className="mt-4"><Field label={t("Reason")} value={reconcileReason} onChange={(event) => setReconcileReason(event.target.value.slice(0, 140))} placeholder={t("What explains this count?")} disabled={!online || working} /></div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <Button variant="secondary" onClick={() => setShowReconcile(false)} disabled={working}>{t("Cancel")}</Button>
                    <Button onClick={() => void reconcile()} loading={working} disabled={!online || countedMinor === null || countedMinor < 0 || !reconcileReason.trim()}>{t("Record count")}</Button>
                  </div>
                </div>
              )}
            </section>
          </div>

          <aside className="lg:sticky lg:top-24" aria-labelledby="cash-activity">
            <div className="flex items-end justify-between gap-3 border-b border-divider pb-3">
              <div><p className="text-[13px] font-medium text-text-secondary">{t("Cash Inventory Journal")}</p><h2 id="cash-activity" className="mt-1 text-[18px] font-semibold">{t("Recent activity")}</h2></div>
              <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${wallet.inventoryDifferenceMinor === 0 ? "bg-success-surface text-success-text" : "bg-danger-surface text-danger-text"}`}>{t(wallet.inventoryDifferenceMinor === 0 ? "In sync" : "Drift")}</span>
            </div>
            {wallet.activity.length ? <ul>{wallet.activity.map((event) => <ActivityRow key={event.id} event={event} />)}</ul> : <div className="py-10 text-center"><WalletCards aria-hidden className="mx-auto size-7 text-text-muted" /><p className="mt-3 text-[15px] font-semibold">{t("No Cash Events yet")}</p><p className="mt-1 text-[13px] leading-5 text-text-secondary">{t("Connect the simulator and record cash entering the wallet.")}</p></div>}
          </aside>
        </div>
      )}
    </div>
  );
}
