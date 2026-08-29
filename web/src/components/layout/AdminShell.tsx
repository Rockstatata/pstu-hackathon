"use client";

import { ArrowLeft, Gauge, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LanguageToggle } from "@/components/i18n/LanguageToggle";
import { useI18n } from "@/components/i18n/LanguageProvider";

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === "/admin";
  const { t } = useI18n();

  return <div className="admin-experience min-h-dvh bg-bg text-text lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]"><aside className="hidden border-r border-divider bg-sidebar px-5 py-6 lg:flex lg:flex-col"><Link href="/admin" className="flex min-h-11 items-center gap-3 px-2 text-[18px] font-semibold text-text"><span className="flex size-8 items-center justify-center rounded-md bg-purple-soft text-primary-text"><ShieldCheck aria-hidden className="size-5" /></span>Chorui Ops</Link><p className="mt-2 px-2 text-[12px] leading-5 text-text-secondary">{t("Live integrity console")}</p><nav aria-label={t("Admin navigation")} className="mt-10 space-y-1"><Link href="/admin" aria-current={active ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-[15px] font-medium ${active ? "bg-purple-soft text-primary-text" : "text-text-secondary hover:bg-surface-subtle"}`}><Gauge aria-hidden className="size-5" />{t("System overview")}</Link></nav><div className="mt-auto border-t border-divider pt-4"><LanguageToggle /></div><Link href="/" className="flex min-h-11 items-center gap-2 px-2 pt-3 text-[13px] font-semibold text-text-secondary hover:text-text"><ArrowLeft aria-hidden className="size-4" />{t("Open user app")}</Link></aside><div className="min-w-0"><header className="flex h-16 items-center justify-between border-b border-divider bg-bg px-4 sm:px-6 lg:px-8"><Link href="/admin" className="flex min-h-11 items-center gap-2 text-[16px] font-semibold lg:hidden"><ShieldCheck aria-hidden className="size-5 text-primary-text" />Chorui Ops</Link><p className="hidden text-[13px] text-text-secondary lg:block">{t("Read-only operational view")}</p><div className="flex items-center gap-2"><LanguageToggle className="lg:hidden" /><span className="rounded-full bg-success-surface px-2.5 py-1 text-[12px] font-semibold text-success-text">{t("Live from the ledger")}</span></div></header><main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main></div></div>;
}
