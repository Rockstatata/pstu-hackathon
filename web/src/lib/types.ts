/**
 * Two layers live in this file, and the distinction is the whole point.
 *
 *   Wire types   — exactly what `docs/openapi.json` sends. Money is `*Poisha`.
 *   View models  — what components render. Money is `*Minor` (still integer poisha).
 *
 * Nothing outside `lib/api.ts` may import a wire type. Components see view models
 * only, so a backend rename is one mapper edit rather than a sweep through 35 files.
 */

/* ========================================================================== */
/* Wire — the shipped backend contract                                        */
/* ========================================================================== */

export interface WireUser {
  id: string;
  name: string;
  phone: string;
}

export interface WireAuthResponse {
  token: string;
  user: WireUser;
  /** Present on registration only: the ৳100,000 issuance leg. */
  grant?: { amountPoisha: number; reference: string };
}

export interface WireAccount {
  accountId: string;
  balancePoisha: number;
  currency: string;
  asOf: string;
}

export interface WireIdentity {
  name: string;
  maskedPhone: string;
}

export interface WireRecentRecipients {
  recipients: Array<{ name: string; phone: string; maskedPhone: string }>;
}

export interface WireCounterparty {
  name: string;
  maskedPhone: string;
  amountPoisha: number;
}

/** One leg of the signed-in Account, as `GET /transfers` returns it. */
export interface WireTransaction {
  reference: string;
  kind: TransferKind;
  status: string;
  note: string | null;
  riskReason: string | null;
  direction: "sent" | "received";
  /** Signed: negative on the sender's leg. */
  amountPoisha: number;
  createdAt: string;
  counterparties: WireCounterparty[];
  reversible?: boolean;
  notReversibleReason?: string | null;
  originalTransferReference?: string | null;
  reversalRequestId?: string | null;
  reversalRequestStatus?: MoneyRequestStatus | null;
}

/** What `POST /transfers` and `POST /money-requests/{id}/pay` return. */
export interface WireReceipt {
  transferId: string;
  reference: string;
  kind: TransferKind;
  status: string;
  totalPoisha: number;
  note: string | null;
  riskReason: string | null;
  senderBalanceAfterPoisha: number;
  completedAt: string;
  recipients: WireCounterparty[];
  moneyRequestId?: string;
  moneyRequestReference?: string;
}

export interface WireMoneyRequest {
  requestId: string;
  reference: string;
  direction: "incoming" | "outgoing";
  status: MoneyRequestStatus;
  amountPoisha: number;
  reason: string;
  requester: WireIdentity;
  payer: WireIdentity;
  transferReference: string | null;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  requestKind: "STANDARD" | "REVERSAL";
  originalTransferReference: string | null;
}

export interface WireCashEvent {
  eventId: string;
  sequenceNumber: number;
  kind: "CASH_IN" | "CASH_OUT" | "RECONCILIATION";
  amountPoisha: number;
  expectedBeforePoisha: number;
  expectedAfterPoisha: number;
  countedCashPoisha: number | null;
  source: "SIMULATOR" | "DEVICE" | "USER";
  reason: string | null;
  observedAt: string;
  recordedAt: string;
}

export interface WireSmartWallet {
  walletId: string;
  connectionStatus: "CONNECTED" | "DISCONNECTED";
  expectedCashPoisha: number;
  lastSequence: number;
  lastSyncedAt: string | null;
  inventoryDifferencePoisha: number;
  activity: WireCashEvent[];
}

export interface WireCashMutation {
  event: WireCashEvent;
  wallet: WireSmartWallet;
}

export interface WireExpenseGroupMember {
  userId: string;
  name: string;
  maskedPhone: string;
  isCurrentUser: boolean;
}

export interface WireExpenseGroupSummary {
  groupId: string;
  name: string;
  memberCount: number;
  expenseCount: number;
  createdAt: string;
}

export interface WireGroupExpense {
  expenseId: string;
  description: string;
  totalPoisha: number;
  splitType: "EQUAL" | "EXACT" | "PERCENTAGE";
  paidBy: WireExpenseGroupMember;
  shares: Array<{ member: WireExpenseGroupMember; amountPoisha: number }>;
  createdAt: string;
}

export interface WireExpenseGroup {
  groupId: string;
  name: string;
  createdAt: string;
  members: WireExpenseGroupMember[];
  expenses: WireGroupExpense[];
}

export interface WireSettlementPlan {
  groupId: string;
  groupName: string;
  planVersion: string;
  positions: Array<{
    member: WireExpenseGroupMember;
    netPoisha: number;
    direction: "RECEIVE" | "PAY" | "SETTLED";
  }>;
  transfers: Array<{
    from: WireExpenseGroupMember;
    to: WireExpenseGroupMember;
    amountPoisha: number;
    isCurrentUserPayer: boolean;
  }>;
  optimizedTransferCount: number;
  currentUserOutgoingPoisha: number;
  canCurrentUserSettle: boolean;
}

export interface WireNotification {
  notificationId: string;
  kind:
    | "MONEY_RECEIVED"
    | "REQUEST_RECEIVED"
    | "REQUEST_RESOLVED"
    | "REVERSAL_REQUESTED"
    | "SCHEDULE_EXECUTED"
    | "SCHEDULE_FAILED";
  title: string;
  message: string;
  resourceType: string | null;
  resourceId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface WireNotificationList {
  notifications: WireNotification[];
  unreadCount: number;
}

export interface WireScheduledTransfer {
  scheduledTransferId: string;
  reference: string;
  status: "SCHEDULED" | "EXECUTED" | "FAILED" | "CANCELLED";
  amountPoisha: number;
  note: string | null;
  executeAt: string;
  recipient: WireIdentity;
  transferReference: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  authorizedAt: string;
  resolvedAt: string | null;
  createdAt: string;
}

export type OutlookTrendBand = "HIGHER" | "LOWER" | "STEADY" | "NO_BASELINE";
export type OutlookBufferBand =
  | "THREE_PLUS_MONTHS"
  | "ONE_TO_THREE_MONTHS"
  | "UNDER_ONE_MONTH"
  | "NO_BASELINE";

export interface WireFinancialOutlook {
  asOf: string;
  period: {
    currentMonth: string;
    currentStart: string;
    comparisonMonth: string;
    comparisonStart: string;
    comparisonEnd: string;
  };
  balancePoisha: number;
  current: {
    outgoingPoisha: number;
    incomingPoisha: number;
    transferCount: number;
    netPoisha: number;
  };
  comparison: {
    previousOutgoingPoisha: number;
    previousIncomingPoisha: number;
    previousTransferCount: number;
    differencePoisha: number;
    changeBps: number | null;
    band: OutlookTrendBand;
  };
  typicalMoneyOut: {
    averagePoisha: number | null;
    completeMonthsObserved: number;
    targetMonths: number;
  };
  buffer: {
    monthsHundredths: number | null;
    band: OutlookBufferBand;
  };
  largestRecipient: {
    name: string;
    maskedPhone: string;
    amountPoisha: number;
    shareBps: number;
  } | null;
  history: Array<{
    month: string;
    outgoingPoisha: number;
    incomingPoisha: number;
    transferCount: number;
  }>;
  rules: {
    timezone: string;
    comparison: string;
    typicalMoneyOut: string;
    trendBandsBps: { higherAt: number; lowerAt: number };
    bufferBandsHundredths: { threePlusAt: number; onePlusAt: number };
    issuanceExcluded: boolean;
  };
}

/* ========================================================================== */
/* View models — what the screens render                                      */
/* ========================================================================== */

export type TransferKind = "P2P" | "GROUP" | "ISSUANCE" | "REVERSAL";
export type TransferStatus = "COMPLETED" | "REVERSED";

export type BadgeStatus =
  | "COMPLETED"
  | "EXECUTED"
  | "PAID"
  | "PENDING"
  | "SCHEDULED"
  | "FAILED"
  | "DECLINED"
  | "REVERSED"
  | "EXPIRED"
  | "CANCELLED";

export type Direction = "IN" | "OUT";

export type RequestDirection = "INCOMING" | "OUTGOING";

export type MoneyRequestStatus = "PENDING" | "PAID" | "DECLINED" | "EXPIRED" | "CANCELLED";

export interface AuthUser {
  id: string;
  fullName: string;
  phone: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
  grantMinor: number | null;
}

export interface AccountSummary {
  accountId: string;
  balanceMinor: number;
  /** Server time the balance was computed. Drives the offline "last updated" line. */
  asOf: string;
}

/**
 * Deliberately narrow: only what is safe to show a sender before they commit.
 * There is no user id — the backend never issues one to a sender, and the phone
 * the sender typed is the only identifier a transfer is addressed by.
 */
export interface RecipientPreview {
  phone: string;
  fullName: string;
  maskedPhone: string;
}

export interface Transfer {
  reference: string;
  kind: TransferKind;
  status: TransferStatus;
  direction: Direction;
  /** Absolute poisha of this Account's leg. */
  amountMinor: number;
  counterpartyName: string;
  counterpartyMaskedPhone: string;
  /** Every recipient of a Group Transfer; one entry for a direct transfer. */
  counterparties: Array<{ name: string; maskedPhone: string; amountMinor: number }>;
  note: string | null;
  createdAt: string;
  riskReason: string | null;
  /** Always false in this release; the reason explains why (ADR-0005). */
  reversible: boolean;
  notReversibleReason: string | null;
  originalTransferReference: string | null;
  reversalRequestId: string | null;
  reversalRequestStatus: MoneyRequestStatus | null;
}

export interface TransferListResponse {
  items: Transfer[];
}

/** The receipt returned by a write. Reads come back as `Transfer`. */
export interface TransferReceipt {
  reference: string;
  kind: TransferKind;
  totalMinor: number;
  note: string | null;
  riskReason: string | null;
  senderBalanceAfterMinor: number;
  completedAt: string;
  recipients: Array<{ name: string; maskedPhone: string; amountMinor: number }>;
}

export interface CreateTransferRequest {
  recipientPhone: string;
  amountMinor: number;
  note?: string;
  /** Sent only when the server asked for a Step-Up. */
  pin?: string;
}

export interface CreateGroupTransferRequest {
  recipients: Array<{ phone: string; amountMinor: number }>;
  note?: string;
  pin?: string;
}

export interface MoneyRequest {
  id: string;
  reference: string;
  direction: RequestDirection;
  status: MoneyRequestStatus;
  counterpartyName: string;
  counterpartyMaskedPhone: string;
  amountMinor: number;
  reason: string;
  createdAt: string;
  expiresAt: string;
  transferReference: string | null;
  requestKind: "STANDARD" | "REVERSAL";
  originalTransferReference: string | null;
}

export interface MoneyRequestListResponse {
  items: MoneyRequest[];
}

export interface CreateMoneyRequestRequest {
  payerPhone: string;
  amountMinor: number;
  reason: string;
}

export type CashEventKind = "CASH_IN" | "CASH_OUT" | "RECONCILIATION";

export interface CashEvent {
  id: string;
  sequence: number;
  kind: CashEventKind;
  amountMinor: number;
  expectedBeforeMinor: number;
  expectedAfterMinor: number;
  countedCashMinor: number | null;
  source: "SIMULATOR" | "DEVICE" | "USER";
  reason: string | null;
  observedAt: string;
  recordedAt: string;
}

export interface SmartWallet {
  id: string;
  connectionStatus: "CONNECTED" | "DISCONNECTED";
  expectedCashMinor: number;
  lastSequence: number;
  lastSyncedAt: string | null;
  inventoryDifferenceMinor: number;
  activity: CashEvent[];
}

export interface CashMutation {
  event: CashEvent;
  wallet: SmartWallet;
}

export interface ExpenseGroupMember {
  id: string;
  name: string;
  maskedPhone: string;
  isCurrentUser: boolean;
}

export interface ExpenseGroupSummary {
  id: string;
  name: string;
  memberCount: number;
  expenseCount: number;
  createdAt: string;
}

export interface GroupExpense {
  id: string;
  description: string;
  totalMinor: number;
  splitType: "EQUAL" | "EXACT" | "PERCENTAGE";
  paidBy: ExpenseGroupMember;
  shares: Array<{ member: ExpenseGroupMember; amountMinor: number }>;
  createdAt: string;
}

export interface ExpenseGroup {
  id: string;
  name: string;
  createdAt: string;
  members: ExpenseGroupMember[];
  expenses: GroupExpense[];
}

export interface SettlementPlan {
  groupId: string;
  groupName: string;
  version: string;
  positions: Array<{
    member: ExpenseGroupMember;
    netMinor: number;
    direction: "RECEIVE" | "PAY" | "SETTLED";
  }>;
  transfers: Array<{
    from: ExpenseGroupMember;
    to: ExpenseGroupMember;
    amountMinor: number;
    isCurrentUserPayer: boolean;
  }>;
  optimizedTransferCount: number;
  currentUserOutgoingMinor: number;
  canCurrentUserSettle: boolean;
}

export interface Notification {
  id: string;
  kind: WireNotification["kind"];
  title: string;
  message: string;
  resourceType: string | null;
  resourceId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList {
  items: Notification[];
  unreadCount: number;
}

export interface ScheduledTransfer {
  id: string;
  reference: string;
  status: WireScheduledTransfer["status"];
  amountMinor: number;
  note: string | null;
  executeAt: string;
  recipientName: string;
  recipientMaskedPhone: string;
  transferReference: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  authorizedAt: string;
  resolvedAt: string | null;
  createdAt: string;
}

export interface FinancialOutlook {
  asOf: string;
  period: WireFinancialOutlook["period"];
  balanceMinor: number;
  current: {
    outgoingMinor: number;
    incomingMinor: number;
    transferCount: number;
    netMinor: number;
  };
  comparison: {
    previousOutgoingMinor: number;
    previousIncomingMinor: number;
    previousTransferCount: number;
    differenceMinor: number;
    changeBps: number | null;
    band: OutlookTrendBand;
  };
  typicalMoneyOut: {
    averageMinor: number | null;
    completeMonthsObserved: number;
    targetMonths: number;
  };
  buffer: {
    monthsHundredths: number | null;
    band: OutlookBufferBand;
  };
  largestRecipient: {
    name: string;
    maskedPhone: string;
    amountMinor: number;
    shareBps: number;
  } | null;
  history: Array<{
    month: string;
    outgoingMinor: number;
    incomingMinor: number;
    transferCount: number;
  }>;
  rules: WireFinancialOutlook["rules"];
}

/* -------------------------------------------------------------------------- */
/* Judge-facing system views                                                   */
/* -------------------------------------------------------------------------- */

export interface IntegrityAssertion {
  key: string;
  label: string;
  /** Zero is the healthy answer for every assertion. */
  value: number;
  pass: boolean;
}

export interface IntegrityReport {
  verdict: "HEALTHY" | "DEGRADED";
  assertions: IntegrityAssertion[];
  counters: {
    completedTransfers: number;
    idempotentReplays: number;
    rejectedOverspends: number;
    stepUpsTriggered: number;
    policyRejections: number;
    registeredUsers: number;
    journalEntries: number;
  };
  totals: { issuedPoisha: number; heldPoisha: number; differencePoisha: number };
  instance: string;
}

export interface ReplicaInfo {
  instance: string;
  startedAt: string;
  lastSeen: string;
  healthy: boolean;
}

export interface SystemInfo {
  instance: string;
  health: "HEALTHY" | "DEGRADED";
  expectedReplicas: number;
  healthyReplicas: number;
  freshnessWindowSeconds: number;
  policy: {
    maxTransferPoisha: number;
    maxDailySendPoisha: number;
    maxGroupRecipients: number;
    stepUpAmountPoisha: number;
    stepUpVelocityCount: number;
    stepUpVelocityMinutes: number;
    lockTimeoutMs: number;
  };
  replicas: ReplicaInfo[];
}

/** The error envelope every failure arrives in. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    traceId?: string;
    /** Present on 403 STEP_UP_REQUIRED. */
    stepUpReason?: string;
  };
}
