// Scenario 6 — Money Request payment race
//
// Fifty callers use different Idempotency-Keys against one pending request.
// Idempotency cannot collapse these attempts; the Money Request row lock must
// allow exactly one normal Transfer and reject the other 49 terminal conflicts.

import { check } from 'k6';
import { Counter } from 'k6/metrics';
import {
  register,
  balance,
  uuid,
  createMoneyRequest,
  payMoneyRequestOnce,
  getMoneyRequest,
  integrity,
  integrityHealthy,
  describeIntegrity,
} from './lib/api.js';
import { summaryFor } from './lib/summary.js';
import { CODES, SIGNUP_GRANT } from './lib/config.js';

const STORM_SIZE = 50;
const AMOUNT = 4321;

const paid = new Counter('request_paid');
const terminalConflicts = new Counter('request_terminal_conflicts');
const serverErrors = new Counter('request_server_errors');

export const options = {
  scenarios: {
    paymentRace: {
      executor: 'per-vu-iterations',
      vus: STORM_SIZE,
      iterations: 1,
      maxDuration: '60s',
    },
  },
  thresholds: {
    request_paid: ['count==1'],
    request_terminal_conflicts: [`count==${STORM_SIZE - 1}`],
    request_server_errors: ['count==0'],
  },
};

export function setup() {
  const requester = register('requester');
  const payer = register('request-payer');
  const request = createMoneyRequest(
    requester.token,
    payer.phone,
    AMOUNT,
    'payment storm',
  );
  return { requester, payer, request };
}

export default function (data) {
  const res = payMoneyRequestOnce(
    data.payer.token,
    data.request.requestId,
    uuid(),
    data.payer.pin,
  );
  let code = null;
  try {
    const body = res.json();
    code = body && body.error ? body.error.code : null;
  } catch (e) {
    // The checks below reject non-JSON responses.
  }

  if (res.status >= 500) serverErrors.add(1);
  else if (res.status === 201) paid.add(1);
  else if (res.status === 409 && code === CODES.moneyRequestNotPending) {
    terminalConflicts.add(1);
  }

  check(res, {
    'one payment or a clean terminal conflict': (r) =>
      r.status === 201 || (r.status === 409 && code === CODES.moneyRequestNotPending),
    'never a 5xx': (r) => r.status < 500,
  });
}

export function teardown(data) {
  const request = getMoneyRequest(data.payer.token, data.request.requestId);
  const payerBalance = balance(data.payer.token);
  const requesterBalance = balance(data.requester.token);
  const report = integrity();
  const body = request.json();

  const ok = check(null, {
    'request is paid': () => request.status === 200 && body.status === 'PAID',
    'request links one transfer': () => !!body.transferReference,
    'payer debited exactly once': () => payerBalance === SIGNUP_GRANT - AMOUNT,
    'requester credited exactly once': () => requesterBalance === SIGNUP_GRANT + AMOUNT,
    'ledger still balanced': () => integrityHealthy(report),
  });

  console.log(
    `\n[06] ${STORM_SIZE} different-key payment attempts against one request.\n` +
      `     request:   ${body.status} -> ${body.transferReference}\n` +
      `     integrity: ${describeIntegrity(report)}\n` +
      `     verdict:   ${ok ? 'exactly one Transfer created' : 'FAILED'}\n`,
  );
}

// Written to /results so tests/bench can assemble one report from all six runs.
export const handleSummary = summaryFor('06-money-request-payment-storm', '50 different-key payment attempts create exactly one Transfer');
