import { TransactionListItem } from "@/components/tx/TransactionListItem";
import type { Transfer } from "@/lib/types";

export function TransactionList({ transfers }: { transfers: Transfer[] }) {
  const grouped = transfers.reduce<Record<string, Transfer[]>>((groups, transfer) => {
    const key = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date(transfer.createdAt));
    (groups[key] ??= []).push(transfer);
    return groups;
  }, {});

  return (
    <div className="divide-y divide-divider">
      {Object.entries(grouped).map(([date, items]) => (
        <section key={date} className="py-3 first:pt-0">
          <h2 className="sticky top-16 z-10 -mx-1 mb-1 bg-bg/95 px-1 py-2 text-[13px] font-medium text-text-secondary backdrop-blur">{date}</h2>
          <div>{items.map((transfer) => <TransactionListItem key={transfer.reference} transfer={transfer} />)}</div>
        </section>
      ))}
    </div>
  );
}
