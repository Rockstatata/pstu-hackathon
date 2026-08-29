"use client";

import { Eye, EyeOff, Wallet } from "lucide-react";
import { useState } from "react";
import { formatTaka } from "@/lib/money";

interface Props {
  balanceMinor: number | null;
  asOf?: string | null;
  offline?: boolean;
}

/**
 * The only gradient surface in the application. White text sits on the dark
 * half of the gradient (#5B21B6 -> #7C3AED, both >= 5.7 against white); the
 * light third stop appears only as the decorative corner glow, with nothing
 * written over it, because white on #8B5CF6 measures 4.23.
 *
 * No aria-live here: once Phase 11 polls this value every 10s, a live region
 * would re-announce the balance on every tick and make the app unusable with a
 * screen reader.
 */
export function BalanceCard({ balanceMinor, asOf, offline = false }: Props) {
  const [hidden, setHidden] = useState(false);

  return (
    <section
      className={`balance-gradient relative overflow-hidden rounded-lg p-5 ${offline ? "opacity-60" : ""}`}
      aria-label="Available balance"
    >
      {/* decorative only — never place text over this */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 size-44 rounded-full opacity-40 blur-2xl"
        style={{ backgroundColor: "var(--gradient-glow)" }}
      />
      <Wallet
        aria-hidden
        className="pointer-events-none absolute -bottom-6 -right-4 size-36 text-white/10"
      />

      <div className="relative flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-white/80">Available balance</p>
        <button
          type="button"
          onClick={() => setHidden((h) => !h)}
          aria-pressed={hidden}
          className="-m-2 inline-flex size-11 items-center justify-center rounded-md text-white/90 hover:bg-white/10"
        >
          {hidden ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          <span className="sr-only">{hidden ? "Show balance" : "Hide balance"}</span>
        </button>
      </div>

      <p className="relative mt-1 tnum text-[40px] font-bold leading-11 text-white">
        {balanceMinor === null ? (
          <span className="inline-block h-10 w-48 animate-pulse rounded bg-white/20" />
        ) : hidden ? (
          "৳ ••••••"
        ) : (
          formatTaka(balanceMinor)
        )}
      </p>

      {offline && asOf && (
        <p className="relative mt-2 text-[12px] text-white/75">
          Last updated {new Date(asOf).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
    </section>
  );
}
