/*
 * LexAmplify load test (k6) — measures the real concurrency ceiling per box.
 *
 * ⚠️  RUN AGAINST A DEDICATED OR STAGING INSTANCE — NEVER the shared prod box.
 *     This drives real traffic (logins, reads) and WILL contend for CPU, DB
 *     connections and the shared Supabase pooler. Pointing it at
 *     app.lexamplify.com would hamper the live app and the other tenants on
 *     that EC2 box. Stand up a separate instance, point BASE_URL at it, and
 *     measure there (SCALE_READINESS.md step 7).
 *
 * Install k6:  https://k6.io/docs/get-started/installation/
 *
 * Run (health-only, safe smoke):
 *     k6 run -e BASE_URL=https://staging.example.com deploy/aws/loadtest/loadtest.js
 *
 * Run (authenticated browse — needs a seeded test user on that instance):
 *     k6 run \
 *       -e BASE_URL=https://staging.example.com \
 *       -e TEST_EMAIL=loadtest@example.com -e TEST_PASSWORD=... \
 *       -e VUS=200 -e DURATION=3m \
 *       deploy/aws/loadtest/loadtest.js
 *
 * Read the summary: look at http_req_duration p95 and http_req_failed. The VU
 * level where p95 crosses ~1s or errors climb is this box's practical ceiling;
 * divide 10,000 by that to size the fleet behind the load balancer.
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE = (__ENV.BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
const EMAIL = __ENV.TEST_EMAIL || '';
const PASSWORD = __ENV.TEST_PASSWORD || '';
const VUS = parseInt(__ENV.VUS || '50', 10);
const DURATION = __ENV.DURATION || '1m';

// Guard: refuse to point at the known shared prod host unless explicitly forced.
if (BASE.includes('app.lexamplify.com') && __ENV.I_UNDERSTAND_THIS_IS_PROD !== 'yes') {
  throw new Error(
    'Refusing to load-test the shared prod box (app.lexamplify.com). Point BASE_URL ' +
    'at a dedicated/staging instance. To override (do NOT), set I_UNDERSTAND_THIS_IS_PROD=yes.'
  );
}

const errorRate = new Rate('app_errors');
const readTrend = new Trend('authed_read_ms', true);

export const options = {
  scenarios: {
    health: {
      executor: 'constant-vus',
      vus: Math.max(5, Math.floor(VUS * 0.2)),
      duration: DURATION,
      exec: 'health',
    },
    browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '15s', target: 0 },
      ],
      exec: 'browse',
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],          // <2% failures
    http_req_duration: ['p(95)<1000'],       // p95 under 1s
    app_errors: ['rate<0.02'],
  },
};

// Public health endpoint — no auth, cheapest possible probe.
export function health() {
  const r = http.get(`${BASE}/api/ping`, { tags: { name: 'ping' } });
  check(r, { 'ping 200': (res) => res.status === 200 });
  errorRate.add(r.status >= 500);
  sleep(1);
}

// Authenticated read path — mirrors what the product hub actually loads.
// Skips itself (no-op) if no test credentials were provided, so the health
// scenario can still run as a safe smoke test on its own.
export function browse() {
  if (!EMAIL || !PASSWORD) { sleep(1); return; }

  const jar = http.cookieJar();
  group('login', () => {
    const r = http.post(`${BASE}/api/auth/login`,
      JSON.stringify({ email: EMAIL, password: PASSWORD }),
      { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } });
    check(r, { 'login ok': (res) => res.status === 200 });
    errorRate.add(r.status >= 500);
  });

  // The hub's real fan-out of reads.
  const headers = { 'Content-Type': 'application/json' };
  const endpoints = [
    '/api/practice/cases?per_page=100&sort=next_hearing',
    '/api/drafts/sessions',
    '/api/matters',
    '/api/practice/notifications',
  ];
  for (const ep of endpoints) {
    const r = http.get(`${BASE}${ep}`, { headers, tags: { name: ep.split('?')[0] } });
    readTrend.add(r.timings.duration);
    check(r, { [`read ${ep} <500`]: (res) => res.status < 500 });
    errorRate.add(r.status >= 500);
  }
  sleep(Math.random() * 2 + 1);   // think-time 1–3s
}
