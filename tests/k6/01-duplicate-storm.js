// Scenario 1 — Duplicate request storm
//
// The hardest failure in the research doc: a client times out and retries, or a
// proxy replays, after the server already committed. 50 requests carrying the
// SAME Idempotency-Key fire simultaneously across three replicas.
//
// Correct behaviour: exactly one commits, 49 return the stored response, and
// every one of them reports the same transferId.
//
//   k6 run -e BASE_URL=... tests/k6/01-duplicate-storm.js

import { check } from 'k6';
import { Counter } from 'k6/metrics';
import {
  register,
  transfer,
  balance,
  uuid,
  header,
  integrity,
  integrityHealthy,
  describeIntegrity,
} from './lib/api.js';
import { summaryFor } from './lib/summary.js';
import { STATUS, TAKA, SIGNUP_GRANT, HEADERS, FIELDS } from './lib/config.js';

const AMOUNT = 2500 * TAKA;
const STORM_SIZE = 50;

const accepted = new Counter('storm_accepted');
const committed = new Counter('storm_committed');
const replayed = new Counter('storm_replayed');
const serverErrors = new Counter('storm_server_errors');

export const options = {
  scenarios: {
    storm: {
      executor: 'per-vu-iterations',
      vus: STORM_SIZE,
      iterations: 1,
      maxDuration: '60s',
    },
  },
  thresholds: {
    storm_server_errors: ['count==0'],
    storm_accepted: [`count==${STORM_SIZE}`],
    // The direct proof, straight off X-Idempotent-Replay: exactly one call
    // moved money, and the other 49 moved none.
    storm_committed: ['count==1'],
    storm_replayed: [`count==${STORM_SIZE - 1}`],
  },
};

export function setup() {
  const sender = register('storm-sender');
  const recipient = register('storm-recipient');
  return {
    sender,
    recipient,
    key: uuid(), // ONE key shared by all 50 VUs
  };
}

export default function (data) {
  // A first-time recipient always trips Step-Up, so the first attempt 403s and
  // the helper resubmits with the PIN under the SAME key. That is the client
  // behaviour we are testing, not a workaround.
  const res = transfer(data.sender.token, data.recipient.phone, AMOUNT, {
    key: data.key,
    pin: data.sender.pin,
    note: 'duplicate storm',
  });

  if (res.status >= 500) serverErrors.add(1);

  if (STATUS.created.includes(res.status)) {
    accepted.add(1);
    const replay = header(res, HEADERS.idempotentReplay);
    if (replay === 'false') committed.add(1);
    else if (replay === 'true') replayed.add(1);
  }

  check(res, {
    'answered, not 5xx': (r) => r.status < 500,
    'accepted': (r) => STATUS.created.includes(r.status),
    'carries a transferId': (r) => {
      try {
        return !!r.json()[FIELDS.transferId];
      } catch (e) {
        return false;
      }
    },
  });
}

export function teardown(data) {
  // Independent of the counters: exactly one transfer's worth of money moved.
  const senderBalance = balance(data.sender.token);
  const recipientBalance = balance(data.recipient.token);
  const report = integrity();

  const expectedSender = SIGNUP_GRANT - AMOUNT;
  const expectedRecipient = SIGNUP_GRANT + AMOUNT;

  const ok = check(null, {
    'sender debited exactly once': () => senderBalance === expectedSender,
    'recipient credited exactly once': () => recipientBalance === expectedRecipient,
    'ledger still balanced': () => integrityHealthy(report),
  });

  console.log(
    `\n[01] ${STORM_SIZE} identical requests, one Idempotency-Key.\n` +
      `     sender:    ${senderBalance} (expected ${expectedSender})\n` +
      `     recipient: ${recipientBalance} (expected ${expectedRecipient})\n` +
      `     integrity: ${describeIntegrity(report)}\n` +
      `     verdict:   ${ok ? 'money moved exactly once' : 'FAILED'}\n`,
  );
}

// Written to /results so tests/bench can assemble one report from all six runs.
export const handleSummary = summaryFor('01-duplicate-storm', '50 identical requests under one Idempotency-Key move money exactly once');
