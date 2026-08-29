import Link from "next/link";
import { Bell } from "lucide-react";

export function NotificationBell({ unread }: { unread: number }) {
  return <Link href="/notifications" className="relative inline-flex size-11 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-subtle hover:text-text" aria-label={unread ? `${unread} unread notifications` : "Notifications"}><Bell aria-hidden className="size-5" />{unread > 0 && <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-4 text-primary-fg">{unread > 9 ? "9+" : unread}</span>}</Link>;
}
