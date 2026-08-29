"use client";

import { cn } from "@/lib/cn";
import { useI18n } from "@/components/i18n/LanguageProvider";

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("block animate-pulse rounded-md bg-surface-subtle", className)} />;
}

export function TransactionListSkeleton() {
  const { t } = useI18n();
  return (
    <div className="space-y-1" aria-label={t("Loading transactions")} aria-busy="true">
      {Array.from({ length: 5 }).map((_, index) => (
        <div className="flex items-center gap-3 px-3 py-3" key={index}>
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-16" /></div>
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}
