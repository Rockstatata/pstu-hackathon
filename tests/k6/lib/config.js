// ---------------------------------------------------------------------------
// Bound to docs/api-contract.md. If a scenario breaks after a backend change,
// the fix almost certainly belongs in this file, not in the scenarios.
// ---------------------------------------------------------------------------

export const BASE_URL = __ENV.BASE_URL || 'http://gateway/api/v1';

export const PATHS = {
  live: '/health/live',
  ready: '/health/ready',
  register: '/auth/register',
  login: '/auth/login',
  me: '/accounts/me',
  lookup: '/users/lookup',
  transfer: '/transfers',
  transactions: '/transfers',
  moneyRequests: '/money-requests',
  integrity: '/integrity',
  systemInfo: '/system-info',
};

// Responses are camelCase. Requests accept either convention.
export const FIELDS = {
  token: 'token',
  transferId: 'transferId',
  reference: 'reference',
  balance: 'balancePoisha',
};

export const HEADERS = {
  idempotencyKey: 'Idempotency-Key',
  // "true" = stored response returned, nothing moved. "false" = this call
  // committed the money. Present on every 201.
  idempotentReplay: 'X-Idempotent-Replay',
  servedBy: 'X-Served-By',
  instance: 'X-Instance',
};

// Error codes, from the contract's table.
export const CODES = {
  insufficientFunds: 'INSUFFICIENT_FUNDS',
  limitExceeded: 'TRANSFER_LIMIT_EXCEEDED',
  stepUpRequired: 'STEP_UP_REQUIRED',
  stepUpFailed: 'STEP_UP_FAILED',
  keyReused: 'IDEMPOTENCY_KEY_REUSED',
  inProgress: 'REQUEST_IN_PROGRESS',
  recipientNotFound: 'RECIPIENT_NOT_FOUND',
  moneyRequestNotPending: 'MONEY_REQUEST_NOT_PENDING',
  internal: 'INTERNAL_ERROR',
};

export const STATUS = {
  created: [201],
  // Correct, deliberate refusals. NOT failures — a storm of these under a
  // double-spend race is the system working.
  insufficientFunds: 400,
  limitExceeded: 400,
  stepUpRequired: 403,
  keyReused: 409,
  inProgress: 409,
};

export const TAKA = 100;
export const SIGNUP_GRANT = 10000000; // ৳100,000, per the contract's grant object

// Step-Up fires on amount >= ৳25,000, on a first-time recipient, or on 5
// transfers in 10 minutes. In these scenarios essentially EVERY transfer trips
// at least one of those, so the helper in api.js always handles the 403 retry.
export const PIN = '48213';
