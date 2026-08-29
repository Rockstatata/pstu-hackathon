/**
 * ============================ READ THIS FIRST =============================
 * FIXTURES ARE FOR VISUAL REVIEW ONLY. THEY ARE NOT A SIMULATOR AND NOT A
 * LEDGER. They exist so the UI can be looked at before the backend lands.
 *
 * The architectural rule (CLAUDE.md) is that the backend determines financial
 * truth and the client never holds authoritative balance logic. This module
 * technically breaks that rule, which is why:
 *
 *   1. It is OFF unless NEXT_PUBLIC_USE_FIXTURES=1 is explicitly set.
 *   2. When it is on, a permanent banner is rendered on every screen, so this
 *      can never be shown to a judge by accident.
 *   3. It must be deleted, or the flag left unset, for the demo build.
 *
 * Nothing outside this file may import from it except lib/api.ts.
 * ==========================================================================
 */

import type {
  AccountSummary,
  AuthResponse,
  CreateGroupTransferRequest,
  CreateMoneyRequestRequest,
  CreateScheduledTransferRequest,
  IntegrityReport,
  MoneyRequest,
  MoneyRequestListResponse,
  Notification,
  NotificationListResponse,
  RecipientPreview,
  ScheduledTransfer,
  SystemInfo,
  Transfer,
  TransferListResponse,
} from "./types";

export const FIXTURES_ON = process.env.NEXT_PUBLIC_USE_FIXTURES === "1";

const ME: AuthResponse["user"] = {
  id: "u_self",
  fullName: "Adiba Tahsin",
  phone: "01712345432",
};

const DIRECTORY: Record<string, RecipientPreview> = {
  "01798765432": { userId: "u_rahim", fullName: "Rahim Uddin", maskedPhone: "017•••••432" },
  "01611122233": { userId: "u_nusrat", fullName: "Nusrat Jahan", maskedPhone: "016•••••233" },
  "01855566677": { userId: "u_chayon", fullName: "Chayon Das", maskedPhone: "018•••••677" },
};

const store = {
  balanceMinor: 10_000_000, // ৳100,000 issued at registration
  transfers: [
    {
      reference: "TRF-8FK21C",
      status: "COMPLETED",
      direction: "IN",
      amountMinor: 500_000,
      counterpartyName: "Nusrat Jahan",
      counterpartyMaskedPhone: "016•••••233",
      note: "Lunch",
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    },
    {
      reference: "TRF-2QP90A",
      status: "COMPLETED",
      direction: "OUT",
      amountMinor: 120_000,
      counterpartyName: "Rahim Uddin",
      counterpartyMaskedPhone: "017•••••432",
      note: null,
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    },
    {
      reference: "TRF-5XM73B",
      status: "REVERSED",
      direction: "OUT",
      amountMinor: 250_000,
      counterpartyName: "Chayon Das",
      counterpartyMaskedPhone: "018•••••677",
      note: "Wrong number",
      createdAt: new Date(Date.now() - 172_800_000).toISOString(),
      reversedByReference: "TRF-9RV11D",
    },
  ] as Transfer[],
  completedTransfers: 3,
  requests: [
    {
      id: "MRQ-4K8P2",
      direction: "INCOMING",
      status: "PENDING",
      counterpartyName: "Nusrat Jahan",
      counterpartyMaskedPhone: "016â€¢â€¢â€¢â€¢â€¢233",
      amountMinor: 85_000,
      reason: "Shared internet bill",
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
      expiresAt: new Date(Date.now() + 23 * 3_600_000).toISOString(),
    },
    {
      id: "MRQ-7D1M9",
      direction: "OUTGOING",
      status: "PENDING",
      counterpartyName: "Rahim Uddin",
      counterpartyMaskedPhone: "017â€¢â€¢â€¢â€¢â€¢432",
      amountMinor: 120_000,
      reason: "Weekend cricket booking",
      createdAt: new Date(Date.now() - 7_200_000).toISOString(),
      expiresAt: new Date(Date.now() + 22 * 3_600_000).toISOString(),
    },
  ] as MoneyRequest[],
  scheduled: [
    {
      id: "SCH-21VA",
      status: "SCHEDULED",
      recipientName: "Chayon Das",
      recipientMaskedPhone: "018â€¢â€¢â€¢â€¢â€¢677",
      amountMinor: 250_000,
      note: "Rent share",
      scheduledFor: new Date(Date.now() + 86_400_000 * 2).toISOString(),
    },
    {
      id: "SCH-09MK",
      status: "FAILED",
      recipientName: "Rahim Uddin",
      recipientMaskedPhone: "017â€¢â€¢â€¢â€¢â€¢432",
      amountMinor: 500_000,
      note: null,
      scheduledFor: new Date(Date.now() - 86_400_000).toISOString(),
      failureReason: "There was not enough balance when this transfer was due.",
    },
  ] as ScheduledTransfer[],
  notifications: [
    {
      id: "NTF-91RA",
      type: "REQUEST_RECEIVED",
      title: "Nusrat Jahan requested money",
      detail: "৳850.00 · Shared internet bill",
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
      readAt: null,
      href: "/requests/MRQ-4K8P2",
    },
    {
      id: "NTF-33BZ",
      type: "MONEY_RECEIVED",
      title: "Money received from Nusrat Jahan",
      detail: "৳5,000.00 · Lunch",
      createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      readAt: new Date(Date.now() - 90 * 60_000).toISOString(),
      href: "/history/TRF-8FK21C",
    },
  ] as Notification[],
};

const seen = new Set<string>();

function delay<T>(value: T, ms = 260): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export function fixture<T>(path: string, method: string, body?: unknown): Promise<T> {
  const route = `${method} ${path.split("?")[0]}`;

  switch (true) {
    case route === "POST /auth/register" || route === "POST /auth/login":
      return delay({ token: "fixture-token", user: ME } as unknown as T);

    case route === "GET /auth/me":
      return delay(ME as unknown as T);

    case route === "GET /accounts/me":
      return delay({
        accountId: "acc_self",
        balanceMinor: store.balanceMinor,
        asOf: new Date().toISOString(),
      } satisfies AccountSummary as unknown as T);

    case route === "GET /users/search": {
      const q = decodeURIComponent(path.split("q=")[1] ?? "");
      const hit = DIRECTORY[q.replace(/\D/g, "")];
      if (!hit) {
        return Promise.reject(
          Object.assign(new Error("RECIPIENT_NOT_FOUND"), { code: "RECIPIENT_NOT_FOUND" }),
        );
      }
      return delay(hit as unknown as T);
    }

    case route === "GET /transfers":
      return delay({ items: store.transfers, nextCursor: null } satisfies TransferListResponse as unknown as T);

    case route === "POST /transfers/group": {
      const req = body as CreateGroupTransferRequest;
      const recipients = req.recipients.map((item) => Object.values(DIRECTORY).find((candidate) => candidate.userId === item.recipientUserId));
      if (recipients.some((recipient) => !recipient)) return Promise.reject(new Error("RECIPIENT_NOT_FOUND"));
      const totalMinor = req.recipients.reduce((sum, item) => sum + item.amountMinor, 0);
      const created: Transfer = {
        reference: `GRP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        status: "COMPLETED",
        direction: "OUT",
        amountMinor: totalMinor,
        counterpartyName: `${req.recipients.length} recipients`,
        counterpartyMaskedPhone: "Group transfer",
        note: req.note ?? null,
        createdAt: new Date().toISOString(),
      };
      store.balanceMinor -= totalMinor;
      store.transfers = [created, ...store.transfers];
      store.completedTransfers += 1;
      return delay(created as unknown as T, 700);
    }

    case route === "POST /transfers": {
      const req = body as { recipientUserId: string; amountMinor: number; note?: string };
      const recipient = Object.values(DIRECTORY).find((r) => r.userId === req.recipientUserId)!;
      const created: Transfer = {
        reference: `TRF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        status: "COMPLETED",
        direction: "OUT",
        amountMinor: req.amountMinor,
        counterpartyName: recipient.fullName,
        counterpartyMaskedPhone: recipient.maskedPhone,
        note: req.note ?? null,
        createdAt: new Date().toISOString(),
      };
      store.balanceMinor -= req.amountMinor;
      store.transfers = [created, ...store.transfers];
      store.completedTransfers += 1;
      return delay(created as unknown as T, 700);
    }

    case route === "GET /money-requests":
      return delay({ items: store.requests, nextCursor: null } satisfies MoneyRequestListResponse as unknown as T);

    case route === "POST /money-requests": {
      const req = body as CreateMoneyRequestRequest;
      const recipient = Object.values(DIRECTORY).find((candidate) => candidate.userId === req.recipientUserId);
      if (!recipient) return Promise.reject(new Error("RECIPIENT_NOT_FOUND"));
      const created: MoneyRequest = {
        id: `MRQ-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        direction: "OUTGOING",
        status: "PENDING",
        counterpartyName: recipient.fullName,
        counterpartyMaskedPhone: recipient.maskedPhone,
        amountMinor: req.amountMinor,
        reason: req.reason,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      };
      store.requests = [created, ...store.requests];
      return delay(created as unknown as T);
    }

    case route.startsWith("GET /money-requests/"): {
      const id = path.split("/money-requests/")[1];
      const request = store.requests.find((item) => item.id === id);
      if (!request) return Promise.reject(new Error("REQUEST_NOT_FOUND"));
      return delay(request as unknown as T);
    }

    case route.endsWith("/pay") && route.startsWith("POST /money-requests/"): {
      const id = path.split("/money-requests/")[1].split("/")[0];
      const request = store.requests.find((item) => item.id === id);
      if (!request || request.status !== "PENDING") return Promise.reject(new Error("REQUEST_ALREADY_RESOLVED"));
      request.status = "PAID";
      const created: Transfer = {
        reference: `TRF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        status: "COMPLETED",
        direction: "OUT",
        amountMinor: request.amountMinor,
        counterpartyName: request.counterpartyName,
        counterpartyMaskedPhone: request.counterpartyMaskedPhone,
        note: request.reason,
        createdAt: new Date().toISOString(),
      };
      request.transferReference = created.reference;
      store.balanceMinor -= created.amountMinor;
      store.transfers = [created, ...store.transfers];
      store.completedTransfers += 1;
      return delay(created as unknown as T, 700);
    }

    case route.endsWith("/decline") && route.startsWith("POST /money-requests/"):
    case route.endsWith("/cancel") && route.startsWith("POST /money-requests/"): {
      const id = path.split("/money-requests/")[1].split("/")[0];
      const request = store.requests.find((item) => item.id === id);
      if (!request || request.status !== "PENDING") return Promise.reject(new Error("REQUEST_ALREADY_RESOLVED"));
      request.status = route.endsWith("/decline") ? "DECLINED" : "CANCELLED";
      return delay(request as unknown as T);
    }

    case route === "GET /scheduled-transfers":
      return delay(store.scheduled as unknown as T);

    case route === "POST /scheduled-transfers": {
      const req = body as CreateScheduledTransferRequest;
      const recipient = Object.values(DIRECTORY).find((candidate) => candidate.userId === req.recipientUserId);
      if (!recipient) return Promise.reject(new Error("RECIPIENT_NOT_FOUND"));
      const created: ScheduledTransfer = {
        id: `SCH-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        status: "SCHEDULED",
        recipientName: recipient.fullName,
        recipientMaskedPhone: recipient.maskedPhone,
        amountMinor: req.amountMinor,
        note: req.note ?? null,
        scheduledFor: req.scheduledFor,
      };
      store.scheduled = [created, ...store.scheduled];
      return delay(created as unknown as T);
    }

    case route.endsWith("/cancel") && route.startsWith("POST /scheduled-transfers/"): {
      const id = path.split("/scheduled-transfers/")[1].split("/")[0];
      const scheduled = store.scheduled.find((item) => item.id === id);
      if (!scheduled || scheduled.status !== "SCHEDULED") return Promise.reject(new Error("SCHEDULED_TRANSFER_NOT_FOUND"));
      scheduled.status = "CANCELLED";
      return delay(scheduled as unknown as T);
    }

    case route === "GET /notifications":
      return delay({ items: store.notifications, nextCursor: null } satisfies NotificationListResponse as unknown as T);

    case route.endsWith("/read") && route.startsWith("POST /notifications/"): {
      const id = path.split("/notifications/")[1].split("/")[0];
      const notification = store.notifications.find((item) => item.id === id);
      if (notification) notification.readAt = new Date().toISOString();
      return delay(undefined as T);
    }

    case route.startsWith("GET /transfers/"): {
      const ref = path.split("/transfers/")[1];
      const hit = store.transfers.find((t) => t.reference === ref);
      if (!hit) return Promise.reject(new Error("not found"));
      return delay(hit as unknown as T);
    }

    case route === "GET /internal/integrity":
      return delay({
        status: "PASS",
        negativeAccounts: 0,
        unbalancedTransfers: 0,
        missingLedgerEntries: 0,
        duplicateFinancialOperations: 0,
        issuedFundsMinor: 10_000_000,
        walletFundsMinor: 10_000_000,
        differenceMinor: 0,
        completedTransfers: store.completedTransfers,
        idempotentReplays: seen.size,
        rejectedOverspends: 0,
      } satisfies IntegrityReport as unknown as T);

    case route === "GET /internal/system-info":
      return delay({
        replicas: [
          { instanceId: "api-1", healthy: true },
          { instanceId: "api-2", healthy: true },
          { instanceId: "api-3", healthy: true },
        ],
      } satisfies SystemInfo as unknown as T);

    default:
      return Promise.reject(new Error(`No fixture for ${route}`));
  }
}
