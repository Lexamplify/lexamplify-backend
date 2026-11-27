# LexAmplify load test

Measures the **real per-box concurrency ceiling** so the fleet behind a load
balancer can be sized for 10k+ concurrent users (SCALE_READINESS.md, step 7).

## ⚠️ Never run this against the shared prod box

`app.lexamplify.com` shares an EC2 box with ~19 other Sociovia containers and the
Supabase pooler. A load test there would hamper the live app and its neighbours.
The script **hard-refuses** that host. Always point `BASE_URL` at a **dedicated or
staging instance** that mirrors prod (same gunicorn config, same DB tier).

## Install

k6 — https://k6.io/docs/get-started/installation/ (`choco install k6` on Windows,
`brew install k6` on macOS).

## Run

Safe smoke (health endpoint only, no auth):

```
k6 run -e BASE_URL=https://staging.example.com deploy/aws/loadtest/loadtest.js
```

Full authenticated browse (needs a seeded test user on that instance):

```
k6 run \
  -e BASE_URL=https://staging.example.com \
  -e TEST_EMAIL=loadtest@example.com -e TEST_PASSWORD=<pw> \
  -e VUS=200 -e DURATION=3m \
  deploy/aws/loadtest/loadtest.js
```

Knobs: `VUS` (peak virtual users), `DURATION` (sustained load window).

## Reading the result

- **`http_req_duration … p(95)`** — 95th-percentile latency. The VU level where
  this crosses ~1s is the box's practical ceiling.
- **`http_req_failed` / `app_errors`** — should stay under 2%. A climb means the
  box is saturating (DB pool exhaustion, GIL, memory).

Find the VU count the box holds within thresholds, then:

```
instances needed ≈ ceil(10000 / sustained_VUs_per_box) + headroom
```

Re-run after each hardening step (Redis layers on, SSE on async workers, heavy
work on Celery) to watch the ceiling rise.
