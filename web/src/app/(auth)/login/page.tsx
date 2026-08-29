"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { PinInput } from "@/components/money/PinInput";
import { Button } from "@/components/ui/Button";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { ApiError, api, tokenStore } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phone.length !== 11 || pin.length !== 5) {
      setError("Enter your 11-digit phone number and 5-digit PIN.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.login({ phone, pin });
      tokenStore.set(result.token);
      router.replace("/");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.sentence : "We could not sign you in. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthFrame>
      <h1 className="text-[24px] font-semibold leading-8">Welcome back</h1>
      <p className="mt-1 text-[15px] leading-6 text-text-secondary">Sign in to see your account and move money.</p>
      <form className="mt-7 space-y-5" onSubmit={submit}>
        <PhoneInput value={phone} onChange={setPhone} error={phone && phone.length !== 11 ? "Enter all 11 digits." : null} autoFocus />
        <PinInput value={pin} onChange={setPin} label="5-digit PIN" error={error} />
        <Button type="submit" full loading={submitting}>Sign in</Button>
      </form>
      <p className="mt-6 text-center text-[13px] text-text-secondary">New to Chorui? <Link className="font-semibold text-primary-text hover:underline" href="/register">Create an account</Link></p>
    </AuthFrame>
  );
}
