"use client";

import { useEffect, useId, useRef } from "react";
import { cn } from "@/lib/cn";

interface Props {
  value: string;
  onChange: (next: string) => void;
  label: string;
  error?: string | null;
  autoFocus?: boolean;
  length?: number;
}

/**
 * Five masked boxes with auto-advance. On error the boxes shake — but under
 * prefers-reduced-motion the animation is suppressed globally and the border
 * colour still changes, so the error is never conveyed by motion alone.
 */
export function PinInput({ value, onChange, label, error, autoFocus, length = 5 }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const id = useId();
  const errorId = `${id}-error`;

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[13px] font-medium text-text-secondary">
        {label}
      </label>

      <div className="relative">
        {/* One real input behind the boxes: native keyboard, paste, and
            autofill all keep working, unlike a row of separate inputs. */}
        <input
          ref={ref}
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, length))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={length}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="absolute inset-0 z-10 h-full w-full opacity-0"
        />
        <div aria-hidden className={cn("flex gap-2", error && "animate-[shake_150ms_ease-in-out_2]")}>
          {Array.from({ length }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "flex h-14 flex-1 items-center justify-center rounded-md border bg-surface text-[22px] font-bold text-text",
                error ? "border-danger" : value.length === i ? "border-primary" : "border-control",
              )}
            >
              {value[i] ? "•" : ""}
            </span>
          ))}
        </div>
      </div>

      {error && (
        <p id={errorId} className="text-[13px] font-medium text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}
