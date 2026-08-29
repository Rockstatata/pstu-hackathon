"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ApiError, api, tokenStore } from "@/lib/api";

type AuthState = "checking" | "allowed";

/**
 * Protects the consumer application routes. The bearer token lives in
 * localStorage, so it is intentionally checked in the browser before any
 * account screen is rendered.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<AuthState>("checking");

  useEffect(() => {
    let active = true;
    const sendToLogin = () => router.replace(`/login?next=${encodeURIComponent(pathname)}`);

    async function verifySession() {
      if (!tokenStore.get()) {
        sendToLogin();
        return;
      }

      try {
        await api.me();
        if (active) setState("allowed");
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) {
          sendToLogin();
          return;
        }

        // An unavailable network cannot prove a valid session invalid. Keep
        // the user in their signed-in experience, where each API call can
        // surface its own safe offline/error state.
        if (active) setState("allowed");
      }
    }

    const onUnauthenticated = () => sendToLogin();
    window.addEventListener("chorui:unauthenticated", onUnauthenticated);
    void verifySession();

    return () => {
      active = false;
      window.removeEventListener("chorui:unauthenticated", onUnauthenticated);
    };
  }, [pathname, router]);

  if (state !== "allowed") return null;
  return <>{children}</>;
}
