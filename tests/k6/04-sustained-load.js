// Scenario 4 — Sustained multi-instance load
//
// Ordinary traffic, ramped across all three API replicas. Proves the boring
// case: throughput is real, latency is sane, every replica serves, and the
// ledger is exactly balanced afterwards.
//
//   k6 run -e BASE_URL=... tests/k6/04-sustained-load.js

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import {
  register,
  transfer,
  header,
  integrity,
  integrityHealthy,
  describeIntegrity,
} from './lib/api.js';
import { STATUS, TAKA, BASE_URL, PATHS, HEADERS } from './lib/config.js';

const MAX_VUS = 40;
const POOL_SIZE = MAX_VUS * 2;
const AMOUNT = 10 * TAKA;

const committed = new Counter('load_committed');
const failed = new Counter('load_failed');

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 20 },
        { duration: '45s', target: MAX_VUS },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1500'],
    load_failed: ['count==0'],
  },
};

export function setup() {
  const pool = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    pool.push(register(`load-${i}`));
  }
  return { pool };
}

export default function (data) {
  const pool = data.pool;
  // This scenario measures ordinary sustained throughput and latency, not hot-
  // Account lock pressure (scenario 3 owns that case). Each VU therefore has a
  // disjoint sender/recipient pair, so one VU cannot queue behind another VU's
  // Account lock. Step-Up, bcrypt, PostgreSQL, and all three replicas remain in
  // the path.
  const a = (__VU - 1) * 2;
  const b = a + 1;

  const res = transfer(pool[a].token, pool[b].phone, AMOUNT, {
    pin: pool[a].pin,
    note: 'sustained load',
  });

  if (STATUS.created.includes(res.status)) {
    committed.add(1);
  } else if (res.status >= 500) {
    failed.add(1);
  }

  check(res, { committed: (r) => STATUS.created.includes(r.status) });
}

export function teardown() {
  // Prove the gateway actually spread traffic rather than pinning one replica.
  // nginx stamps X-Served-By; the API stamps X-Instance.
  const replicas = {};
  for (let i = 0; i < 30; i++) {
    const res = http.get(`${BASE_URL}${PATHS.live}`);
    const who = header(res, HEADERS.instance) || header(res, HEADERS.servedBy);
    if (who) replicas[who] = (replicas[who] || 0) + 1;
  }
  const distinct = Object.keys(replicas);

  const report = integrity();
  const ok = check(null, {
    'ledger balanced after sustained load': () => integrityHealthy(report),
    'more than one replica served traffic': () => distinct.length > 1,
  });

  console.log(
    `\n[04] Sustained ramp to 40 VUs over 75s.\n` +
      `     replicas seen: ${distinct.length} -> ${JSON.stringify(replicas)}\n` +
      `     integrity:     ${describeIntegrity(report)}\n` +
      `     verdict:       ${ok ? 'balanced, load distributed' : 'FAILED'}\n`,
  );
}
