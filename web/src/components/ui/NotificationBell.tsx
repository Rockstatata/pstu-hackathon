"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      api.notifications(true)
        .then((result) => active && setUnreadCount(result.unreadCount))
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <Link
      href="/notifications"
      className="relative inline-flex size-11 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-subtle hover:text-text"
      aria-label={unreadCount ? `${unreadCount} unread notifications` : "Notifications"}
    >
      <Bell aria-hidden className="size-5" />
      {unreadCount > 0 && (
        <span className="absolute right-1.5 top-1.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-4 text-primary-fg">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );
}
