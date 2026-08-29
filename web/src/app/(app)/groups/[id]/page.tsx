"use client";

import { ArrowLeft, Check, ChevronDown, Plus, ReceiptText, Scale, Users } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AmountDisplay } from "@/components/money/AmountDisplay";
import { AmountInput } from "@/components/money/AmountInput";
import { ConfirmationSheet } from "@/components/send/ConfirmationSheet";
import { StepUpDialog } from "@/components/send/StepUpDialog";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { Skeleton } from "@/components/ui/Skeleton";
import { ApiError, api, newIdempotencyKey } from "@/lib/api";
import { parseTakaToPoisha } from "@/lib/money";
import type { ExpenseGroup, RecipientPreview, SettlementPlan } from "@/lib/types";
import { useI18n } from "@/components/i18n/LanguageProvider";
import { useOnlineStatus } from "@/lib/use-online-status";

type SplitType = "EQUAL" | "EXACT" | "PERCENTAGE";

function parsePercentageBps(value: string): number | null {
  const cleaned = value.trim();
  if (!/^\d{1,3}(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, decimal = ""] = cleaned.split(".");
  const bps = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(bps) ? bps : null;
}

function moment(value: string): string {
  return new Intl.DateTimeFormat("en-BD", { dateStyle: "medium" }).format(new Date(value));
}

export default function ExpenseGroupDetailPage() {
  const { t, formatNumber } = useI18n();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const online = useOnlineStatus();
  const [group, setGroup] = useState<ExpenseGroup | null>(null);
  const [plan, setPlan] = useState<SettlementPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showExpense, setShowExpense] = useState(false);
  const [description, setDescription] = useState("");
  const [total, setTotal] = useState("");
  const [payerId, setPayerId] = useState("");
  const [splitType, setSplitType] = useState<SplitType>("EQUAL");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [exactValues, setExactValues] = useState<Record<string, string>>({});
  const [percentageValues, setPercentageValues] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState(false);
  const [stepUpReason, setStepUpReason] = useState<string | null>(null);
  const [settlementIntent, setSettlementIntent] = useState<{ version: string; key: string } | null>(null);

  const load = useCallback(async () => {
    const [nextGroup, nextPlan] = await Promise.all([
      api.expenseGroup(params.id),
      api.settlementPlan(params.id),
    ]);
    setGroup(nextGroup);
    setPlan(nextPlan);
    setSettlementIntent((current) =>
      current?.version === nextPlan.version
        ? current
        : { version: nextPlan.version, key: newIdempotencyKey() },
    );
    setPayerId((current) => current || nextGroup.members.find((member) => member.isCurrentUser)?.id || nextGroup.members[0]?.id || "");
    setSelectedIds((current) => current.length ? current : nextGroup.members.map((member) => member.id));
  }, [params.id]);

  useEffect(() => {
    let active = true;
    Promise.all([api.expenseGroup(params.id), api.settlementPlan(params.id)])
      .then(([nextGroup, nextPlan]) => {
        if (!active) return;
        setGroup(nextGroup);
        setPlan(nextPlan);
        setSettlementIntent({ version: nextPlan.version, key: newIdempotencyKey() });
        setPayerId(nextGroup.members.find((member) => member.isCurrentUser)?.id || nextGroup.members[0]?.id || "");
        setSelectedIds(nextGroup.members.map((member) => member.id));
      })
      .catch((cause) => active && setError(cause instanceof ApiError ? cause.sentence : t("We could not load this Expense Group.")))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [params.id, t]);

  const totalMinor = useMemo(() => parseTakaToPoisha(total), [total]);
  const splitError = useMemo(() => {
    if (!total) return null;
    if (totalMinor === null || totalMinor <= 0) return t("Enter an Expense amount greater than zero.");
    if (selectedIds.length === 0) return "Choose at least one participant.";
    if (splitType === "EXACT") {
      const values = selectedIds.map((id) => parseTakaToPoisha(exactValues[id] ?? ""));
      if (values.some((value) => value === null || value <= 0)) return "Enter every member's exact share.";
      if (values.reduce<number>((sum, value) => sum + (value ?? 0), 0) !== totalMinor) return t("Exact Shares must add up to the full Expense amount.");
    }
    if (splitType === "PERCENTAGE") {
      const values = selectedIds.map((id) => parsePercentageBps(percentageValues[id] ?? ""));
      if (values.some((value) => value === null || value <= 0)) return "Enter every member's percentage.";
      if (values.reduce<number>((sum, value) => sum + (value ?? 0), 0) !== 10_000) return "Percentages must add up to 100%.";
    }
    return null;
  }, [exactValues, percentageValues, selectedIds, splitType, t, total, totalMinor]);

  const myTransfers = useMemo(
    () => plan?.transfers.filter((item) => item.isCurrentUserPayer) ?? [],
    [plan],
  );
  const settlementRecipients = useMemo<RecipientPreview[]>(
    () => myTransfers.map((item) => ({ phone: item.to.id, fullName: item.to.name, maskedPhone: item.to.maskedPhone })),
    [myTransfers],
  );

  function toggleMember(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function addExpense() {
    if (!group || totalMinor === null || totalMinor <= 0 || splitError || !description.trim()) return;
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      await api.createGroupExpense(
        group.id,
        {
          description: description.trim(),
          paidByUserId: payerId,
          totalMinor,
          splitType,
          ...(splitType === "EQUAL" ? { participantUserIds: selectedIds } : {}),
          ...(splitType === "EXACT" ? { exactShares: selectedIds.map((id) => ({ userId: id, amountMinor: parseTakaToPoisha(exactValues[id] ?? "") ?? 0 })) } : {}),
          ...(splitType === "PERCENTAGE" ? { percentageShares: selectedIds.map((id) => ({ userId: id, percentageBps: parsePercentageBps(percentageValues[id] ?? "") ?? 0 })) } : {}),
        },
        newIdempotencyKey(),
      );
      await load();
      setDescription("");
      setTotal("");
      setExactValues({});
      setPercentageValues({});
      setShowExpense(false);
      setNotice(t("Expense recorded. No digital money moved."));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.sentence : t("The Expense could not be recorded."));
    } finally {
      setWorking(false);
    }
  }

  async function settle(pin?: string) {
    if (!group || !plan || !settlementIntent || !online) return;
    setWorking(true);
    setError(null);
    try {
      const receipt = await api.settleExpenseGroup(group.id, plan.version, settlementIntent.key, pin);
      router.push(`/send/receipt/${receipt.reference}`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "STEP_UP_REQUIRED") {
        setStepUpReason(cause.stepUpReason ?? cause.sentence);
        return;
      }
      if (cause instanceof ApiError && cause.code === "STEP_UP_FAILED") throw cause;
      if (cause instanceof ApiError && cause.code === "SETTLEMENT_PLAN_CHANGED") {
        await load();
        setReviewing(false);
      }
      setError(cause instanceof ApiError ? cause.sentence : "Your Group Settlement could not be completed. No money has moved.");
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <div className="mx-auto max-w-5xl"><Skeleton className="h-10 w-56" /><div className="mt-7 grid gap-6 lg:grid-cols-2"><Skeleton className="h-80 w-full" /><Skeleton className="h-80 w-full" /></div></div>;
  if (!group || !plan) return <div className="mx-auto max-w-xl"><Link href="/groups" className="inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-primary-text"><ArrowLeft aria-hidden className="size-4" />{t("Expense Groups")}</Link><p role="alert" className="mt-5 rounded-md bg-danger-surface px-3 py-2.5 text-[13px] font-medium text-danger-text">{error ?? t("This Expense Group is unavailable.")}</p></div>;

  return (
    <div className="mx-auto max-w-5xl pb-12">
      {!online && <OfflineBanner />}
      <Link href="/groups" className="mb-3 inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-primary-text hover:underline"><ArrowLeft aria-hidden className="size-4" />{t("Expense Groups")}</Link>
      <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[13px] font-medium text-primary-text">{t("Smart Group Settlement")}</p><h1 className="mt-1 text-[24px] font-semibold leading-8">{group.name}</h1><p className="mt-2 text-[15px] text-text-secondary">{t("{members} members · {expenses} Expenses", { members: formatNumber(group.members.length), expenses: formatNumber(group.expenses.length) })}</p></div><Button onClick={() => setShowExpense((value) => !value)}><Plus aria-hidden className="size-4" />{t("Add Expense")}</Button></header>
      {error && <p role="alert" className="mt-5 rounded-md bg-danger-surface px-3 py-2.5 text-[13px] font-medium text-danger-text">{error}</p>}
      {notice && <p aria-live="polite" className="mt-5 flex items-center gap-2 rounded-md bg-success-surface px-3 py-2.5 text-[13px] font-medium text-success-text"><Check aria-hidden className="size-4" />{notice}</p>}

      {showExpense && <section className="mt-7 border-y border-divider py-6" aria-labelledby="new-expense"><h2 id="new-expense" className="text-[18px] font-semibold">{t("Record an Expense")}</h2><p className="mt-1 text-[13px] text-text-secondary">{t("This records obligations only. It does not send money.")}</p><div className="mt-5 grid gap-5 md:grid-cols-2"><Field label={t("Description")} value={description} onChange={(event) => setDescription(event.target.value.slice(0, 140))} placeholder={t("Dinner")} disabled={working} /><div><label htmlFor="expense-payer" className="text-[13px] font-medium text-text-secondary">{t("Who paid?")}</label><div className="relative mt-1.5"><select id="expense-payer" value={payerId} onChange={(event) => setPayerId(event.target.value)} className="h-12 w-full appearance-none rounded-md border border-control bg-surface px-3 pr-10 text-[15px] outline-none focus:border-primary">{group.members.map((member) => <option key={member.id} value={member.id}>{member.name}{member.isCurrentUser ? ` ${t("(you)")}` : ""}</option>)}</select><ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-3.5 size-5 text-text-secondary" /></div></div></div><div className="mt-5 max-w-md"><AmountInput value={total} onChange={setTotal} minor={totalMinor} balanceMinor={null} label={t("Expense amount")} error={splitError} disabled={working} /></div><div className="mt-5"><p className="text-[13px] font-medium text-text-secondary">{t("Split method")}</p><div className="mt-2 grid grid-cols-3 rounded-md bg-surface-subtle p-1">{(["EQUAL", "EXACT", "PERCENTAGE"] as SplitType[]).map((value) => <button key={value} type="button" onClick={() => setSplitType(value)} aria-pressed={splitType === value} className={`min-h-11 rounded-sm text-[12px] font-semibold ${splitType === value ? "bg-surface text-primary-text shadow-sm" : "text-text-secondary"}`}>{t(value === "PERCENTAGE" ? "Percent" : value[0] + value.slice(1).toLowerCase())}</button>)}</div></div><fieldset className="mt-5"><legend className="text-[13px] font-medium text-text-secondary">{t("Participants")}</legend><div className="mt-2 grid gap-3 sm:grid-cols-2">{group.members.map((member) => { const selected = selectedIds.includes(member.id); return <div key={member.id} className={`rounded-md border p-3 ${selected ? "border-purple-border bg-purple-soft" : "border-divider bg-surface"}`}><label className="flex min-h-11 cursor-pointer items-center gap-3"><input type="checkbox" checked={selected} onChange={() => toggleMember(member.id)} className="size-5 accent-primary" /><span className="text-[14px] font-semibold">{member.name}{member.isCurrentUser ? ` ${t("(you)")}` : ""}</span></label>{selected && splitType === "EXACT" && <div className="mt-2"><AmountInput value={exactValues[member.id] ?? ""} onChange={(value) => setExactValues((current) => ({ ...current, [member.id]: value }))} minor={parseTakaToPoisha(exactValues[member.id] ?? "")} balanceMinor={null} label={t("{name}'s Share", { name: member.name })} disabled={working} /></div>}{selected && splitType === "PERCENTAGE" && <div className="mt-2"><Field label={t("{name}'s percentage", { name: member.name })} value={percentageValues[member.id] ?? ""} onChange={(event) => setPercentageValues((current) => ({ ...current, [member.id]: event.target.value }))} inputMode="decimal" placeholder="50.00" disabled={working} /></div>}</div>; })}</div></fieldset><div className="mt-6 grid max-w-md grid-cols-2 gap-3"><Button variant="secondary" onClick={() => setShowExpense(false)} disabled={working}>{t("Cancel")}</Button><Button onClick={() => void addExpense()} loading={working} disabled={!description.trim() || totalMinor === null || totalMinor <= 0 || Boolean(splitError)}>{t("Record Expense")}</Button></div></section>}

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]">
        <section aria-labelledby="settlement-plan"><div className="flex items-start justify-between gap-4"><div><p className="text-[13px] font-medium text-primary-text">{t("Explainable preview")}</p><h2 id="settlement-plan" className="mt-1 text-[20px] font-semibold">{t("Optimized Settlement Plan")}</h2><p className="mt-1 text-[13px] leading-5 text-text-secondary">{t("Net Positions stay unchanged; only the payment paths are simplified.")}</p></div><Scale aria-hidden className="mt-1 size-6 shrink-0 text-primary-text" /></div><div className="mt-5 divide-y divide-divider border-y border-divider">{plan.transfers.length ? plan.transfers.map((item, index) => <div key={`${item.from.id}-${item.to.id}-${index}`} className="flex min-h-16 items-center gap-3 py-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-purple-soft text-[13px] font-semibold text-primary-text">{formatNumber(index + 1)}</span><div className="min-w-0 flex-1"><p className="truncate text-[14px] font-semibold">{item.from.name} → {item.to.name}</p><p className="mt-0.5 text-[12px] text-text-secondary">{t(item.isCurrentUserPayer ? "Your approval required" : "That payer approves separately")}</p></div><AmountDisplay minor={item.amountMinor} kind={item.isCurrentUserPayer ? "OUT" : "PLAIN"} /></div>) : <div className="py-10 text-center"><Check aria-hidden className="mx-auto size-7 text-success-text" /><p className="mt-3 text-[15px] font-semibold">{t("Everyone is settled")}</p><p className="mt-1 text-[13px] text-text-secondary">{t("There are no payments to make.")}</p></div>}</div>{plan.canCurrentUserSettle && <div className="mt-5"><Button full onClick={() => setReviewing(true)} disabled={!online}>{t("Review my settlement")} · <AmountDisplay minor={plan.currentUserOutgoingMinor} kind="OUT" className="text-current" /></Button><p className="mt-2 text-[12px] leading-4 text-text-secondary">{t("Only your outgoing instructions execute together. Other members must approve theirs.")}</p></div>}</section>

        <aside className="lg:sticky lg:top-24"><section aria-labelledby="net-positions"><div className="flex items-center gap-2"><Users aria-hidden className="size-5 text-primary-text" /><h2 id="net-positions" className="text-[18px] font-semibold">{t("Net Positions")}</h2></div><ul className="mt-3 divide-y divide-divider">{plan.positions.map((position) => <li key={position.member.id} className="flex min-h-14 items-center justify-between gap-3 py-3"><div><p className="text-[14px] font-semibold">{position.member.name}{position.member.isCurrentUser ? ` ${t("(you)")}` : ""}</p><p className="mt-0.5 text-[12px] text-text-secondary">{t(position.direction === "RECEIVE" ? "Receives" : position.direction === "PAY" ? "Pays" : "Settled")}</p></div><AmountDisplay minor={Math.abs(position.netMinor)} kind={position.direction === "RECEIVE" ? "IN" : position.direction === "PAY" ? "OUT" : "PLAIN"} /></li>)}</ul></section><section className="mt-8 border-t border-divider pt-6" aria-labelledby="expense-history"><div className="flex items-center gap-2"><ReceiptText aria-hidden className="size-5 text-primary-text" /><h2 id="expense-history" className="text-[18px] font-semibold">{t("Expenses")}</h2></div>{group.expenses.length ? <ul className="mt-3 divide-y divide-divider">{group.expenses.map((expense) => <li key={expense.id} className="py-3"><div className="flex items-start justify-between gap-3"><div><p className="text-[14px] font-semibold">{expense.description}</p><p className="mt-1 text-[12px] text-text-secondary">{t("Paid by {name} · {type} · {time}", { name: expense.paidBy.name, type: t(expense.splitType.toLowerCase()), time: moment(expense.createdAt) })}</p></div><AmountDisplay minor={expense.totalMinor} /></div></li>)}</ul> : <p className="mt-3 text-[13px] leading-5 text-text-secondary">{t("No Expenses yet. Record one to calculate Net Positions.")}</p>}</section></aside>
      </div>

      {reviewing && settlementRecipients.length > 0 && <ConfirmationSheet amountMinor={plan.currentUserOutgoingMinor} recipient={settlementRecipients[0]} recipients={settlementRecipients.length > 1 ? settlementRecipients : undefined} note={t("Settlement for {name}", { name: group.name })} title={t("Approve Group Settlement")} eyebrow={t("Only your Account will be debited")} confirming={working} disabled={!online} error={error} onCancel={() => !working && setReviewing(false)} onConfirm={() => void settle()}><div className="mt-4 space-y-2 border-t border-divider pt-4">{myTransfers.map((item) => <div key={item.to.id} className="flex items-center justify-between gap-3 text-[13px]"><span className="text-text-secondary">{t("To {name}", { name: item.to.name })}</span><AmountDisplay minor={item.amountMinor} kind="OUT" /></div>)}</div></ConfirmationSheet>}
      {stepUpReason && <StepUpDialog reason={stepUpReason} onCancel={() => setStepUpReason(null)} onVerify={(pin) => settle(pin)} />}
    </div>
  );
}
