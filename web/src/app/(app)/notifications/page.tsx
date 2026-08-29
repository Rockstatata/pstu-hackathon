"use client";

import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { FixtureNotice } from "@/components/ui/FixtureNotice";
import { Skeleton } from "@/components/ui/Skeleton";
import { ApiError, api } from "@/lib/api";
import type { Notification } from "@/lib/types";

function notificationTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.notifications().then((result) => active && setItems(result.items)).catch((cause) => active && setError(cause instanceof ApiError ? cause.sentence : "We could not load your notifications."));
    return () => { active = false; };
  }, []);

  async function markRead(id: string) {
    try {
      await api.markNotificationRead(id);
      setItems((current) => current?.map((item) => item.id === id ? { ...item, readAt: new Date().toISOString() } : item) ?? null);
    } catch {
      setError("We could not mark that notification as read.");
    }
  }

  return <div className="mx-auto max-w-2xl"><FixtureNotice /><header className="mb-6"><p className="text-[13px] font-medium text-text-secondary">Updates that need your attention</p><h1 className="mt-1 text-[24px] font-semibold leading-8">Notifications</h1></header>{error && <p role="alert" className="mb-5 rounded-md bg-danger-surface px-3 py-2.5 text-[13px] font-medium text-danger-text">{error}</p>}{items === null ? <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div> : items.length === 0 ? <EmptyState icon={Bell} title="No notifications yet" detail="Money updates and request responses will appear here." /> : <section className="divide-y divide-divider border-y border-divider">{items.map((item) => <article key={item.id} className={`flex gap-3 py-4 ${item.readAt ? "" : "bg-purple-soft/35 -mx-3 px-3"}`}><span aria-hidden className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-primary-text"><Bell className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><p className="text-[15px] font-semibold text-text">{item.title}</p>{!item.readAt && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}</div><p className="mt-1 text-[13px] leading-5 text-text-secondary">{item.detail}</p><p className="mt-2 text-[12px] text-text-muted">{notificationTime(item.createdAt)}</p><div className="mt-3 flex gap-3">{item.href && <Link href={item.href} onClick={() => void markRead(item.id)} className="inline-flex min-h-11 items-center text-[13px] font-semibold text-primary-text hover:underline">View details</Link>}{!item.readAt && <Button variant="ghost" className="px-0" onClick={() => void markRead(item.id)}><CheckCheck aria-hidden className="size-4" />Mark read</Button>}</div></div></article>)}</section>}</div>;
}
