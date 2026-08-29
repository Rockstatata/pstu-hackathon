"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { PinInput } from "@/components/money/PinInput";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { ApiError, api, tokenStore } from "@/lib/api";
import { useI18n } from "@/components/i18n/LanguageProvider";

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { t } = useI18n();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (fullName.trim().length < 2) return setError(t("Enter your full name."));
    if (phone.length !== 11) return setError(t("Enter an 11-digit phone number."));
    if (pin.length !== 5) return setError(t("Choose a 5-digit PIN."));
    if (pin !== confirmPin) return setError(t("Your PINs do not match."));
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.register({ fullName: fullName.trim(), phone, pin });
      tokenStore.set(result.token);
      router.replace("/?welcome=1");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.sentence : t("We could not create your account. Try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthFrame>
      <h1 className="text-[24px] font-semibold leading-8">{t("Create your account")}</h1>
      <p className="mt-1 text-[15px] leading-6 text-text-secondary">{t("Your starting balance is issued once your account is ready.")}</p>
      <form className="mt-7 space-y-5" onSubmit={submit}>
        <Field label={t("Full name")} value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" autoFocus />
        <PhoneInput value={phone} onChange={setPhone} />
        <PinInput value={pin} onChange={setPin} label={t("Choose a 5-digit PIN")} />
        <PinInput value={confirmPin} onChange={setConfirmPin} label={t("Confirm PIN")} error={error} />
        <Button type="submit" full loading={submitting}>{t("Create account")}</Button>
      </form>
      <p className="mt-6 text-center text-[13px] text-text-secondary">{t("Already have an account?")} <Link className="font-semibold text-primary-text hover:underline" href="/login">{t("Sign in")}</Link></p>
    </AuthFrame>
  );
}
