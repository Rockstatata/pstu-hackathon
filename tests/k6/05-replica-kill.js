// Scenario 5 — Crash during money movement
//
// Sustained load while an operator SIGKILLs one API replica mid-flight. The
// research doc's worst case: a process dies after BEGIN, or after COMMIT but
// before the response reaches the client.
//
// The property being proved is NOT "zero errors" — killing a replica should
// break the requests that were in flight on it. It is "zero lost money".
//
// Run this LAST in the demo. Killing a container live while the counter keeps
// climbing, then showing integrity green, is the strongest 90 seconds available.
//
//   Terminal 1:  k6 run -e BASE_URL=... tests/k6/05-replica-kill.js
//   Terminal 2:  (after ~15s, kill ONE replica — not the service)
//     docker kill pstu-money-api-2
//   Afterwards:
//     docker compose up -d --no-recreate api
//
// `docker compose kill api` targets the SERVICE and stops all three. Always
// name the container.

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
import { STATUS, TAKA, SIGNUP_GRANT } from './lib/config.js';

const POOL_SIZE = 8;
const AMOUNT = 10 * TAKA;

const committed = new Counter('kill_committed');
const errored = new Counter('kill_errored');

export const options = {
  scenarios: {
    under_fire: {
      executor: 'constant-vus',
      vus: 15,
      duration: '60s',
    },
  },
  thresholds: {
    // Deliberately permissive. A killed replica is EXPECTED to produce errors;
    // what must hold is the ledger assertion in teardown.
    http_req_failed: ['rate<0.35'],
  },
};

export function setup() {
  const pool = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    pool.push(register(`kill-${i}`));
  }
  console.log(
    `\n[05] Load is running. Kill ONE replica now:\n` +
      `     docker kill pstu-money-api-2\n`,
  );
  return { pool, expectedTotal: POOL_SIZE * SIGNUP_GRANT };
}

export default function (data) {
  const pool = data.pool;
  const a = Math.floor(Math.random() * pool.length);
  let b = Math.floor(Math.random() * pool.length);
  if (b === a) b = (b + 1) % pool.length;

  const res = transfer(pool[a].token, pool[b].phone, AMOUNT, {
    pin: pool[a].pin,
    note: 'replica kill',
    // Do not spend the whole iteration waiting out a dead replica's key.
    maxWaits: 3,
  });

  if (STATUS.created.includes(res.status)) {
    committed.add(1);
  } else {
    errored.add(1);
  }

  // A failure must be LOUD. The unacceptable outcomes are a 2xx for money that
  // never moved, or a connection error for money that did — the latter is what
  // the idempotency key exists to make recoverable.
  check(res, {
    'response is unambiguous': (r) =>
      STATUS.created.includes(r.status) || r.status >= 400 || r.status === 0,
  });
}

export function teardown(data) {
  // Transfers only shuffle money between pool accounts, so the sum across the
  // pool must still equal what was issued to them. Any drift is money the crash
  // created or destroyed.
  let total = 0;
  for (const user of data.pool) {
    total += balance(user.token);
  }

  const report = integrity();
  const ok = check(null, {
    'no money created or destroyed by the crash': () => total === data.expectedTotal,
    'ledger still balanced after a replica died': () => integrityHealthy(report),
  });

  console.log(
    `\n[05] Replica killed under sustained load.\n` +
      `     pool total: ${total} (expected ${data.expectedTotal})\n` +
      `     integrity:  ${describeIntegrity(report)}\n` +
      `     verdict:    ${ok ? 'no money lost' : 'FAILED'}\n`,
  );
}
