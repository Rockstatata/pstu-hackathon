"use client";

import { ArrowLeft, CircleAlert } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ReceiptCard } from "@/components/tx/ReceiptCard";
import { ButtonLink } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { ApiError, api } from "@/lib/api";
import type { Transfer } from "@/lib/types";
import { useI18n } from "@/components/i18n/LanguageProvider";

export default function SendReceiptPage() {
  return <Suspense fallback={<ReceiptLoading />}><ReceiptContent /></Suspense>;
}

function ReceiptContent() {
  const { t } = useI18n();
  const params = useParams<{ reference: string }>();
  const searchParams = useSearchParams();
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const failedReason = params.reference === "failed" ? searchParams.get("reason") ?? t("The transfer could not be completed. No money has moved.") : null;

  useEffect(() => {
    let active = true;
    if (failedReason) return;
    api.transfer(params.reference)
      .then((result) => active && setTransfer(result))
      .catch((cause) => active && setError(cause instanceof ApiError ? cause.sentence : t("We could not load this receipt.")));
    return () => { active = false; };
  }, [failedReason, params.reference, t]);

  return (
    <div className="mx-auto max-w-md">
      
      <Link href="/send" className="mb-3 inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-primary-text hover:underline"><ArrowLeft aria-hidden className="size-4" />{t("Send money")}</Link>
      <h1 className="mb-6 text-[24px] font-semibold leading-8">{t("Transfer receipt")}</h1>
      {transfer ? <><ReceiptCard transfer={transfer} /><ButtonLink href="/" full className="mt-6">{t("Done")}</ButtonLink></> : failedReason ? <FailedReceipt reason={failedReason} /> : error ? <section className="card p-6 text-center"><CircleAlert aria-hidden className="mx-auto size-7 text-danger-text" /><h2 className="mt-3 text-[18px] font-semibold">{t("Receipt unavailable")}</h2><p className="mt-1 text-[15px] leading-6 text-text-secondary">{error}</p><ButtonLink href="/history" className="mt-5">{t("Check history")}</ButtonLink></section> : <ReceiptLoading />}
    </div>
  );
}

function FailedReceipt({ reason }: { reason: string }) {
  const { t } = useI18n();
  return <section className="card p-6 text-center" aria-live="polite"><span className="mx-auto flex size-12 items-center justify-center rounded-full bg-danger-surface text-danger-text"><CircleAlert aria-hidden className="size-6" /></span><p className="mt-4 text-[13px] font-medium text-text-secondary">{t("Transfer status")}</p><h2 className="mt-1 text-[24px] font-semibold leading-8">{t("Transfer failed")}</h2><p className="mt-3 text-[15px] leading-6 text-text-secondary">{t(reason)}</p><p className="mt-3 text-[13px] text-text-secondary">{t("No transaction ID was issued.")}</p><ButtonLink href="/send" full className="mt-6">{t("Try another transfer")}</ButtonLink><Link href="/history" className="mt-3 inline-flex min-h-11 items-center text-[13px] font-semibold text-primary-text hover:underline">{t("Check transaction history")}</Link></section>;
}

function ReceiptLoading() {
  const { t } = useI18n();
  return <div className="card space-y-4 p-5" aria-busy="true" aria-label={t("Loading receipt")}><Skeleton className="mx-auto size-12 rounded-full" /><Skeleton className="mx-auto h-10 w-48" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>;
}
