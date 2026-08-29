"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bird, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { shippedTabs } from "@/lib/nav";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { LanguageToggle } from "@/components/i18n/LanguageToggle";
import { useI18n } from "@/components/i18n/LanguageProvider";

function isCurrent(pathname: string, href: string) {
  return href === "/" ? pathname === href : pathname.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const tabs = shippedTabs();
  const { t } = useI18n();

  return (
    <div className="min-h-dvh bg-bg text-text lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden border-r border-divider bg-sidebar px-4 py-6 lg:flex lg:flex-col">
        <Link href="/" className="mb-10 flex min-h-11 items-center gap-2 px-2 text-[18px] font-semibold text-text">
          <Bird aria-hidden className="size-5 text-primary" strokeWidth={2.25} />
          Chorui
        </Link>
        <nav aria-label={t("Main navigation")} className="space-y-1">
          {tabs.map(({ href, label, icon: Icon }) => {
            const current = isCurrent(pathname, href);
            return (
              <Link
                href={href}
                key={href}
                aria-current={current ? "page" : undefined}
                className={`relative flex min-h-11 items-center gap-3 rounded-md px-3 text-[15px] font-medium transition-colors ${current ? "bg-purple-soft text-primary-text" : "text-text-secondary hover:bg-surface-subtle hover:text-text"}`}
              >
                {current && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-primary" />}
                <Icon aria-hidden className="size-5" />
                {t(label)}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex items-center gap-1 border-t border-divider pt-4"><LanguageToggle /><ThemeToggle /></div>
      </aside>

      <div className="min-w-0 pb-[calc(56px+env(safe-area-inset-bottom))] lg:pb-0">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-divider bg-bg px-4 lg:px-8">
          <Link href="/" className="flex min-h-11 items-center gap-2 text-[18px] font-semibold lg:hidden">
            <Bird aria-hidden className="size-5 text-primary" strokeWidth={2.25} />
            Chorui
          </Link>
          <span className="hidden text-[13px] font-medium text-text-secondary lg:block">{t("Move money with care.")}</span>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <LanguageToggle className="lg:hidden" />
            <Link href="/settings" className="inline-flex size-11 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-subtle hover:text-text" aria-label={t("Profile and settings")}>
              <Settings aria-hidden className="size-5" />
            </Link>
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>

      <nav aria-label={t("Main navigation")} className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex h-[calc(56px+env(safe-area-inset-bottom))] border-t border-divider bg-sidebar lg:hidden">
        {tabs.map(({ href, label, icon: Icon }) => {
          const current = isCurrent(pathname, href);
          return (
            <Link
              href={href}
              key={href}
              aria-current={current ? "page" : undefined}
              className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${current ? "text-primary-text" : "text-text-secondary"}`}
            >
              {current && <span aria-hidden className="absolute inset-x-4 top-0 h-[3px] rounded-b bg-primary" />}
              <Icon aria-hidden className="size-5" />
              {t(label)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
