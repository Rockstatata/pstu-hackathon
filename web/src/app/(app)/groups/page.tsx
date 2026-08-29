"use client";

import { ArrowRight, Plus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ApiError, api } from "@/lib/api";
import type { ExpenseGroupSummary } from "@/lib/types";

export default function ExpenseGroupsPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<ExpenseGroupSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .expenseGroups()
      .then((result) => active && setGroups(result))
      .catch((cause) =>
        active &&
        setError(cause instanceof ApiError ? cause.sentence : "We could not load your Expense Groups."),
      );
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-2xl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-primary-text">Shared expenses, fewer payments</p>
          <h1 className="mt-1 text-[24px] font-semibold leading-8">Smart Group Settlement</h1>
          <p className="mt-2 max-w-xl text-[15px] leading-6 text-text-secondary">
            Record who paid, preserve everyone&apos;s Net Position, and preview a practical settlement before any money moves.
          </p>
        </div>
        <ButtonLink href="/groups/new" className="hidden sm:inline-flex"><Plus aria-hidden className="size-4" />New group</ButtonLink>
      </header>

      {error && <p role="alert" className="mt-5 rounded-md bg-danger-surface px-3 py-2.5 text-[13px] font-medium text-danger-text">{error}</p>}

      {groups === null ? (
        <div className="mt-7 space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : groups.length === 0 ? (
        <div className="card mt-7"><EmptyState icon={Users} title="No Expense Groups yet" detail="Create a dinner, trip, flat, or event group and add the people sharing costs." action={{ label: "Create a group", onClick: () => router.push("/groups/new") }} /></div>
      ) : (
        <ul className="mt-7 divide-y divide-divider border-y border-divider">
          {groups.map((group) => (
            <li key={group.id}>
              <Link href={`/groups/${group.id}`} className="flex min-h-20 items-center gap-4 py-4 transition-colors hover:bg-surface-subtle sm:px-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-purple-soft text-primary-text"><Users aria-hidden className="size-5" /></span>
                <div className="min-w-0 flex-1"><p className="truncate text-[16px] font-semibold">{group.name}</p><p className="mt-1 text-[13px] text-text-secondary">{group.memberCount} members · {group.expenseCount} {group.expenseCount === 1 ? "Expense" : "Expenses"}</p></div>
                <ArrowRight aria-hidden className="size-5 shrink-0 text-text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <ButtonLink href="/groups/new" full className="mt-6 flex sm:hidden"><Plus aria-hidden className="size-4" />New Expense Group</ButtonLink>
    </div>
  );
}
