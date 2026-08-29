"use client";

import {
  Activity,
  Check,
  CircleAlert,
  Database,
  Gauge,
  HeartPulse,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AmountDisplay } from "@/components/money/AmountDisplay";
import { Skeleton } from "@/components/ui/Skeleton";
import { ApiError, api } from "@/lib/api";
import type { IntegrityReport, SystemInfo } from "@/lib/types";

/**
 * The judge-facing screen. Every number on it is read live from
 * `GET /integrity` and `GET /system-info` on each refresh — nothing here is
 * cached, seeded, or computed in the browser. If the backend is unreachable
 * this page says so; it never falls back to a plausible-looking figure.
 */
const REFRESH_MS = 5000;

export default function AdminDashboardPage() {
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const read = () => {
      Promise.all([api.integrity(), api.systemInfo()])
        .then(([report, info]) => {
          if (!active) return;
          setIntegrity(report);
          setSystem(info);
          setRefreshedAt(new Date().toISOString());
          setError(null);
        })
        .catch((cause: unknown) => {
          if (!active) return;
          setError(
            cause instanceof ApiError
              ? cause.sentence
              : "The financial core could not be reached, so no verdict can be shown.",
          );
        });
    };

    read();
    const timer = setInterval(read, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  if (!integrity || !system) {
    return error ? <Unreachable detail={error} /> : <DashboardSkeleton />;
  }

  const healthy = integrity.verdict === "HEALTHY";

  return (
    <div>
      <header className="mb-8">
        <div className="flex items-center gap-2 text-primary-text">
          <ShieldCheck aria-hidden className="size-5" />
          <p className="text-[13px] font-semibold">Ledger integrity · read-only · computed live</p>
        </div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[clamp(1.75rem,4vw,2.5rem)] font-semibold leading-none">
              Operations overview
            </h1>
            <p className="mt-3 max-w-2xl text-[15px] leading-6 text-text-secondary">
              Five assertions recomputed from the database on every refresh. Move money in another
              window and watch these figures change.
            </p>
          </div>
          <p className="flex items-center gap-2 rounded-md border border-divider bg-surface px-3 py-2 text-[12px] font-medium text-text-secondary">
            <RefreshCw aria-hidden className="size-3.5" />
            {refreshedAt
              ? `Refreshed ${new Date(refreshedAt).toLocaleTimeString("en-GB")} · served by ${integrity.instance}`
              : "Refreshing"}
          </p>
        </div>
      </header>

      {error && (
        <p role="alert" className="mb-6 rounded-md bg-warning-surface px-3 py-2.5 text-[13px] font-medium text-warning-text">
          {error} The figures below are from the last successful read.
        </p>
      )}

      <section
        className={`card flex flex-wrap items-center justify-between gap-4 p-6 ${healthy ? "bg-success-surface" : "bg-danger-surface"}`}
        aria-live="polite"
      >
        <div className="flex items-center gap-4">
          <span
            className={`flex size-12 shrink-0 items-center justify-center rounded-full ${healthy ? "bg-success text-white" : "bg-danger text-white"}`}
          >
            {healthy ? <Check aria-hidden className="size-6" /> : <X aria-hidden className="size-6" />}
          </span>
          <div>
            <p className={`text-[13px] font-semibold ${healthy ? "text-success-text" : "text-danger-text"}`}>
              Verdict
            </p>
            <p className="text-[clamp(1.75rem,4vw,2.75rem)] font-bold leading-none">
              {integrity.verdict}
            </p>
          </div>
        </div>
        <dl className="flex flex-wrap gap-x-10 gap-y-3">
          <Total label="Issued" minor={integrity.totals.issuedPoisha} />
          <Total label="Held by users" minor={integrity.totals.heldPoisha} />
          <Total label="Difference" minor={integrity.totals.differencePoisha} />
        </dl>
      </section>

      <section className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,.8fr)]">
        <article className="card p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <Database aria-hidden className="size-5 text-primary-text" />
            <h2 className="text-[18px] font-semibold">Ledger assertions</h2>
          </div>
          <p className="mt-2 text-[13px] leading-5 text-text-secondary">
            Each assertion counts the rows that break it, so zero is the only passing answer.
          </p>
          <div className="mt-5 divide-y divide-divider border-y border-divider">
            {integrity.assertions.map((assertion) => (
              <div key={assertion.key} className="flex items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold">{assertion.label}</p>
                  <p className="mt-1 tnum text-[13px] text-text-secondary">
                    {assertion.value} · {assertion.key}
                  </p>
                </div>
                <span
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full ${assertion.pass ? "bg-success-surface text-success-text" : "bg-danger-surface text-danger-text"}`}
                >
                  {assertion.pass ? (
                    <Check aria-label="Passed" className="size-4" />
                  ) : (
                    <X aria-label="Failed" className="size-4" />
                  )}
                </span>
              </div>
            ))}
          </div>
        </article>

        <article className="card p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <HeartPulse aria-hidden className="size-5 text-success-text" />
            <h2 className="text-[18px] font-semibold">Replica health</h2>
          </div>
          <p className="mt-3 text-[13px] leading-5 text-text-secondary">
            A replica counts as healthy while its heartbeat is newer than{" "}
            {system.freshnessWindowSeconds}s.
          </p>
          <p className="mt-6 tnum text-[clamp(2.5rem,5vw,3.5rem)] font-bold leading-none">
            {system.healthyReplicas}/{system.expectedReplicas}
          </p>
          <p
            className={`mt-1 text-[13px] font-medium ${system.health === "HEALTHY" ? "text-success-text" : "text-warning-text"}`}
          >
            {system.health === "HEALTHY" ? "All API replicas serving" : "Serving with fewer replicas"}
          </p>
          <div className="mt-6 space-y-3 border-t border-divider pt-5">
            {system.replicas.map((replica) => (
              <div key={replica.instance} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="flex min-w-0 items-center gap-2 font-medium">
                  <span
                    aria-hidden
                    className={`size-2.5 shrink-0 rounded-full ${replica.healthy ? "bg-success" : "bg-danger"}`}
                  />
                  <span className="tnum truncate">{replica.instance}</span>
                </span>
                <span className={replica.healthy ? "text-success-text" : "text-danger-text"}>
                  {new Date(replica.lastSeen).toLocaleTimeString("en-GB")}
                </span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Transfers completed" value={integrity.counters.completedTransfers} icon={Activity} />
        <Metric
          label="Duplicate requests replayed"
          value={integrity.counters.idempotentReplays}
          icon={Check}
          tone="success"
        />
        <Metric
          label="Overspends rejected"
          value={integrity.counters.rejectedOverspends}
          icon={CircleAlert}
          tone="warning"
        />
        <Metric label="Step-ups demanded" value={integrity.counters.stepUpsTriggered} icon={ShieldCheck} />
        <Metric label="Policy rejections" value={integrity.counters.policyRejections} icon={CircleAlert} tone="warning" />
        <Metric label="Registered users" value={integrity.counters.registeredUsers} icon={Activity} />
        <Metric label="Journal entries" value={integrity.counters.journalEntries} icon={Database} />
        <Metric label="Assertions passing" value={integrity.assertions.filter((a) => a.pass).length} icon={Check} tone="success" />
      </section>

      <section className="mt-8">
        <article className="card p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <Gauge aria-hidden className="size-5 text-primary-text" />
            <h2 className="text-[18px] font-semibold">Enforced limits</h2>
          </div>
          <p className="mt-2 text-[13px] leading-5 text-text-secondary">
            Read from the running API, not from this page. Every one of them is checked inside the
            transaction that moves the money.
          </p>
          <dl className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <Limit label="Per transfer" minor={system.policy.maxTransferPoisha} />
            <Limit label="Per day" minor={system.policy.maxDailySendPoisha} />
            <Limit label="Step-up above" minor={system.policy.stepUpAmountPoisha} />
            <Plain
              label="Velocity step-up"
              value={`${system.policy.stepUpVelocityCount} in ${system.policy.stepUpVelocityMinutes} min`}
            />
            <Plain label="Group recipients" value={`${system.policy.maxGroupRecipients} max`} />
            <Plain label="Row lock timeout" value={`${system.policy.lockTimeoutMs} ms`} />
          </dl>
        </article>
      </section>
    </div>
  );
}

function Total({ label, minor }: { label: string; minor: number }) {
  return (
    <div>
      <dt className="text-[12px] font-medium text-text-secondary">{label}</dt>
      <dd className="mt-1">
        <AmountDisplay minor={minor} size="md" />
      </dd>
    </div>
  );
}

function Limit({ label, minor }: { label: string; minor: number }) {
  return (
    <div>
      <dt className="text-[13px] font-medium text-text-secondary">{label}</dt>
      <dd className="mt-1">
        <AmountDisplay minor={minor} size="md" />
      </dd>
    </div>
  );
}

function Plain({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[13px] font-medium text-text-secondary">{label}</dt>
      <dd className="tnum mt-1 text-[18px] font-semibold">{value}</dd>
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number;
  icon: typeof Activity;
  tone?: "default" | "success" | "warning";
}) {
  const iconClass =
    tone === "success"
      ? "bg-success-surface text-success-text"
      : tone === "warning"
        ? "bg-warning-surface text-warning-text"
        : "bg-purple-soft text-primary-text";

  return (
    <article className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-text-secondary">{label}</p>
        <span className={`flex size-9 items-center justify-center rounded-md ${iconClass}`}>
          <Icon aria-hidden className="size-4" />
        </span>
      </div>
      <p className="mt-6 tnum text-[clamp(2rem,4vw,3rem)] font-bold leading-none">
        {value.toLocaleString("en-US")}
      </p>
    </article>
  );
}

function Unreachable({ detail }: { detail: string }) {
  return (
    <section className="card mx-auto max-w-lg p-8 text-center" role="alert">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-danger-surface text-danger-text">
        <CircleAlert aria-hidden className="size-6" />
      </span>
      <h1 className="mt-4 text-[24px] font-semibold leading-8">No verdict available</h1>
      <p className="mt-3 text-[15px] leading-6 text-text-secondary">{detail}</p>
      <p className="mt-3 text-[13px] text-text-secondary">
        This screen shows nothing rather than showing a number it cannot prove.
      </p>
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading operations view">
      <Skeleton className="h-28 w-full" />
      <Skeleton className="mt-8 h-32 w-full" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-36" />
        ))}
      </div>
    </div>
  );
}
