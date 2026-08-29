import type { AccountSummary, Transfer } from "@/lib/types";

interface Cached<T> {
  value: T;
  asOf: string;
}

const ACCOUNT_KEY = "chorui.display.account";
const TRANSFERS_KEY = "chorui.display.transfers";

function read<T>(key: string): Cached<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!parsed || typeof parsed !== "object" || !("value" in parsed) || !("asOf" in parsed)) return null;
    return parsed as Cached<T>;
  } catch {
    return null;
  }
}

function write<T>(key: string, value: T): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ value, asOf: new Date().toISOString() } satisfies Cached<T>));
  } catch {
    // The app remains usable when browser storage is unavailable.
  }
}

/** Cached values are display-only snapshots. Never use one for policy or balance decisions. */
export const displayCache = {
  account: () => read<AccountSummary>(ACCOUNT_KEY),
  transfers: () => read<Transfer[]>(TRANSFERS_KEY),
  saveAccount: (account: AccountSummary) => write(ACCOUNT_KEY, account),
  saveTransfers: (transfers: Transfer[]) => write(TRANSFERS_KEY, transfers),
};
