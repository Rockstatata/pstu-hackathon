// Scenario 2 — Double-spend attack
//
// An account holding ৳1,000 is hit with 20 simultaneous ৳100 sends, each with
// its own Idempotency-Key so idempotency cannot save us. Only the row lock can.
//
// Correct behaviour: exactly 10 commit, exactly 10 are refused with
// INSUFFICIENT_FUNDS (400), and the balance lands on exactly zero.
//
// The distinction that makes this test meaningful: a 400 INSUFFICIENT_FUNDS is
// the system WORKING. A 500 would mean we "prevented" the overspend by falling
// over, which proves nothing.
//
//   k6 run -e BASE_URL=... tests/k6/02-double-spend.js

import { check } from 'k6';
import { Counter } from 'k6/metrics';
import {
  register,
  transfer,
  balance,
  integrity,
  integrityHealthy,
  describeIntegrity,
} from './lib/api.js';
import { summaryFor } from './lib/summary.js';
import { STATUS, CODES, TAKA, SIGNUP_GRANT } from './lib/config.js';

const START_BALANCE = 1000 * TAKA;
const SPEND = 100 * TAKA;
const ATTEMPTS = 20;
const EXPECTED_WINS = START_BALANCE / SPEND; // 10

const succeeded = new Counter('spend_succeeded');
const rejected = new Counter('spend_rejected');
const serverErrors = new Counter('spend_server_errors');

export const options = {
  scenarios: {
    race: {
      executor: 'per-vu-iterations',
      vus: ATTEMPTS,
      iterations: 1,
      maxDuration: '60s',
    },
  },
  thresholds: {
    spend_succeeded: [`count==${EXPECTED_WINS}`],
    spend_rejected: [`count==${ATTEMPTS - EXPECTED_WINS}`],
    spend_server_errors: ['count==0'],
  },
};

export function setup() {
  const victim = register('spend-victim');
  const sink = register('spend-sink');
  const target = register('spend-target');

  // Everyone is funded ৳100,000 at registration. Drain the victim to exactly
  // ৳1,000 so the arithmetic of the race is unambiguous. ৳99,000 is under the
  // ৳100,000 per-transfer limit but over the ৳25,000 Step-Up threshold, so the
  // helper handles the 403 and resubmits with the PIN.
  const drain = SIGNUP_GRANT - START_BALANCE;
  const res = transfer(victim.token, sink.phone, drain, {
    pin: victim.pin,
    note: 'drain to 1000',
  });
  if (!STATUS.created.includes(res.status)) {
    throw new Error(`could not drain victim: ${res.status} ${res.body}`);
  }

  const confirmed = balance(victim.token);
  if (confirmed !== START_BALANCE) {
    throw new Error(`victim balance is ${confirmed}, expected ${START_BALANCE}`);
  }

  return { victim, target };
}

export default function (data) {
  const res = transfer(data.victim.token, data.target.phone, SPEND, {
    pin: data.victim.pin,
    note: 'double-spend race',
  });

  let code = null;
  try {
    const body = res.json();
    code = body && body.error ? body.error.code : null;
  } catch (e) {
    /* non-JSON body is itself a failure, caught by the check below */
  }

  if (res.status >= 500) {
    serverErrors.add(1);
  } else if (STATUS.created.includes(res.status)) {
    succeeded.add(1);
  } else if (res.status === STATUS.insufficientFunds && code === CODES.insufficientFunds) {
    rejected.add(1);
  }

  check(res, {
    'committed or cleanly refused for funds': (r) =>
      STATUS.created.includes(r.status) ||
      (r.status === STATUS.insufficientFunds && code === CODES.insufficientFunds),
    'never a 5xx': (r) => r.status < 500,
  });
}

export function teardown(data) {
  const remaining = balance(data.victim.token);
  const received = balance(data.target.token);
  const report = integrity();

  const ok = check(null, {
    'victim balance is exactly zero': () => remaining === 0,
    'victim never went negative': () => remaining >= 0,
    [`target received exactly ${EXPECTED_WINS} transfers`]: () =>
      received === SIGNUP_GRANT + EXPECTED_WINS * SPEND,
    'ledger still balanced': () => integrityHealthy(report),
  });

  console.log(
    `\n[02] ${ATTEMPTS} concurrent ৳100 sends from a ৳1,000 balance.\n` +
      `     remaining: ${remaining} (expected 0, must never be < 0)\n` +
      `     integrity: ${describeIntegrity(report)}\n` +
      `     verdict:   ${ok ? `exactly ${EXPECTED_WINS} succeeded` : 'FAILED'}\n`,
  );
}

// Written to /results so tests/bench can assemble one report from all six runs.
export const handleSummary = summaryFor('02-double-spend', '20 concurrent sends from a balance that funds 10 commit exactly 10');
