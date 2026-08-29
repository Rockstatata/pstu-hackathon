import Link from "next/link";
import { Bird } from "lucide-react";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-bg px-4 py-5 sm:grid sm:place-items-center sm:p-8">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-10 flex items-center justify-between sm:mb-8">
          <Link href="/" className="flex min-h-11 items-center gap-2 text-[18px] font-semibold text-text">
            <Bird aria-hidden className="size-5 text-primary" strokeWidth={2.25} />
            Chorui
          </Link>
          <ThemeToggle />
        </div>
        
        <section className="card p-5 sm:p-7">{children}</section>
      </div>
    </main>
  );
}
