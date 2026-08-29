/**
 * Wire types, mirroring docs/api-contract.md (derived from solution-prd 26-27).
 * All money fields are integer poisha and are named *Minor to make that loud
 * at every call site.
 */

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

export type ScheduledTransferStatus = "SCHEDULED" | "EXECUTED" | "FAILED" | "CANCELLED";

export interface AuthUser {
  id: string;
  fullName: string;
  phone: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface AccountSummary {
  accountId: string;
  balanceMinor: number;
  /** Server time the balance was computed. Drives the offline "last updated" line. */
  asOf: string;
}

/** Deliberately narrow: only what is safe to show a sender before they commit. */
export interface RecipientPreview {
  userId: string;
  fullName: string;
  maskedPhone: string;
}

export interface Transfer {
  reference: string;
  status: TransferStatus;
  direction: Direction;
  amountMinor: number;
  counterpartyName: string;
  counterpartyMaskedPhone: string;
  note: string | null;
  createdAt: string;
  /** Set when this transfer compensates another, or has been compensated. */
  reversalOfReference?: string | null;
  reversedByReference?: string | null;
  /** Present only once Phase 10 ships; the reason a step-up was demanded. */
  riskReason?: string | null;
}

export interface TransferListResponse {
  items: Transfer[];
  nextCursor: string | null;
}

export interface CreateTransferRequest {
  recipientUserId: string;
  amountMinor: number;
  note?: string;
}

export interface GroupTransferRecipient {
  recipientUserId: string;
  amountMinor: number;
}

/** UI contract for the future atomic group-transfer endpoint. */
export interface CreateGroupTransferRequest {
  recipients: GroupTransferRecipient[];
  note?: string;
}

export interface MoneyRequest {
  id: string;
  direction: RequestDirection;
  status: MoneyRequestStatus;
  counterpartyName: string;
  counterpartyMaskedPhone: string;
  amountMinor: number;
  reason: string;
  createdAt: string;
  expiresAt: string;
  transferReference?: string | null;
  originalTransferReference?: string | null;
}

export interface MoneyRequestListResponse {
  items: MoneyRequest[];
  nextCursor: string | null;
}

export interface CreateMoneyRequestRequest {
  recipientUserId: string;
  amountMinor: number;
  reason: string;
}

export interface ScheduledTransfer {
  id: string;
  status: ScheduledTransferStatus;
  recipientName: string;
  recipientMaskedPhone: string;
  amountMinor: number;
  note: string | null;
  scheduledFor: string;
  failureReason?: string | null;
  transferReference?: string | null;
}

export interface CreateScheduledTransferRequest {
  recipientUserId: string;
  amountMinor: number;
  scheduledFor: string;
  note?: string;
}

export interface Notification {
  id: string;
  type: "MONEY_RECEIVED" | "REQUEST_RECEIVED" | "REQUEST_PAID" | "REQUEST_DECLINED" | "REQUEST_EXPIRED" | "REVERSAL_REQUEST" | "SCHEDULED_EXECUTED";
  title: string;
  detail: string;
  createdAt: string;
  readAt: string | null;
  href?: string | null;
}

export interface NotificationListResponse {
  items: Notification[];
  nextCursor: string | null;
}

export interface IntegrityReport {
  status: "PASS" | "FAIL";
  negativeAccounts: number;
  unbalancedTransfers: number;
  missingLedgerEntries: number;
  duplicateFinancialOperations: number;
  issuedFundsMinor: number;
  walletFundsMinor: number;
  differenceMinor: number;
  completedTransfers: number;
  idempotentReplays: number;
  rejectedOverspends: number;
  /** Only present once Phase 10 ships. Tile is hidden when absent. */
  stepUpsTriggered?: number;
}

export interface ReplicaInfo {
  instanceId: string;
  healthy: boolean;
}

export interface SystemInfo {
  replicas: ReplicaInfo[];
}

/** The error envelope every failure arrives in (solution-prd 26). */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    traceId?: string;
  };
}
