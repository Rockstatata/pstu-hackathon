import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  full?: boolean;
  children: ReactNode;
}

/**
 * Every variant is at least 44px tall (docs/frontend-screens.md touch rule).
 * `danger` is a tinted surface rather than a filled red, because white on
 * #EF4444 does not clear AA in dark mode — see the measured corrections table.
 */
const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg hover:bg-primary-hover",
  secondary: "bg-surface text-text border border-control hover:bg-surface-subtle",
  ghost: "text-primary-text hover:bg-purple-soft",
  danger: "bg-danger-surface text-danger-text border border-danger",
};

export function Button({
  variant = "primary",
  loading = false,
  full = false,
  className,
  children,
  disabled,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-md px-5 text-[15px] font-semibold",
        "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-55",
        full && "w-full",
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  );
}
