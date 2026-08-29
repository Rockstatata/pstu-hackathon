"use client";

import { ArrowLeft, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { ApiError, api, newIdempotencyKey } from "@/lib/api";
import { maskPhone } from "@/lib/money";
import { useOnlineStatus } from "@/lib/use-online-status";
import { useI18n } from "@/components/i18n/LanguageProvider";

export default function NewExpenseGroupPage() {
  const { t } = useI18n();
  const router = useRouter();
  const online = useOnlineStatus();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [phones, setPhones] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function addPhone() {
    if (!/^01[3-9]\d{8}$/.test(phone)) {
      setError(t("Enter an 11-digit Bangladeshi mobile number."));
      return;
    }
    if (phones.includes(phone)) {
      setError(t("That person is already in this group."));
      return;
    }
    setPhones((current) => [...current, phone]);
    setPhone("");
    setError(null);
  }

  async function create() {
    if (!name.trim() || phones.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const group = await api.createExpenseGroup(
        { name: name.trim(), memberPhones: phones },
        newIdempotencyKey(),
      );
      router.replace(`/groups/${group.id}`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.sentence : t("The Expense Group could not be created."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md pb-40">
      {!online && <OfflineBanner />}
      <Link href="/groups" className="mb-3 inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-primary-text hover:underline"><ArrowLeft aria-hidden className="size-4" />{t("Smart Group Settlement")}</Link>
      <h1 className="text-[24px] font-semibold leading-8">{t("Create an Expense Group")}</h1>
      <p className="mt-2 text-[15px] leading-6 text-text-secondary">{t("Members can record shared Expenses. Money moves only when each payer approves their own settlement.")}</p>

      <section className="mt-7" aria-labelledby="group-details">
        <h2 id="group-details" className="text-[18px] font-semibold">{t("Group details")}</h2>
        <div className="mt-4"><Field label={t("Group name")} value={name} onChange={(event) => setName(event.target.value.slice(0, 80))} placeholder={t("Campus dinner")} disabled={!online || submitting} /></div>
      </section>

      <section className="mt-8 border-t border-divider pt-7" aria-labelledby="group-members">
        <h2 id="group-members" className="text-[18px] font-semibold">{t("Members")}</h2>
        <p className="mt-1 text-[13px] text-text-secondary">{t("You are included automatically.")}</p>
        {phones.length > 0 && <ul className="mt-4 flex flex-wrap gap-2">{phones.map((item) => <li key={item} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-purple-soft py-1 pl-3 pr-1 text-[13px] font-semibold text-primary-text"><span className="tnum">{maskPhone(item)}</span><button type="button" onClick={() => setPhones((current) => current.filter((value) => value !== item))} className="inline-flex size-9 items-center justify-center rounded-full hover:bg-surface" aria-label={t("Remove {name}", { name: maskPhone(item) })}><X aria-hidden className="size-4" /></button></li>)}</ul>}
        <div className="mt-4"><PhoneInput value={phone} onChange={setPhone} label={t("Member phone number")} disabled={!online || submitting} /></div>
        <Button variant="secondary" className="mt-3" onClick={addPhone} disabled={!online || submitting || phone.length !== 11}><Plus aria-hidden className="size-4" />{t("Add member")}</Button>
      </section>

      {error && <p aria-live="polite" className="mt-5 rounded-md bg-danger-surface px-3 py-2.5 text-[13px] font-medium text-danger-text">{error}</p>}
      <div className="safe-bottom fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-20 border-t border-divider bg-bg px-4 py-3 lg:bottom-0 lg:left-[15rem]"><div className="mx-auto max-w-md"><Button full onClick={() => void create()} loading={submitting} disabled={!online || !name.trim() || phones.length === 0}>{t("Create Expense Group")}</Button></div></div>
    </div>
  );
}
