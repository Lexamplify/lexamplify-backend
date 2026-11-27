# LexAmplify — Scale readiness (target: 10k+ concurrent users)

This is the honest picture, not a marketing one. It covers where the app is
today, what was hardened in this pass, and exactly what reaching **10,000
concurrent users** requires — because that number **cannot be reached by code
alone on the current shared box**. It needs infrastructure the code is now
ready for.

---

## 1. The honest ceiling today

The backend runs as **one gunicorn process × 6 threads** (`gunicorn.conf.py`),
co-located on the **shared Sociovia EC2 box** (~19 other containers), talking to
Supabase Postgres through a session pooler. That is **~6 concurrent in-flight
requests**, GIL-bound, before anything queues.

The hard wall is not CPU — it is three design facts:

| # | Blocker | Why it caps concurrency |
|---|---------|------------------------|
| 1 | **Server-Sent Event streams** (notification bell, contract progress) run on the sync `gthread` workers and never return. Each open stream **pins one of the 6 threads for its whole lifetime**. | ~6 users with the app open = every thread consumed = server wedged. This is the true ceiling today. |
| 2 | **One process, 6 threads, GIL.** Heavy work (PDF/OCR/analysis/doc-gen) runs inside the web workers. | No real concurrency headroom; CPU work serializes. |
| 3 | **JWT revocation = a DB query on every authenticated request**, through a 5-connection SQLAlchemy pool. | At scale the pool is the throughput ceiling for auth alone. |

**Bottom line:** the app today comfortably serves a **single firm / low
hundreds of users with bursty, mostly-non-streaming traffic**. It is **not** at
10k concurrent, and no config flip on the shared box gets it there while the
SSE streams and heavy work live on the sync workers.

---

## 2. What this hardening pass changed (shipped, safe, inert by default)

All of the following are **additive and default-off / default-unchanged** — they
do nothing until the matching env var is set, so they are safe to deploy to the
shared box without touching current behaviour.

| Area | Change | Enable with |
|------|--------|-------------|
| **Rate limiting** (`utils/limiter.py`) | Limiter can use shared Redis storage instead of per-process memory, so limits hold across workers/boxes. | `RATELIMIT_STORAGE_URI` / `REDIS_URL` |
| **Shared cache** (`utils/scale_cache.py`, new) | One Redis-backed cache with a bounded in-memory fallback. Degrades silently if Redis is absent. Foundation for cross-instance caching. | `REDIS_URL` |
| **Revocation hot-path** (`app.py`, `routes/auth_routes.py`) | The per-request "is this token revoked?" check answers from Redis (negative-cached), skipping the DB. Logout writes the jti to Redis so every box rejects it instantly. DB stays source of truth. | `REVOCATION_CACHE=on` (+ `REDIS_URL`) |
| **DB connection budget** (`utils/pg_compat.py`) | Pool min/max are env-tunable, so each box's connection use can be set in step with the pooler cap. Default `(1,16)` unchanged. | `PG_POOL_MIN` / `PG_POOL_MAX` |
| **Static assets** (`deploy/aws/Caddyfile`) | Content-hashed `/assets/*` cached `immutable` for a year; `index.html` never cached. Repeat/concurrent loads come from the browser/CDN edge, not this box. | already on |
| **Gunicorn** (already env-driven) | `WEB_CONCURRENCY`, `GUNICORN_THREADS` knobs documented. | `WEB_CONCURRENCY=…` |

Verified: frontend builds clean; all changed Python modules parse; the cache's
three-valued revocation logic and in-memory fallback pass a functional test.

**Note on the shared box:** raising `WEB_CONCURRENCY` multiplies this process's
memory and DB connections on a box shared with ~19 other containers. Do **not**
raise it blindly — size it against free RAM and the pooler cap, and prefer a
**dedicated box** (below) for real scale. That resource call is yours to make.

---

## 3. What reaching 10k concurrent actually requires (infra, not code)

The code is now ready for horizontal scale. The remaining work is
infrastructure and two targeted refactors. In priority order:

1. **Move the app off the shared box** onto its own instance(s), behind a load
   balancer (ALB/NLB). 10k concurrent realistically means **several app
   instances**, each running multiple gunicorn workers. The shared box cannot
   and should not carry this.

2. **Get SSE/streaming off the sync workers** (blocker #1). Either run the
   streaming endpoints on `gevent`/`eventlet` or an ASGI (uvicorn) tier, or
   replace poll-the-DB SSE with **Redis pub/sub** + a small async gateway. Until
   this is done, more instances only move the ~6-streams-per-process wall, they
   don't remove it.

3. **Push all heavy work to Celery** (blocker #2). The Celery/Redis path already
   exists; remove the in-process `threading.Thread` fallbacks so the web tier
   only does fast request/response. Then `WEB_CONCURRENCY ≈ 2×vCPU` is safe.

4. **Turn on the Redis layers** shipped here: `REDIS_URL`,
   `RATELIMIT_STORAGE_URI`, `REVOCATION_CACHE=on`. These make multi-instance
   correct (shared limits, shared revocation) and cut the per-request DB load.

5. **Connection budget** (blocker #7/#8): the session pooler holds a real
   Postgres backend per checkout. Total connections = `(PG_POOL_MAX + SQLAlchemy
   pool) × workers × instances` must stay under the Supabase backend ceiling.
   Either cap carefully, or rework the RLS identity injection to `SET LOCAL`
   inside transactions so the higher-capacity `:6543` transaction pooler can be
   used. Audit `with connect()` sites to close deterministically.

6. **Put a CDN in front** (CloudFront/Cloudflare) of the static origin so the
   SPA + TLS handshakes are served at the edge, not by the app box. With the
   `immutable` headers already set, this offloads the majority of requests.

7. **Load-test to the real number.** Run k6/Locust against a dedicated instance
   to get the measured concurrency per box, then size the instance count behind
   the LB for 10k. (No synthetic number is quoted here because none has been
   measured on dedicated hardware — doing so is step 7, not a guess.)

---

## 4. One-paragraph summary for the standup

> The product is built and the code is now horizontally-scalable: shared-Redis
> rate limiting, a cross-instance cache, a hot-path revocation cache, tunable DB
> pooling and edge-cached static assets are all in, shipped safe/off-by-default.
> But 10k concurrent is an **infrastructure** milestone, not a code flip: it
> needs the app on its own box(es) behind a load balancer, SSE and heavy work
> moved off the synchronous workers, the Redis layers switched on, and a CDN —
> then a load test to size the fleet. On the current shared box the realistic
> ceiling is low hundreds of mostly-non-streaming users; the steps to go from
> there to 10k are enumerated above and the code is ready for each of them.
