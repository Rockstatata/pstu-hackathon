import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface Props {
  icon: LucideIcon;
  title: string;
  detail: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon: Icon, title, detail, action }: Props) {
  return (
    <section className="flex min-h-56 flex-col items-center justify-center px-5 py-10 text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-purple-soft text-primary-text">
        <Icon aria-hidden className="size-6" />
      </span>
      <h2 className="text-[18px] font-semibold">{title}</h2>
      <p className="mt-1 max-w-xs text-[15px] leading-6 text-text-secondary">{detail}</p>
      {action && <Button className="mt-5" onClick={action.onClick}>{action.label}</Button>}
    </section>
  );
}
