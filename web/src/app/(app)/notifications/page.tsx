"use client";

import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { ApiError, api } from "@/lib/api";
import type { Notification } from "@/lib/types";
import { useOnlineStatus } from "@/lib/use-online-status";

function requestHref(item: Notification) {
  return item.resourceType === "money_request" && item.resourceId
    ? `/requests/${item.resourceId}`
    : null;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const online = useOnlineStatus();

  useEffect(() => {
    let active = true;
    api.notifications()
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setUnreadCount(result.unreadCount);
      })
      .catch((cause) => active && setError(
        cause instanceof ApiError ? cause.sentence : "We could not load notifications.",
      ));
    return () => { active = false; };
  }, []);

  async function markAllRead() {
    setMarkingAll(true);
    setError(null);
    try {
      const result = await api.markAllNotificationsRead();
      setItems(result.items);
      setUnreadCount(result.unreadCount);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.sentence : "We could not update notifications.");
    } finally {
      setMarkingAll(false);
    }
  }

  async function markRead(item: Notification) {
    if (item.readAt) return;
    try {
      const result = await api.markNotificationRead(item.id);
      setItems(result.items);
      setUnreadCount(result.unreadCount);
    } catch {
      // The destination remains usable; the next refresh can retry the read state.
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      {!online && <OfflineBanner />}
      <header className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-text-secondary">Activity that needs your attention</p>
          <h1 className="mt-1 text-[24px] font-semibold leading-8">Notifications</h1>
        </div>
        {unreadCount > 0 && (
          <Button variant="ghost" loading={markingAll} onClick={markAllRead}>
            <CheckCheck aria-hidden className="size-4" /> Mark all read
          </Button>
        )}
      </header>

      {error && <p role="alert" className="mb-4 rounded-md bg-danger-surface px-3 py-2.5 text-[13px] font-medium text-danger-text">{error}</p>}

      {items === null ? (
        <div className="space-y-3" aria-label="Loading notifications">
          {[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-lg bg-surface-subtle" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Bell} title="Nothing new" detail="Transfers and requests that concern you will appear here." />
      ) : (
        <ul className="divide-y divide-divider overflow-hidden rounded-lg border border-divider bg-surface">
          {items.map((item) => {
            const href = requestHref(item);
            const content = (
              <div className="flex min-h-24 gap-3 px-4 py-4 sm:px-5">
                <span aria-hidden className={`mt-1 size-2 shrink-0 rounded-full ${item.readAt ? "bg-control" : "bg-primary"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-[15px] font-semibold text-text">{item.title}</h2>
                    <time className="shrink-0 text-[12px] text-text-tertiary" dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleDateString("en-BD", { month: "short", day: "numeric" })}
                    </time>
                  </div>
                  <p className="mt-1 text-[14px] leading-5 text-text-secondary">{item.message}</p>
                </div>
              </div>
            );
            return (
              <li key={item.id}>
                {href ? (
                  <Link href={href} onClick={() => void markRead(item)} className="block transition-colors hover:bg-surface-subtle">
                    {content}
                  </Link>
                ) : (
                  <button type="button" onClick={() => void markRead(item)} className="block w-full text-left transition-colors hover:bg-surface-subtle">
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
