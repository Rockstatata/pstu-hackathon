// Machine-readable results, so a run can be presented rather than recounted.
//
// k6's own end-of-run output is written for a person watching a terminal. It
// scrolls, it is not diffable, and by the time six scenarios have run the first
// one's numbers are gone. Every scenario therefore also writes one JSON file
// that the report builder in tests/bench reads.
//
// The pass rule is deliberately k6's own: a scenario passes when every threshold
// it declared passed and no check failed. Nothing here re-judges a run that k6
// already judged, because a harness that can talk itself into a pass is worth
// nothing to the person it is meant to convince.

const RESULTS_DIR = '/results';

function percentile(metric, name) {
  if (!metric || !metric.values) return null;
  const value = metric.values[name];
  return value === undefined ? null : Math.round(value * 100) / 100;
}

function thresholdResults(data) {
  const results = [];
  for (const [metricName, metric] of Object.entries(data.metrics || {})) {
    if (!metric.thresholds) continue;
    for (const [expression, outcome] of Object.entries(metric.thresholds)) {
      // k6 reports a threshold as { ok: bool } in recent versions and as a bare
      // boolean in older ones. Read both rather than assume the local version.
      const ok = typeof outcome === 'object' && outcome !== null ? outcome.ok !== false : !!outcome;
      results.push({ metric: metricName, expression, passed: ok });
    }
  }
  return results;
}

function counters(data) {
  const out = {};
  for (const [name, metric] of Object.entries(data.metrics || {})) {
    if (metric.type === 'counter' && !name.startsWith('http_') && !name.startsWith('data_')) {
      out[name] = metric.values.count;
    }
  }
  return out;
}

/**
 * @param {string} name      scenario id, e.g. '01-duplicate-storm'
 * @param {string} proves    one line on what a pass actually demonstrates
 */
export function summaryFor(name, proves) {
  return function handleSummary(data) {
    const duration = data.metrics.http_req_duration;
    const requests = data.metrics.http_reqs;
    const failed = data.metrics.http_req_failed;
    const checks = data.metrics.checks;

    const thresholds = thresholdResults(data);
    const checksFailed = checks ? checks.values.fails || 0 : 0;
    const passed = thresholds.every((entry) => entry.passed) && checksFailed === 0;

    const report = {
      scenario: name,
      proves,
      passed,
      finishedAt: new Date().toISOString(),
      requests: {
        total: requests ? requests.values.count : 0,
        perSecond: requests ? Math.round(requests.values.rate * 100) / 100 : 0,
        // On the replica-kill scenario this is EXPECTED to be non-zero: the
        // requests in flight on the killed process must fail. The property that
        // matters there is the ledger assertion, not this rate.
        failedRate: failed ? Math.round(failed.values.rate * 10000) / 10000 : 0,
      },
      latencyMs: {
        p50: percentile(duration, 'med'),
        p90: percentile(duration, 'p(90)'),
        p95: percentile(duration, 'p(95)'),
        p99: percentile(duration, 'p(99)'),
        max: percentile(duration, 'max'),
      },
      checks: {
        passed: checks ? checks.values.passes || 0 : 0,
        failed: checksFailed,
      },
      thresholds,
      counters: counters(data),
    };

    const line = (label, value) => `  ${label.padEnd(22)} ${value}\n`;
    const text =
      `\n${passed ? 'PASS' : 'FAIL'}  ${name}\n` +
      `  ${proves}\n` +
      line('requests', `${report.requests.total} (${report.requests.perSecond}/s)`) +
      line('latency p95', `${report.latencyMs.p95} ms`) +
      line('checks', `${report.checks.passed} passed, ${report.checks.failed} failed`) +
      line(
        'thresholds',
        `${thresholds.filter((entry) => entry.passed).length}/${thresholds.length} passed`,
      ) +
      Object.entries(report.counters)
        .map(([key, value]) => line(key, value))
        .join('');

    return {
      stdout: text,
      [`${RESULTS_DIR}/${name}.json`]: JSON.stringify(report, null, 2),
    };
  };
}
