// Scenario 3 — Deadlock pressure
//
// A sends to B while B sends to A, continuously, across a shared pool — mixed
// with Group Transfers that lock N+1 accounts at once. A naive
// sender-then-recipient lock order deadlocks here within seconds. Sorted lock
// acquisition (ADR-0003) makes it structurally impossible.
//
// Correct behaviour: zero deadlocks, zero lock timeouts, ledger balanced.
//
//   k6 run -e BASE_URL=... tests/k6/03-deadlock-pressure.js

import { check } from 'k6';
import { Counter } from 'k6/metrics';
import {
  register,
  transfer,
  groupTransfer,
  integrity,
  integrityHealthy,
  describeIntegrity,
} from './lib/api.js';
import { summaryFor } from './lib/summary.js';
import { STATUS, TAKA } from './lib/config.js';

const POOL_SIZE = 6;
const AMOUNT = 5 * TAKA;
const GROUP_SHARE = 2 * TAKA;
const PRESSURE_VUS = Number(__ENV.PRESSURE_VUS || 24);
const PRESSURE_DURATION = __ENV.PRESSURE_DURATION || '45s';

const serverErrors = new Counter('deadlock_server_errors');
const lockFailures = new Counter('deadlock_lock_failures');
const committed = new Counter('deadlock_committed');

export const options = {
  scenarios: {
    crossfire: {
      executor: 'constant-vus',
      vus: PRESSURE_VUS,
      duration: PRESSURE_DURATION,
    },
  },
  thresholds: {
    // The whole point of the scenario. Throughput does not compensate for any
    // of these being non-zero.
    deadlock_server_errors: ['count==0'],
    deadlock_lock_failures: ['count==0'],
  },
};

export function setup() {
  const pool = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    pool.push(register(`pool-${i}`));
  }
  return { pool };
}

function record(res) {
  if (res.status >= 500) {
    serverErrors.add(1);
    const body = String(res.body || '');
    // lock_timeout is 3s and deadlock_timeout is 1s. Either surfacing here
    // means the ordering failed to prevent contention.
    if (/deadlock|lock timeout|55P03|40P01/i.test(body)) {
      lockFailures.add(1);
    }
  } else if (STATUS.created.includes(res.status)) {
    committed.add(1);
  }

  check(res, { 'no deadlock, no lock timeout': (r) => r.status < 500 });
}

export default function (data) {
  const pool = data.pool;

  // Two distinct accounts chosen independently, so A->B and B->A run at the
  // same instant across VUs. This is the shape that deadlocks naive code.
  const a = Math.floor(Math.random() * pool.length);
  let b = Math.floor(Math.random() * pool.length);
  if (b === a) b = (b + 1) % pool.length;

  // One iteration in four is a Group Transfer, which locks the sender plus
  // three recipients in a single transaction — a strictly harder lock set, and
  // the case a per-pair ordering rule would miss.
  if (Math.random() < 0.25) {
    const recipients = [];
    for (let i = 1; i <= 3; i++) {
      recipients.push({
        phone: pool[(a + i) % pool.length].phone,
        amountPoisha: GROUP_SHARE,
      });
    }
    record(
      groupTransfer(pool[a].token, recipients, {
        pin: pool[a].pin,
        note: 'group under pressure',
      }),
    );
  } else {
    record(
      transfer(pool[a].token, pool[b].phone, AMOUNT, {
        pin: pool[a].pin,
        note: 'deadlock pressure',
      }),
    );
  }
}

export function teardown() {
  const report = integrity();
  const ok = check(null, {
    'ledger balanced after bidirectional crossfire': () => integrityHealthy(report),
  });

  console.log(
    `\n[03] Bidirectional + group transfers across ${POOL_SIZE} accounts, ${PRESSURE_VUS} VUs, ${PRESSURE_DURATION}.\n` +
      `     integrity: ${describeIntegrity(report)}\n` +
      `     verdict:   ${ok ? 'zero deadlocks, ledger balanced' : 'FAILED'}\n`,
  );
}

// Written to /results so tests/bench can assemble one report from all six runs.
export const handleSummary = summaryFor('03-deadlock-pressure', 'Bidirectional and group traffic never deadlocks under sorted lock acquisition');
