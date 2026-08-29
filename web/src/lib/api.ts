import type {
  AccountSummary,
  ApiErrorBody,
  AuthResponse,
  CreateGroupTransferRequest,
  CreateMoneyRequestRequest,
  CreateTransferRequest,
  CashEvent,
  CashMutation,
  ExpenseGroup,
  ExpenseGroupMember,
  ExpenseGroupSummary,
  FinancialOutlook,
  IntegrityReport,
  MoneyRequest,
  MoneyRequestListResponse,
  Notification,
  NotificationList,
  RecipientPreview,
  SystemInfo,
  SystemMetrics,
  SmartWallet,
  SettlementPlan,
  ScheduledTransfer,
  Transfer,
  TransferListResponse,
  TransferReceipt,
  TransferStatus,
  WireAccount,
  WireAuthResponse,
  WireIdentity,
  WireMoneyRequest,
  WireNotification,
  WireNotificationList,
  WireReceipt,
  WireRecentRecipients,
  WireTransaction,
  WireCashEvent,
  WireCashMutation,
  WireSmartWallet,
  WireExpenseGroup,
  WireExpenseGroupMember,
  WireExpenseGroupSummary,
  WireFinancialOutlook,
  WireSettlementPlan,
  WireScheduledTransfer,
  WireUser,
} from "./types";
import { readClientLocale, translate } from "./i18n/locale";

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
  NOTIFICATION_NOT_FOUND: "That notification is no longer available.",
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
  NETWORK:
    "We could not reach the server, so we cannot tell you whether this went through. Check your history before trying again.",
  SMART_WALLET_DISCONNECTED: "Connect the Smart Wallet before recording a sensor event.",
  SMART_WALLET_UNAVAILABLE: "Your Smart Wallet could not be loaded.",
  CASH_INVENTORY_INSUFFICIENT:
    "Expected Cash is lower than that cash-out amount. Count and reconcile the wallet first.",
  TRANSFER_NOT_REVERSIBLE: "This Transfer cannot be reversed.",
  REVERSAL_ALREADY_REQUESTED: "A Reversal request already exists for this Transfer.",
  EXPENSE_GROUP_NOT_FOUND: "That Expense Group no longer exists or is not available to you.",
  INVALID_SCHEDULE_TIME: "Choose a future date and time.",
  SCHEDULED_TRANSFER_NOT_FOUND: "That Scheduled Transfer is no longer available.",
  SCHEDULED_TRANSFER_NOT_PENDING: "That Scheduled Transfer has already been resolved.",
  GROUP_MEMBER_NOT_FOUND: "One or more group members could not be found.",
  INVALID_EXPENSE_SPLIT: "Check that every Expense Share adds up to the full amount.",
  SETTLEMENT_PLAN_CHANGED: "The group changed. Review the updated settlement before paying.",
  NOTHING_TO_SETTLE: "You do not currently owe a settlement in this group.",
};

/**
 * Codes whose outcome is genuinely UNKNOWN to the client.
 *
 * The distinction matters more here than anywhere else in the app. A refusal —
 * not enough balance, over the limit, no such recipient — is a decision the
 * server made and committed to, and telling someone "this did not happen" is
 * true. A dropped connection, a 503 from the financial core, or a key another
 * replica is still holding are all states where the money may well have moved
 * and we simply have not been told. Reporting those as "Transfer failed. No
 * transaction ID was issued." is a confident lie, and it is the exact failure
 * this system is being judged on.
 *
 * The recovery for every code in this set is the same and is safe: keep the
 * Idempotency-Key, check history, and resubmit the identical request if it is
 * not there. That is why the caller keeps the compose screen alive rather than
 * routing to a receipt.
 */
export const UNCERTAIN_OUTCOME_CODES: ReadonlySet<string> = new Set([
  "NETWORK",
  "FINANCIAL_CORE_UNAVAILABLE",
  "REQUEST_IN_PROGRESS",
  "INTERNAL_ERROR",
]);

export function isUncertainOutcome(code: string): boolean {
  return UNCERTAIN_OUTCOME_CODES.has(code);
}

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
    const fallback = SENTENCES[this.code] || SENTENCES.INTERNAL_ERROR;
    if (readClientLocale() === "bn") return translate("bn", fallback);
    return this.message || fallback;
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
      window.dispatchEvent(new Event("chorui:unauthenticated"));
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
    originalTransferReference: wire.originalTransferReference ?? null,
    reversalRequestId: wire.reversalRequestId ?? null,
    reversalRequestStatus: wire.reversalRequestStatus ?? null,
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
    requestKind: wire.requestKind,
    originalTransferReference: wire.originalTransferReference,
  };
}

function toCashEvent(wire: WireCashEvent): CashEvent {
  return {
    id: wire.eventId,
    sequence: wire.sequenceNumber,
    kind: wire.kind,
    amountMinor: wire.amountPoisha,
    expectedBeforeMinor: wire.expectedBeforePoisha,
    expectedAfterMinor: wire.expectedAfterPoisha,
    countedCashMinor: wire.countedCashPoisha,
    source: wire.source,
    reason: wire.reason,
    observedAt: wire.observedAt,
    recordedAt: wire.recordedAt,
  };
}

function toSmartWallet(wire: WireSmartWallet): SmartWallet {
  return {
    id: wire.walletId,
    connectionStatus: wire.connectionStatus,
    expectedCashMinor: wire.expectedCashPoisha,
    lastSequence: wire.lastSequence,
    lastSyncedAt: wire.lastSyncedAt,
    inventoryDifferenceMinor: wire.inventoryDifferencePoisha,
    activity: wire.activity.map(toCashEvent),
  };
}

function toCashMutation(wire: WireCashMutation): CashMutation {
  return { event: toCashEvent(wire.event), wallet: toSmartWallet(wire.wallet) };
}

function toExpenseGroupMember(wire: WireExpenseGroupMember): ExpenseGroupMember {
  return {
    id: wire.userId,
    name: wire.name,
    maskedPhone: wire.maskedPhone,
    isCurrentUser: wire.isCurrentUser,
  };
}

function toExpenseGroupSummary(wire: WireExpenseGroupSummary): ExpenseGroupSummary {
  return {
    id: wire.groupId,
    name: wire.name,
    memberCount: wire.memberCount,
    expenseCount: wire.expenseCount,
    createdAt: wire.createdAt,
  };
}

function toExpenseGroup(wire: WireExpenseGroup): ExpenseGroup {
  return {
    id: wire.groupId,
    name: wire.name,
    createdAt: wire.createdAt,
    members: wire.members.map(toExpenseGroupMember),
    expenses: wire.expenses.map((expense) => ({
      id: expense.expenseId,
      description: expense.description,
      totalMinor: expense.totalPoisha,
      splitType: expense.splitType,
      paidBy: toExpenseGroupMember(expense.paidBy),
      shares: expense.shares.map((share) => ({
        member: toExpenseGroupMember(share.member),
        amountMinor: share.amountPoisha,
      })),
      createdAt: expense.createdAt,
    })),
  };
}

function toSettlementPlan(wire: WireSettlementPlan): SettlementPlan {
  return {
    groupId: wire.groupId,
    groupName: wire.groupName,
    version: wire.planVersion,
    positions: wire.positions.map((position) => ({
      member: toExpenseGroupMember(position.member),
      netMinor: position.netPoisha,
      direction: position.direction,
    })),
    transfers: wire.transfers.map((item) => ({
      from: toExpenseGroupMember(item.from),
      to: toExpenseGroupMember(item.to),
      amountMinor: item.amountPoisha,
      isCurrentUserPayer: item.isCurrentUserPayer,
    })),
    optimizedTransferCount: wire.optimizedTransferCount,
    currentUserOutgoingMinor: wire.currentUserOutgoingPoisha,
    canCurrentUserSettle: wire.canCurrentUserSettle,
  };
}

function toNotification(wire: WireNotification): Notification {
  return {
    id: wire.notificationId,
    kind: wire.kind,
    title: wire.title,
    message: wire.message,
    resourceType: wire.resourceType,
    resourceId: wire.resourceId,
    readAt: wire.readAt,
    createdAt: wire.createdAt,
  };
}

function toNotifications(wire: WireNotificationList): NotificationList {
  return { items: wire.notifications.map(toNotification), unreadCount: wire.unreadCount };
}

function toScheduledTransfer(wire: WireScheduledTransfer): ScheduledTransfer {
  return {
    id: wire.scheduledTransferId,
    reference: wire.reference,
    status: wire.status,
    amountMinor: wire.amountPoisha,
    note: wire.note,
    executeAt: wire.executeAt,
    recipientName: wire.recipient.name,
    recipientMaskedPhone: wire.recipient.maskedPhone,
    transferReference: wire.transferReference,
    failureCode: wire.failureCode,
    failureMessage: wire.failureMessage,
    authorizedAt: wire.authorizedAt,
    resolvedAt: wire.resolvedAt,
    createdAt: wire.createdAt,
  };
}

function toFinancialOutlook(wire: WireFinancialOutlook): FinancialOutlook {
  return {
    asOf: wire.asOf,
    period: wire.period,
    balanceMinor: wire.balancePoisha,
    current: {
      outgoingMinor: wire.current.outgoingPoisha,
      incomingMinor: wire.current.incomingPoisha,
      transferCount: wire.current.transferCount,
      netMinor: wire.current.netPoisha,
    },
    comparison: {
      previousOutgoingMinor: wire.comparison.previousOutgoingPoisha,
      previousIncomingMinor: wire.comparison.previousIncomingPoisha,
      previousTransferCount: wire.comparison.previousTransferCount,
      differenceMinor: wire.comparison.differencePoisha,
      changeBps: wire.comparison.changeBps,
      band: wire.comparison.band,
    },
    typicalMoneyOut: {
      averageMinor: wire.typicalMoneyOut.averagePoisha,
      completeMonthsObserved: wire.typicalMoneyOut.completeMonthsObserved,
      targetMonths: wire.typicalMoneyOut.targetMonths,
    },
    buffer: wire.buffer,
    largestRecipient: wire.largestRecipient
      ? {
          name: wire.largestRecipient.name,
          maskedPhone: wire.largestRecipient.maskedPhone,
          amountMinor: wire.largestRecipient.amountPoisha,
          shareBps: wire.largestRecipient.shareBps,
        }
      : null,
    history: wire.history.map((month) => ({
      month: month.month,
      outgoingMinor: month.outgoingPoisha,
      incomingMinor: month.incomingPoisha,
      transferCount: month.transferCount,
    })),
    rules: wire.rules,
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

  financialOutlook: async () =>
    toFinancialOutlook(await request<WireFinancialOutlook>("/financial-outlook")),

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

  requestReversal: async (reference: string, idempotencyKey: string) =>
    toMoneyRequest(
      await request<WireMoneyRequest>(
        `/transfers/${encodeURIComponent(reference)}/reversal-request`,
        { method: "POST", idempotencyKey },
      ),
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

  smartWallet: async () => toSmartWallet(await request<WireSmartWallet>("/smart-wallet")),

  setSmartWalletConnection: async (connected: boolean) =>
    toSmartWallet(
      await request<WireSmartWallet>("/smart-wallet/connection", {
        method: "POST",
        body: { connected },
      }),
    ),

  recordCashEvent: async (
    body: { kind: "CASH_IN" | "CASH_OUT"; amountMinor: number; reason?: string },
    idempotencyKey: string,
  ) =>
    toCashMutation(
      await request<WireCashMutation>("/smart-wallet/events", {
        method: "POST",
        idempotencyKey,
        body: {
          kind: body.kind,
          amountPoisha: body.amountMinor,
          ...(body.reason ? { reason: body.reason } : {}),
        },
      }),
    ),

  reconcileCash: async (
    body: { countedCashMinor: number; reason: string },
    idempotencyKey: string,
  ) =>
    toCashMutation(
      await request<WireCashMutation>("/smart-wallet/reconciliations", {
        method: "POST",
        idempotencyKey,
        body: { countedCashPoisha: body.countedCashMinor, reason: body.reason },
      }),
    ),

  expenseGroups: async (): Promise<ExpenseGroupSummary[]> => {
    const wire = await request<{ groups: WireExpenseGroupSummary[] }>("/expense-groups");
    return wire.groups.map(toExpenseGroupSummary);
  },

  createExpenseGroup: async (
    body: { name: string; memberPhones: string[] },
    idempotencyKey: string,
  ) =>
    toExpenseGroup(
      await request<WireExpenseGroup>("/expense-groups", {
        method: "POST",
        idempotencyKey,
        body,
      }),
    ),

  expenseGroup: async (id: string) =>
    toExpenseGroup(
      await request<WireExpenseGroup>(`/expense-groups/${encodeURIComponent(id)}`),
    ),

  createGroupExpense: async (
    groupId: string,
    body: {
      description: string;
      paidByUserId: string;
      totalMinor: number;
      splitType: "EQUAL" | "EXACT" | "PERCENTAGE";
      participantUserIds?: string[];
      exactShares?: Array<{ userId: string; amountMinor: number }>;
      percentageShares?: Array<{ userId: string; percentageBps: number }>;
    },
    idempotencyKey: string,
  ) =>
    toExpenseGroup(
      await request<WireExpenseGroup>(
        `/expense-groups/${encodeURIComponent(groupId)}/expenses`,
        {
          method: "POST",
          idempotencyKey,
          body: {
            description: body.description,
            paidByUserId: body.paidByUserId,
            totalPoisha: body.totalMinor,
            splitType: body.splitType,
            ...(body.participantUserIds
              ? { participantUserIds: body.participantUserIds }
              : {}),
            ...(body.exactShares
              ? {
                  exactShares: body.exactShares.map((share) => ({
                    userId: share.userId,
                    amountPoisha: share.amountMinor,
                  })),
                }
              : {}),
            ...(body.percentageShares ? { percentageShares: body.percentageShares } : {}),
          },
        },
      ),
    ),

  settlementPlan: async (groupId: string) =>
    toSettlementPlan(
      await request<WireSettlementPlan>(
        `/expense-groups/${encodeURIComponent(groupId)}/settlement-plan`,
      ),
    ),

  settleExpenseGroup: async (
    groupId: string,
    planVersion: string,
    idempotencyKey: string,
    pin?: string,
  ) =>
    toReceipt(
      await request<WireReceipt>(`/expense-groups/${encodeURIComponent(groupId)}/settle`, {
        method: "POST",
        idempotencyKey,
        body: { planVersion, ...(pin ? { pin } : {}) },
      }),
    ),

  notifications: async (unreadOnly = false) =>
    toNotifications(
      await request<WireNotificationList>(
        `/notifications${unreadOnly ? "?unreadOnly=true" : ""}`,
      ),
    ),

  markNotificationRead: async (id: string) =>
    toNotifications(
      await request<WireNotificationList>(
        `/notifications/${encodeURIComponent(id)}/read`,
        { method: "POST" },
      ),
    ),

  markAllNotificationsRead: async () =>
    toNotifications(
      await request<WireNotificationList>("/notifications/read-all", { method: "POST" }),
    ),

  scheduledTransfers: async (): Promise<ScheduledTransfer[]> => {
    const wire = await request<{ scheduledTransfers: WireScheduledTransfer[] }>(
      "/scheduled-transfers",
    );
    return wire.scheduledTransfers.map(toScheduledTransfer);
  },

  createScheduledTransfer: async (
    body: {
      recipientPhone: string;
      amountMinor: number;
      executeAt: string;
      note?: string;
      pin?: string;
    },
    idempotencyKey: string,
  ) =>
    toScheduledTransfer(
      await request<WireScheduledTransfer>("/scheduled-transfers", {
        method: "POST",
        idempotencyKey,
        body: {
          recipientPhone: body.recipientPhone,
          amountPoisha: body.amountMinor,
          executeAt: body.executeAt,
          ...(body.note ? { note: body.note } : {}),
          ...(body.pin ? { pin: body.pin } : {}),
        },
      }),
    ),

  cancelScheduledTransfer: async (id: string) =>
    toScheduledTransfer(
      await request<WireScheduledTransfer>(
        `/scheduled-transfers/${encodeURIComponent(id)}/cancel`,
        { method: "POST" },
      ),
    ),

  /** Unauthenticated on purpose: the proof must be viewable without an account. */
  integrity: () => request<IntegrityReport>("/integrity"),

  systemInfo: () => request<SystemInfo>("/system-info"),

  /** Unauthenticated for the same reason as /integrity, and names no person. */
  systemMetrics: () => request<SystemMetrics>("/system-metrics"),
};

/** One key per compose session, reused unchanged across every retry of it. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
