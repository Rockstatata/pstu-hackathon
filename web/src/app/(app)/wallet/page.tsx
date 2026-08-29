"use client";

import { ArrowRight, Copy, CreditCard, Nfc, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { AmountDisplay } from "@/components/money/AmountDisplay";
import { ButtonLink } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { ApiError, api } from "@/lib/api";
import { maskPhone } from "@/lib/money";
import type { AccountSummary, AuthUser } from "@/lib/types";
import { useI18n } from "@/components/i18n/LanguageProvider";

export default function SmartCardPage() {
  const { t } = useI18n();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([api.me(), api.account()])
      .then(([nextUser, nextAccount]) => { if (active) { setUser(nextUser); setAccount(nextAccount); } })
      .catch((cause) => active && setError(cause instanceof ApiError ? cause.sentence : t("We could not load your account card.")));
    return () => { active = false; };
  }, [t]);

  async function copyAccountId() {
    if (!account || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(account.accountId);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return <div className="mx-auto max-w-xl"><header><p className="text-[13px] font-medium text-text-secondary">{t("Your account, carried")}</p><h1 className="mt-1 text-[24px] font-semibold leading-8">{t("Chorui smart card")}</h1><p className="mt-2 text-[15px] leading-6 text-text-secondary">{t("A simple view of the Account that holds your money. Your balance remains determined by the ledger.")}</p></header>{error && <p role="alert" className="mt-6 rounded-md bg-danger-surface px-3 py-2.5 text-[13px] font-medium text-danger-text">{error}</p>}{!user || !account ? <div className="mt-7 space-y-4"><Skeleton className="h-56 w-full" /><Skeleton className="h-28 w-full" /></div> : <><section className="mt-7 overflow-hidden rounded-xl bg-primary p-6 text-primary-fg shadow-[var(--shadow-card)]"><div className="flex items-start justify-between"><div><p className="text-[13px] font-medium text-primary-fg/75">Chorui</p><p className="mt-1 text-[18px] font-semibold">{t("Smart Account Card")}</p></div><Nfc aria-hidden className="size-7 text-primary-fg/85" /></div><div className="mt-12"><p className="text-[12px] font-medium text-primary-fg/75">{t("Available balance")}</p><AmountDisplay minor={account.balanceMinor} size="xl" className="mt-1 text-primary-fg" /></div><div className="mt-9 flex items-end justify-between gap-3"><div><p className="text-[11px] font-medium uppercase tracking-[0.12em] text-primary-fg/70">{t("Account holder")}</p><p className="mt-1 text-[15px] font-semibold">{user.fullName}</p></div><CreditCard aria-hidden className="size-7 text-primary-fg/75" /></div></section><section className="card mt-5 p-5"><div className="flex items-start gap-3"><span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success-surface text-success-text"><ShieldCheck className="size-5" /></span><div><h2 className="text-[16px] font-semibold">{t("Account protected")}</h2><p className="mt-1 text-[13px] leading-5 text-text-secondary">{t("Every completed Transfer is recorded as immutable Journal Entries. This card never stores or decides your balance.")}</p></div></div></section><section className="mt-7 border-t border-divider pt-6"><p className="text-[13px] font-medium text-text-secondary">{t("Account details")}</p><dl className="mt-3 divide-y divide-divider border-y border-divider"><div className="flex items-center justify-between gap-4 py-4"><dt className="text-[13px] text-text-secondary">{t("Registered phone")}</dt><dd className="tnum text-[15px] font-semibold">{maskPhone(user.phone)}</dd></div><div className="flex items-center justify-between gap-4 py-4"><dt className="text-[13px] text-text-secondary">{t("Account reference")}</dt><dd className="flex items-center gap-1.5 text-[13px] font-semibold"><span className="tnum">{account.accountId}</span><button type="button" onClick={() => void copyAccountId()} className="inline-flex size-11 items-center justify-center rounded-md text-primary-text hover:bg-purple-soft" aria-label={t("Copy account reference")}><Copy aria-hidden className="size-4" /></button></dd></div></dl>{copied && <p aria-live="polite" className="mt-2 text-[13px] font-medium text-success-text">{t("Account reference copied.")}</p>}</section><ButtonLink href="/send" full className="mt-7">{t("Send money")} <ArrowRight aria-hidden className="size-4" /></ButtonLink></>}</div>;
}
