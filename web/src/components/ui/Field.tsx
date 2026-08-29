"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "prefix"> {
  label: string;
  error?: string | null;
  hint?: string;
  prefix?: ReactNode;
}

/**
 * Label is always real (never a placeholder standing in for one) and error text
 * is linked by aria-describedby, so a screen reader hears the problem when it
 * lands on the field rather than only seeing red.
 */
export function Field({ label, error, hint, prefix, className, ...rest }: Props) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-text-secondary">
        {label}
      </label>

      <div
        className={cn(
          "flex h-12 items-center gap-2 rounded-md border bg-surface px-3",
          "transition-colors duration-150 focus-within:border-primary",
          error ? "border-danger" : "border-control",
        )}
      >
        {prefix && <span className="shrink-0 text-text-secondary">{prefix}</span>}
        <input
          {...rest}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(
            "h-full w-full bg-transparent text-[15px] text-text outline-none",
            "placeholder:text-text-muted",
            className,
          )}
        />
      </div>

      {hint && !error && (
        <p id={hintId} className="text-[12px] text-text-secondary">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-[13px] font-medium text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}
