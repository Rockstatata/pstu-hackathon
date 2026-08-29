"use client";

import { TransactionListItem } from "@/components/tx/TransactionListItem";
import { useI18n } from "@/components/i18n/LanguageProvider";
import type { Transfer } from "@/lib/types";

export function TransactionList({ transfers }: { transfers: Transfer[] }) {
  const { formatDate } = useI18n();
  const grouped = transfers.reduce<Record<string, Transfer[]>>((groups, transfer) => {
    const key = formatDate(transfer.createdAt, { weekday: "long", day: "numeric", month: "long" });
    (groups[key] ??= []).push(transfer);
    return groups;
  }, {});

  return (
    <div className="divide-y divide-divider">
      {Object.entries(grouped).map(([date, items]) => (
        <section key={date}>
          <h2 className="border-b border-divider bg-surface-subtle px-5 py-2.5 text-[13px] font-semibold text-text-secondary">{date}</h2>
          <div>{items.map((transfer) => <TransactionListItem key={transfer.reference} transfer={transfer} />)}</div>
        </section>
      ))}
    </div>
  );
}
