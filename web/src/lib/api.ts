import type {
  AccountSummary,
  ApiErrorBody,
  AuthResponse,
  CreateGroupTransferRequest,
  CreateMoneyRequestRequest,
  CreateScheduledTransferRequest,
  CreateTransferRequest,
  IntegrityReport,
  MoneyRequest,
  MoneyRequestListResponse,
  NotificationListResponse,
  RecipientPreview,
  SystemInfo,
  ScheduledTransfer,
  Transfer,
  TransferListResponse,
} from "./types";
import { fixture, FIXTURES_ON } from "./fixtures";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080/api/v1";
const TOKEN_KEY = "chorui.token";

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Errors are sentences, not codes (docs/frontend-screens.md rule 4). The server
 * already sends a human message; this map exists so the UI still reads like a
 * sentence if a backend message is terse, and so an unreachable API is not
 * reported to a user as "TypeError: Failed to fetch".
 */
const SENTENCES: Record<string, string> = {
  INVALID_AMOUNT: "Enter an amount greater than zero.",
  INSUFFICIENT_FUNDS: "You do not have enough balance for this transfer.",
  RECIPIENT_NOT_FOUND: "No account is registered to that number.",
  SELF_TRANSFER_NOT_ALLOWED: "You cannot send money to your own account.",
  TRANSFER_LIMIT_EXCEEDED: "You can send up to ৳100,000 per transfer and ৳200,000 per day.",
  REQUEST_NOT_FOUND: "That money request no longer exists.",
  REQUEST_ALREADY_RESOLVED: "That request has already been answered.",
  REQUEST_EXPIRED: "That money request has expired.",
  SCHEDULED_TRANSFER_NOT_FOUND: "That scheduled transfer is no longer available.",
  IDEMPOTENCY_KEY_REQUIRED: "Something went wrong on our side. Nothing was sent.",
  IDEMPOTENCY_KEY_REUSED: "This transfer was already submitted. Check your history before retrying.",
  UNAUTHENTICATED: "Your session has expired. Sign in again.",
  FORBIDDEN: "You do not have access to this.",
  FINANCIAL_CORE_UNAVAILABLE: "Transfers are briefly unavailable. No money has moved.",
  INTERNAL_ERROR: "Something went wrong on our side. No money has moved.",
  NETWORK: "We could not reach the server. Nothing was sent.",
};

export class ApiError extends Error {
  readonly code: string;
  readonly traceId?: string;
  readonly status: number;

  constructor(code: string, message: string, status: number, traceId?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.traceId = traceId;
    this.status = status;
  }

  /** Always a full sentence. Never a raw code, never a stack trace. */
  get sentence(): string {
    return SENTENCES[this.code] ?? this.message ?? SENTENCES.INTERNAL_ERROR;
  }
}

/* -------------------------------------------------------------------------- */
/* Token                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * JWT in Authorization: Bearer, not a cookie — the frontend and API are on
 * different origins (ADR-0007). The token is an identity credential only; it is
 * never trusted for balances or amounts.
 */
export const tokenStore = {
  get(): string | null {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* private mode — the session simply will not persist a reload */
    }
  },
  clear() {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

/* -------------------------------------------------------------------------- */
/* Request                                                                     */
/* -------------------------------------------------------------------------- */

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  if (FIXTURES_ON) return fixture<T>(path, opts.method ?? "GET", opts.body);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  // Sent on every money-moving POST. The same key must survive a retry
  // unchanged, which is why callers generate it once and pass it in.
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch {
    // A failed fetch is ambiguous: the request may or may not have reached the
    // server. We say "nothing was sent" only because the backend is idempotent,
    // so the safe user action is to check history rather than blindly retry.
    throw new ApiError("NETWORK", SENTENCES.NETWORK, 0);
  }

  if (res.status === 204) return undefined as T;

  const payload: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const body = payload as ApiErrorBody | null;
    const code = body?.error?.code ?? "INTERNAL_ERROR";
    const message = body?.error?.message ?? "Something went wrong.";
    if (res.status === 401) tokenStore.clear();
    throw new ApiError(code, message, res.status, body?.error?.traceId);
  }

  return payload as T;
}

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                   */
/* -------------------------------------------------------------------------- */

export const api = {
  register: (body: { fullName: string; phone: string; pin: string }) =>
    request<AuthResponse>("/auth/register", { method: "POST", body }),

  login: (body: { phone: string; pin: string }) =>
    request<AuthResponse>("/auth/login", { method: "POST", body }),

  me: () => request<AuthResponse["user"]>("/auth/me"),

  account: () => request<AccountSummary>("/accounts/me"),

  /** Returns only what is safe to show a sender before they commit. */
  recipientPreview: (phone: string) =>
    request<RecipientPreview>(`/users/search?q=${encodeURIComponent(phone)}`),

  transfers: (cursor?: string) =>
    request<TransferListResponse>(`/transfers${cursor ? `?cursor=${cursor}` : ""}`),

  transfer: (reference: string) => request<Transfer>(`/transfers/${reference}`),

  createTransfer: (body: CreateTransferRequest, idempotencyKey: string) =>
    request<Transfer>("/transfers", { method: "POST", body, idempotencyKey }),

  /** Backend endpoint intentionally isolated here until the group-transfer contract lands. */
  createGroupTransfer: (body: CreateGroupTransferRequest, idempotencyKey: string) =>
    request<Transfer>("/transfers/group", { method: "POST", body, idempotencyKey }),

  moneyRequests: (direction?: "incoming" | "outgoing") =>
    request<MoneyRequestListResponse>(`/money-requests${direction ? `?direction=${direction}` : ""}`),

  moneyRequest: (id: string) => request<MoneyRequest>(`/money-requests/${id}`),

  createMoneyRequest: (body: CreateMoneyRequestRequest) =>
    request<MoneyRequest>("/money-requests", { method: "POST", body }),

  payMoneyRequest: (id: string, idempotencyKey: string) =>
    request<Transfer>(`/money-requests/${id}/pay`, { method: "POST", idempotencyKey }),

  declineMoneyRequest: (id: string) => request<MoneyRequest>(`/money-requests/${id}/decline`, { method: "POST" }),

  cancelMoneyRequest: (id: string) => request<MoneyRequest>(`/money-requests/${id}/cancel`, { method: "POST" }),

  /** Future scheduling endpoints are kept at this seam until backend merge. */
  scheduledTransfers: () => request<ScheduledTransfer[]>("/scheduled-transfers"),

  createScheduledTransfer: (body: CreateScheduledTransferRequest) =>
    request<ScheduledTransfer>("/scheduled-transfers", { method: "POST", body }),

  cancelScheduledTransfer: (id: string) => request<ScheduledTransfer>(`/scheduled-transfers/${id}/cancel`, { method: "POST" }),

  notifications: () => request<NotificationListResponse>("/notifications"),

  markNotificationRead: (id: string) => request<void>(`/notifications/${id}/read`, { method: "POST" }),

  integrity: () => request<IntegrityReport>("/internal/integrity"),

  systemInfo: () => request<SystemInfo>("/internal/system-info"),
};

/** One key per compose session, reused unchanged across every retry of it. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
