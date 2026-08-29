/**
 * Frontend-only operational demonstration data. This is deliberately separate
 * from the consumer API client: replacing it with a read-only operations API
 * later changes this adapter, not the Admin/Judge UI.
 */

export type DemoScenarioId = "transfer" | "duplicate" | "concurrency";

export interface DemoStage {
  label: string;
  detail: string;
  status: "complete" | "active" | "safe";
}

export interface DemoScenario {
  id: DemoScenarioId;
  title: string;
  summary: string;
  stages: DemoStage[];
}

export interface AdminDemoSnapshot {
  generatedLabel: string;
  overview: {
    processed: number;
    completed: number;
    pending: number;
    failed: number;
    idempotentReplays: number;
    concurrencyChecks: number;
  };
  replicas: Array<{ id: string; state: "Healthy" | "Degraded" }>;
  transactions: Array<{ reference: string; participant: string; amountMinor: number; state: "Completed" | "Processing" | "Failed"; note: string }>;
  integrity: Array<{ assertion: string; result: string; passing: boolean }>;
  audit: Array<{ time: string; event: string; detail: string; kind: "success" | "warning" | "neutral" }>;
  scenarios: DemoScenario[];
}

export interface AdminOperationsService {
  getSnapshot(): Promise<AdminDemoSnapshot>;
}

const snapshot: AdminDemoSnapshot = {
  generatedLabel: "Frontend demonstration data · backend not connected",
  overview: { processed: 128, completed: 124, pending: 2, failed: 2, idempotentReplays: 18, concurrencyChecks: 20 },
  replicas: [{ id: "api-1", state: "Healthy" }, { id: "api-2", state: "Healthy" }, { id: "api-3", state: "Healthy" }],
  transactions: [
    { reference: "TRF-8FK21C", participant: "Nusrat Jahan → Adiba Tahsin", amountMinor: 500_000, state: "Completed", note: "Journal balanced" },
    { reference: "TRF-3DJ28A", participant: "Rahim Uddin → Chayon Das", amountMinor: 120_000, state: "Processing", note: "Waiting for final commit" },
    { reference: "TRF-5XM73B", participant: "Adiba Tahsin → Chayon Das", amountMinor: 250_000, state: "Failed", note: "Policy rejected before commit" },
  ],
  integrity: [
    { assertion: "Journal legs balance", result: "0 difference", passing: true },
    { assertion: "Negative accounts", result: "0 found", passing: true },
    { assertion: "Duplicate financial operations", result: "0 found", passing: true },
    { assertion: "Transfers missing journal entries", result: "0 found", passing: true },
  ],
  audit: [
    { time: "12:44:18", event: "Idempotency replay", detail: "Request key replayed; original TRF-8FK21C returned.", kind: "success" },
    { time: "12:44:11", event: "Transfer committed", detail: "Two journal entries persisted for TRF-8FK21C.", kind: "success" },
    { time: "12:43:56", event: "Policy rejected", detail: "TRF-5XM73B was blocked before any balance changed.", kind: "warning" },
    { time: "12:43:40", event: "Load check", detail: "20 concurrent attempts settled with consistent balances.", kind: "neutral" },
  ],
  scenarios: [
    { id: "transfer", title: "Normal transfer", summary: "The transfer moves only after validation and a complete journal write.", stages: [{ label: "Initiated", detail: "Intent received", status: "complete" }, { label: "Processing", detail: "Locks and policy checked", status: "active" }, { label: "Completed", detail: "Balanced journal committed", status: "safe" }] },
    { id: "duplicate", title: "Duplicate request", summary: "A repeated request key returns the original result instead of moving money again.", stages: [{ label: "Request replayed", detail: "Same idempotency key", status: "complete" }, { label: "Detected", detail: "Existing result found", status: "active" }, { label: "Original returned", detail: "No second movement", status: "safe" }] },
    { id: "concurrency", title: "Concurrent transfers", summary: "Competing requests settle without overspending or corrupting the ledger.", stages: [{ label: "20 attempts", detail: "Arrive together", status: "complete" }, { label: "Ordered", detail: "Accounts locked safely", status: "active" }, { label: "Consistent", detail: "10 committed, 10 rejected", status: "safe" }] },
  ],
};

export const adminOperationsDemo: AdminOperationsService = {
  async getSnapshot() {
    return snapshot;
  },
};
