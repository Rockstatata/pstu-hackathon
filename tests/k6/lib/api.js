import http from 'k6/http';
import { fail, sleep } from 'k6';
import { BASE_URL, PATHS, FIELDS, HEADERS, CODES, STATUS, PIN } from './config.js';

export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Contract requires 01[3-9] followed by 8 digits. */
export function newPhone() {
  const operator = 3 + Math.floor(Math.random() * 7); // 3..9
  let rest = '';
  for (let i = 0; i < 8; i++) rest += Math.floor(Math.random() * 10);
  return `01${operator}${rest}`;
}

function url(path) {
  return `${BASE_URL}${path}`;
}

function headers(token) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

function errorCode(res) {
  try {
    const body = res.json();
    return body && body.error ? body.error.code : null;
  } catch (e) {
    return null;
  }
}

/**
 * Case-insensitive header read. k6 canonicalises response header names, but
 * Starlette emits them lowercased on the wire and a case-sensitive lookup
 * silently returns undefined — which reads as "the API stopped setting this"
 * rather than "I looked it up wrong". Cheap insurance on an assertion that
 * carries a whole scenario.
 */
export function header(res, name) {
  if (!res || !res.headers) return undefined;
  if (res.headers[name] !== undefined) return res.headers[name];
  const wanted = name.toLowerCase();
  for (const k in res.headers) {
    if (k.toLowerCase() === wanted) return res.headers[k];
  }
  return undefined;
}

/** Register and return { phone, pin, token }. Registration returns the token directly. */
export function register(namePrefix = 'k6') {
  const phone = newPhone();
  const res = http.post(
    url(PATHS.register),
    JSON.stringify({ name: `${namePrefix} ${phone.slice(-4)}`, phone, pin: PIN }),
    { headers: headers(), tags: { name: 'register' } },
  );

  if (res.status !== 201) {
    fail(`register failed: ${res.status} ${res.body}`);
  }
  return { phone, pin: PIN, token: res.json()[FIELDS.token] };
}

export function balance(token) {
  const res = http.get(url(PATHS.me), { headers: headers(token), tags: { name: 'balance' } });
  if (res.status !== 200) fail(`balance failed: ${res.status} ${res.body}`);
  return res.json()[FIELDS.balance];
}

/**
 * One raw attempt. Returns the response untouched — scenarios that want to see
 * the 403 or the 409 for themselves use this.
 */
export function transferOnce(token, body, key, pin) {
  const h = headers(token);
  h[HEADERS.idempotencyKey] = key;
  const payload = pin ? Object.assign({}, body, { pin }) : body;
  return http.post(url(PATHS.transfer), JSON.stringify(payload), {
    headers: h,
    tags: { name: 'transfer' },
  });
}

/**
 * Send money the way a correct client does.
 *
 * Two responses are not outcomes, they are instructions to try again, and both
 * are expected constantly in these scenarios:
 *
 *   403 STEP_UP_REQUIRED  — resubmit with the PIN. The PIN is excluded from the
 *                           idempotency fingerprint, so the SAME key is reused;
 *                           it is the same intention, not a new one.
 *   409 REQUEST_IN_PROGRESS — another replica holds this key and has not stored
 *                           its response yet. Wait and re-ask; do NOT mint a new
 *                           key, that would be a second movement.
 *
 * Everything else is returned as-is for the caller to assert on.
 */
export function transfer(token, recipientPhone, amountPoisha, opts = {}) {
  const body = {
    recipientPhone,
    amountPoisha,
    note: opts.note || 'k6',
  };
  return submit(token, body, opts);
}

/** Group Transfer — all-or-nothing across N recipients (ADR-0002). */
export function groupTransfer(token, recipients, opts = {}) {
  const body = {
    recipients: recipients.map((r) => ({ phone: r.phone, amountPoisha: r.amountPoisha })),
    note: opts.note || 'k6 group',
  };
  return submit(token, body, opts);
}

export function createMoneyRequest(token, payerPhone, amountPoisha, reason = 'k6 request') {
  const h = headers(token);
  h[HEADERS.idempotencyKey] = uuid();
  const res = http.post(
    url(PATHS.moneyRequests),
    JSON.stringify({ payerPhone, amountPoisha, reason }),
    { headers: h, tags: { name: 'money-request-create' } },
  );
  if (res.status !== 201) fail(`money request create failed: ${res.status} ${res.body}`);
  return res.json();
}

export function payMoneyRequestOnce(token, requestId, key, pin = PIN) {
  const h = headers(token);
  h[HEADERS.idempotencyKey] = key;
  return http.post(
    url(`${PATHS.moneyRequests}/${requestId}/pay`),
    JSON.stringify({ pin }),
    { headers: h, tags: { name: 'money-request-pay' } },
  );
}

export function getMoneyRequest(token, requestId) {
  return http.get(url(`${PATHS.moneyRequests}/${requestId}`), {
    headers: headers(token),
    tags: { name: 'money-request-get' },
  });
}

function submit(token, body, opts) {
  const key = opts.key || uuid();
  const pin = opts.pin || PIN;
  const maxWaits = opts.maxWaits === undefined ? 10 : opts.maxWaits;

  // Send the PIN on the FIRST attempt, not only after a 403.
  //
  // Step-Up fires on a first-time recipient AND on 5 transfers in 10 minutes,
  // so a sustained-load VU trips it from its fifth send onward even against a
  // known recipient. If the 403-then-resubmit path were the primary one we
  // would be paying an extra round trip plus a bcrypt on most iterations, and
  // the throughput numbers would measure our own retry loop rather than the
  // transfer engine. The PIN is excluded from the idempotency fingerprint and
  // verify_pin only runs when a rule actually fires, so sending it always is
  // free. The retry below stays as a correctness backstop.
  let res = transferOnce(token, body, key, pin);
  let waits = 0;

  for (;;) {
    const code = errorCode(res);

    if (res.status === STATUS.stepUpRequired && code === CODES.stepUpRequired) {
      // Same key, plus the PIN.
      res = transferOnce(token, body, key, pin);
      continue;
    }

    if (res.status === STATUS.inProgress && code === CODES.inProgress) {
      if (waits >= maxWaits) return res;
      waits++;
      sleep(0.05);
      res = transferOnce(token, body, key, pin);
      continue;
    }

    return res;
  }
}

/** The five ledger invariants, computed live. No auth required. */
export function integrity() {
  const res = http.get(url(PATHS.integrity), { tags: { name: 'integrity' } });
  if (res.status !== 200) fail(`integrity failed: ${res.status} ${res.body}`);
  return res.json();
}

/**
 * Every assertion is written so 0 is healthy and `verdict` is HEALTHY only when
 * all five pass, so the pass rule is one line with no per-check special case.
 */
export function integrityHealthy(report) {
  if (!report) return false;
  const verdictOk = report.verdict === 'HEALTHY';
  const assertionsOk =
    Array.isArray(report.assertions) && report.assertions.every((a) => a.pass === true);
  const balanced = report.totals && report.totals.differencePoisha === 0;
  return verdictOk && assertionsOk && balanced;
}

export function describeIntegrity(report) {
  if (!report) return 'no report';
  const failed = (report.assertions || []).filter((a) => !a.pass).map((a) => a.key);
  return (
    `verdict=${report.verdict} difference=${report.totals ? report.totals.differencePoisha : '?'}` +
    (failed.length ? ` failed=[${failed.join(', ')}]` : '')
  );
}
