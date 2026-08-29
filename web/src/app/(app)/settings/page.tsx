"use client";

import { LogOut, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FixtureNotice } from "@/components/ui/FixtureNotice";
import { Skeleton } from "@/components/ui/Skeleton";
import { ApiError, api, tokenStore } from "@/lib/api";
import { maskPhone } from "@/lib/money";
import type { AuthUser } from "@/lib/types";

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.me().then((value) => active && setUser(value)).catch((cause) => active && setError(cause instanceof ApiError ? cause.sentence : "We could not load your profile."));
    return () => { active = false; };
  }, []);

  function signOut() {
    tokenStore.clear();
    router.replace("/login");
  }

  return <div className="mx-auto max-w-md"><FixtureNotice /><header><p className="text-[13px] font-medium text-text-secondary">Your account</p><h1 className="mt-1 text-[24px] font-semibold leading-8">Profile and settings</h1></header>{error && <p role="alert" className="mt-6 rounded-md bg-danger-surface px-3 py-2.5 text-[13px] font-medium text-danger-text">{error}</p>}{!user && !error ? <div className="mt-7 space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-11 w-36" /></div> : user && <><section className="card mt-7 p-5"><span aria-hidden className="flex size-11 items-center justify-center rounded-full bg-purple-soft text-primary-text"><UserRound className="size-5" /></span><p className="mt-4 text-[18px] font-semibold">{user.fullName}</p><p className="tnum mt-1 text-[15px] text-text-secondary">{maskPhone(user.phone)}</p></section><section className="mt-8 border-t border-divider pt-6"><h2 className="text-[15px] font-semibold">Session</h2><p className="mt-1 text-[13px] leading-5 text-text-secondary">Signing out removes this device&apos;s session token. It does not change your account or money.</p><Button variant="ghost" className="mt-3 px-0" onClick={signOut}><LogOut aria-hidden className="size-4" />Sign out</Button></section></>}</div>;
}
