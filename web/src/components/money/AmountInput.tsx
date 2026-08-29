"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";
import { formatTaka } from "@/lib/money";

interface Props {
  /** Raw typed text, kept as a string so a trailing "." survives keystrokes. */
  value: string;
  onChange: (next: string) => void;
  /** Poisha, parsed from `value` by the caller. null while the input is invalid. */
  minor: number | null;
  balanceMinor: number | null;
  error?: string | null;
  disabled?: boolean;
  label?: string;
  availableLabel?: string;
}

/**
 * Poisha-backed. The client checks the balance for UX only — the backend
 * re-checks it inside the row lock, and its answer is the one that counts
 * (ADR-0001). This input never decides whether a transfer is allowed.
 */
export function AmountInput({
  value,
  onChange,
  minor,
  balanceMinor,
  error,
  disabled,
  label = "Amount",
  availableLabel = "available",
}: Props) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[13px] font-medium text-text-secondary">
        {label}
      </label>

      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border bg-surface px-4 py-4",
          "transition-colors duration-150 focus-within:border-primary",
          error ? "border-danger" : "border-control",
        )}
      >
        <span aria-hidden className="text-[32px] font-bold leading-none text-text-secondary">
          ৳
        </span>
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            "tnum w-full bg-transparent text-[32px] font-bold leading-none text-text outline-none",
            "placeholder:text-text-muted disabled:opacity-55",
          )}
        />
      </div>

      {error ? (
        <p id={errorId} className="text-[13px] font-medium text-danger-text">
          {error}
        </p>
      ) : (
        balanceMinor !== null && (
          <p className="text-[13px] text-text-secondary">
            <span className="tnum">{formatTaka(balanceMinor)}</span> {availableLabel}
          </p>
        )
      )}

      {minor !== null && minor > 0 && !error && (
        <p className="sr-only" aria-live="polite">
          Amount {formatTaka(minor)}
        </p>
      )}
    </div>
  );
}
