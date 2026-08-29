import type {
  AccountSummary,
  ApiErrorBody,
  AuthResponse,
  CreateGroupTransferRequest,
  CreateMoneyRequestRequest,
  CreateTransferRequest,
  IntegrityReport,
  MoneyRequest,
  MoneyRequestListResponse,
  RecipientPreview,
  SystemInfo,
  Transfer,
  TransferListResponse,
  TransferReceipt,
  TransferStatus,
  WireAccount,
  WireAuthResponse,
  WireIdentity,
  WireMoneyRequest,
  WireReceipt,
  WireRecentRecipients,
  WireTransaction,
  WireUser,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080/api/v1";
const TOKEN_KEY = "chorui.token";

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Errors are sentences, not codes (docs/frontend-screens.md rule 4). The server
 * message stays authoritative; this map is the fallback for the two cases the
 * server cannot cover — a request that never reached it, and a terse code we
 * would otherwise print raw.
 */
const SENTENCES: Record<string, string> = {
  INVALID_AMOUNT: "Enter an amount greater than zero.",
  INSUFFICIENT_FUNDS: "You do not have enough balance for this transfer.",
  RECIPIENT_NOT_FOUND: "No account is registered to that number.",
  SELF_TRANSFER_NOT_ALLOWED: "You cannot send money to your own account.",
  TRANSFER_LIMIT_EXCEEDED: "That amount is over the transfer limit.",
  STEP_UP_REQUIRED: "This transfer needs your PIN before it can be sent.",
  STEP_UP_FAILED: "That PIN is not correct. No money has moved.",
  TRANSFER_NOT_FOUND: "No transaction found with that ID.",
  MONEY_REQUEST_NOT_FOUND: "That money request no longer exists.",
  MONEY_REQUEST_NOT_PENDING: "That request has already been answered.",
  MONEY_REQUEST_EXPIRED: "That money request has expired.",
  PHONE_ALREADY_REGISTERED: "That number already has an account. Sign in instead.",
  TOO_MANY_ATTEMPTS: "Too many incorrect attempts. Wait a moment before trying again.",
  RATE_LIMITED: "Too many requests. Wait a moment before trying again.",
  REQUEST_IN_PROGRESS: "That request is still being processed. Check your history in a moment.",
  IDEMPOTENCY_KEY_REQUIRED: "Something went wrong on our side. Nothing was sent.",
  IDEMPOTENCY_KEY_REUSED:
    "This was already submitted with different details. Check your history before retrying.",
  PAYLOAD_TOO_LARGE: "That request was too large to send.",
  INVALID_REQUEST: "Check the details you entered and try again.",
  UNAUTHENTICATED: "Your session has expired. Sign in again.",
  FINANCIAL_CORE_UNAVAILABLE: "Transfers are briefly unavailable. No money has moved.",
  INTERNAL_ERROR: "Something went wrong on our side. No money has moved.",
  NETWORK: "We could not reach the server. Nothing was sent.",
};

export class ApiError extends Error {
  readonly code: string;
  readonly traceId?: string;
  readonly status: number;
  /** Set on 403 STEP_UP_REQUIRED: why the server wants another identity check. */
  readonly stepUpReason?: string;

  constructor(
    code: string,
    message: string,
    status: number,
    traceId?: string,
    stepUpReason?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.traceId = traceId;
    this.status = status;
    this.stepUpReason = stepUpReason;
  }

  /** Always a full sentence. Never a raw code, never a stack trace. */
  get sentence(): string {
    return this.message || SENTENCES[this.code] || SENTENCES.INTERNAL_ERROR;
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
    // server. The safe action is to check history rather than blindly retry,
    // and the unchanged key makes a genuine retry harmless.
    throw new ApiError("NETWORK", SENTENCES.NETWORK, 0);
  }

  if (res.status === 204) return undefined as T;

  const payload: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const body = payload as ApiErrorBody | null;
    const code = body?.error?.code ?? "INTERNAL_ERROR";
    const message = body?.error?.message ?? SENTENCES.INTERNAL_ERROR;
    if (res.status === 401) tokenStore.clear();
    throw new ApiError(code, message, res.status, body?.error?.traceId, body?.error?.stepUpReason);
  }

  return payload as T;
}

/* -------------------------------------------------------------------------- */
/* Wire -> view mapping                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The only place backend field names appear. Poisha stays an integer through
 * every one of these; `Minor` is a rename, never a conversion.
 */

function toUser(wire: WireUser) {
  return { id: wire.id, fullName: wire.name, phone: wire.phone };
}

function toAuth(wire: WireAuthResponse): AuthResponse {
  return {
    token: wire.token,
    user: toUser(wire.user),
    grantMinor: wire.grant?.amountPoisha ?? null,
  };
}

function toAccount(wire: WireAccount): AccountSummary {
  return { accountId: wire.accountId, balanceMinor: wire.balancePoisha, asOf: wire.asOf };
}

function toTransfer(wire: WireTransaction): Transfer {
  const primary = wire.counterparties[0];
  const many = wire.counterparties.length > 1;

  return {
    reference: wire.reference,
    kind: wire.kind,
    status: (wire.status === "REVERSED" ? "REVERSED" : "COMPLETED") as TransferStatus,
    direction: wire.direction === "sent" ? "OUT" : "IN",
    // The sender's leg arrives negative. Direction already carries that fact,
    // so the amount itself is the magnitude.
    amountMinor: Math.abs(wire.amountPoisha),
    counterpartyName: many
      ? `${wire.counterparties.length} recipients`
      : (primary?.name ?? "Chorui"),
    counterpartyMaskedPhone: many ? "Group transfer" : (primary?.maskedPhone ?? ""),
    counterparties: wire.counterparties.map((c) => ({
      name: c.name,
      maskedPhone: c.maskedPhone,
      amountMinor: Math.abs(c.amountPoisha),
    })),
    note: wire.note,
    createdAt: wire.createdAt,
    riskReason: wire.riskReason,
    reversible: wire.reversible ?? false,
    notReversibleReason: wire.notReversibleReason ?? null,
  };
}

function toReceipt(wire: WireReceipt): TransferReceipt {
  return {
    reference: wire.reference,
    kind: wire.kind,
    totalMinor: wire.totalPoisha,
    note: wire.note,
    riskReason: wire.riskReason,
    senderBalanceAfterMinor: wire.senderBalanceAfterPoisha,
    completedAt: wire.completedAt,
    recipients: wire.recipients.map((r) => ({
      name: r.name,
      maskedPhone: r.maskedPhone,
      amountMinor: r.amountPoisha,
    })),
  };
}

function toMoneyRequest(wire: WireMoneyRequest): MoneyRequest {
  // `direction` is relative to the signed-in User: incoming means they are the
  // payer, so the person to name on the card is the requester, and vice versa.
  const counterparty: WireIdentity = wire.direction === "incoming" ? wire.requester : wire.payer;

  return {
    id: wire.requestId,
    reference: wire.reference,
    direction: wire.direction === "incoming" ? "INCOMING" : "OUTGOING",
    status: wire.status,
    counterpartyName: counterparty.name,
    counterpartyMaskedPhone: counterparty.maskedPhone,
    amountMinor: wire.amountPoisha,
    reason: wire.reason,
    createdAt: wire.createdAt,
    expiresAt: wire.expiresAt,
    transferReference: wire.transferReference,
  };
}

/* -------------------------------------------------------------------------- */
/* Endpoints — docs/openapi.json                                               */
/* -------------------------------------------------------------------------- */

export const api = {
  register: async (body: { fullName: string; phone: string; pin: string }) =>
    toAuth(
      await request<WireAuthResponse>("/auth/register", {
        method: "POST",
        body: { name: body.fullName, phone: body.phone, pin: body.pin },
      }),
    ),

  login: async (body: { phone: string; pin: string }) =>
    toAuth(await request<WireAuthResponse>("/auth/login", { method: "POST", body })),

  me: async () => toUser(await request<WireUser>("/auth/me")),

  account: async () => toAccount(await request<WireAccount>("/accounts/me")),

  /** Returns only what is safe to show a sender before they commit. */
  recipientPreview: async (phone: string): Promise<RecipientPreview> => {
    const wire = await request<WireIdentity>(`/users/lookup?phone=${encodeURIComponent(phone)}`);
    return { phone, fullName: wire.name, maskedPhone: wire.maskedPhone };
  },

  recentRecipients: async (): Promise<RecipientPreview[]> => {
    const wire = await request<WireRecentRecipients>("/users/recent-recipients");
    return wire.recipients.map((r) => ({
      phone: r.phone,
      fullName: r.name,
      maskedPhone: r.maskedPhone,
    }));
  },

  transfers: async (): Promise<TransferListResponse> => {
    const wire = await request<{ transactions: WireTransaction[] }>("/transfers");
    return { items: wire.transactions.map(toTransfer) };
  },

  transfer: async (reference: string) =>
    toTransfer(await request<WireTransaction>(`/transfers/${encodeURIComponent(reference)}`)),

  createTransfer: async (body: CreateTransferRequest, idempotencyKey: string) =>
    toReceipt(
      await request<WireReceipt>("/transfers", {
        method: "POST",
        idempotencyKey,
        body: {
          recipientPhone: body.recipientPhone,
          amountPoisha: body.amountMinor,
          ...(body.note ? { note: body.note } : {}),
          ...(body.pin ? { pin: body.pin } : {}),
        },
      }),
    ),

  /**
   * The same endpoint as a direct send. A Group Transfer is one atomic Transfer
   * with N+1 legs, not N transfers, so it must not have a second code path.
   */
  createGroupTransfer: async (body: CreateGroupTransferRequest, idempotencyKey: string) =>
    toReceipt(
      await request<WireReceipt>("/transfers", {
        method: "POST",
        idempotencyKey,
        body: {
          recipients: body.recipients.map((r) => ({ phone: r.phone, amountPoisha: r.amountMinor })),
          ...(body.note ? { note: body.note } : {}),
          ...(body.pin ? { pin: body.pin } : {}),
        },
      }),
    ),

  moneyRequests: async (direction: "incoming" | "outgoing"): Promise<MoneyRequestListResponse> => {
    const wire = await request<{ moneyRequests: WireMoneyRequest[] }>(
      `/money-requests?direction=${direction}`,
    );
    return { items: wire.moneyRequests.map(toMoneyRequest) };
  },

  moneyRequest: async (id: string) =>
    toMoneyRequest(await request<WireMoneyRequest>(`/money-requests/${encodeURIComponent(id)}`)),

  createMoneyRequest: async (body: CreateMoneyRequestRequest, idempotencyKey: string) =>
    toMoneyRequest(
      await request<WireMoneyRequest>("/money-requests", {
        method: "POST",
        idempotencyKey,
        body: {
          payerPhone: body.payerPhone,
          amountPoisha: body.amountMinor,
          reason: body.reason,
        },
      }),
    ),

  /** Paying a request runs through the normal Transfer engine and returns its receipt. */
  payMoneyRequest: async (id: string, idempotencyKey: string, pin?: string) =>
    toReceipt(
      await request<WireReceipt>(`/money-requests/${encodeURIComponent(id)}/pay`, {
        method: "POST",
        idempotencyKey,
        body: pin ? { pin } : {},
      }),
    ),

  declineMoneyRequest: async (id: string) =>
    toMoneyRequest(
      await request<WireMoneyRequest>(`/money-requests/${encodeURIComponent(id)}/decline`, {
        method: "POST",
      }),
    ),

  cancelMoneyRequest: async (id: string) =>
    toMoneyRequest(
      await request<WireMoneyRequest>(`/money-requests/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
      }),
    ),

  /** Unauthenticated on purpose: the proof must be viewable without an account. */
  integrity: () => request<IntegrityReport>("/integrity"),

  systemInfo: () => request<SystemInfo>("/system-info"),
};

/** One key per compose session, reused unchanged across every retry of it. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
