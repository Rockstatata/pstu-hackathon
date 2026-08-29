import { Loader2 } from "lucide-react";
import Link from "next/link";
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

export function buttonClassName({
  variant = "primary",
  full = false,
  className,
}: Pick<Props, "variant" | "full" | "className">) {
  return cn(
    "inline-flex h-11 items-center justify-center gap-2 rounded-md px-5 text-[15px] font-semibold",
    "transition-[background-color,color,border-color,transform] duration-150 active:translate-y-px",
    full && "flex w-full",
    VARIANTS[variant],
    className,
  );
}

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
      className={cn(buttonClassName({ variant, full, className }), "disabled:cursor-not-allowed disabled:opacity-55")}
    >
      {loading && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

interface ButtonLinkProps {
  href: string;
  variant?: Variant;
  full?: boolean;
  className?: string;
  children: ReactNode;
}

/** A link styled as a button without nesting interactive elements. */
export function ButtonLink({ href, variant = "primary", full = false, className, children }: ButtonLinkProps) {
  return <Link href={href} className={buttonClassName({ variant, full, className })}>{children}</Link>;
}
