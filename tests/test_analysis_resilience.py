"""The contract analyzer must never spin for 30 minutes. A stuck provider, a restart, a lost job, a cancel, one user
flooding the server and a very large contract each end in a plain answer within a known time."""
import os
import threading
import time

import pytest

from tests.helpers_app import make_app, register

CONTRACT = "\n\n".join(f"{i}. Clause {i}. " + ("Each party shall perform its duties with reasonable care and skill. " * 12) for i in range(1, 40))


def _no_network_ai(monkeypatch):
    """The summary-merge step calls ask_groq; a test must never reach the real provider."""
    import utils.ai_helper as ah
    monkeypatch.setattr(ah, "ask_groq", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no AI in this test")))


@pytest.fixture()
def world(tmp_path, monkeypatch):
    flask_app = make_app(tmp_path, monkeypatch)
    _no_network_ai(monkeypatch)
    return flask_app, register(flask_app, "a@example.com"), register(flask_app, "b@example.com"), monkeypatch


def _start(client, text=CONTRACT):
    r = client.post("/api/contract/analyze", json={"text": text})
    return r


def _wait(client, job, timeout=40):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        r = client.get(f"/api/contract/analysis-status/{job}")
        last = r.get_json()
        if r.status_code == 200 and last["status"] in ("complete", "failed"):
            return last
        time.sleep(0.3)
    raise AssertionError(f"still not finished after {timeout}s: {last}")


# ── the root cause: no call to the AI provider may be made without a time limit ─────────────────────
def test_every_call_to_the_ai_provider_has_a_time_limit(monkeypatch):
    import utils.ai_helper as ah
    seen = []

    def fake(**kw):
        seen.append(kw)
        raise RuntimeError("stop here")
    monkeypatch.setattr(ah, "completion", fake)
    for kwargs in ({}, {"deadline": time.time() + 30}):
        with pytest.raises(Exception):
            ah.ask_groq("s", "u", **kwargs)
    assert len(seen) == 2 and all(0 < k["timeout"] <= 120 for k in seen), seen
    assert all(k["num_retries"] == 0 for k in seen)


def test_the_time_limit_shrinks_to_what_is_left_before_the_deadline(monkeypatch):
    import utils.ai_helper as ah
    seen = []
    monkeypatch.setattr(ah, "completion", lambda **kw: (seen.append(kw["timeout"]), (_ for _ in ()).throw(RuntimeError("x")))[1])
    with pytest.raises(RuntimeError):
        ah.ask_groq("s", "u", deadline=time.time() + 12, timeout=50)
    assert seen[0] <= 6.1                                   # half of what is left, because the fallback models share it


def test_a_provider_that_times_out_becomes_an_ai_timeout_not_a_long_wait(monkeypatch):
    import utils.llm_client as lc
    import utils.ai_helper as ah

    def hang(**kw):
        raise lc.Timeout("request timed out after 50s")
    monkeypatch.setattr(ah, "completion", hang)
    t0 = time.time()
    with pytest.raises(ah.AITimeout):
        ah.ask_groq("s", "u", deadline=time.time() + 30)
    assert time.time() - t0 < 2


def test_a_rate_limit_that_wants_a_longer_pause_than_we_have_gives_up_at_once(monkeypatch):
    import utils.ai_helper as ah

    def limited(**kw):
        raise RuntimeError("rate_limit_exceeded: Please try again in 40s")
    monkeypatch.setattr(ah, "completion", limited)
    t0 = time.time()
    with pytest.raises(ah.AITimeout):
        ah.ask_groq("s", "u", deadline=time.time() + 20)
    assert time.time() - t0 < 3                              # it did not sleep 41 seconds and then run out of time anyway


# ── the whole job ───────────────────────────────────────────────────────────────────────────────────────
def test_a_section_that_never_answers_ends_the_job_with_a_partial_result_at_the_time_limit(world):
    _f, a, _b, mp = world
    import routes.contract_routes as cr
    mp.setenv("ANALYSIS_MAX_SECONDS", "8")
    calls = {"n": 0}
    release = threading.Event()

    def stuck_on_one(chunk, strategy="Defensive", **kw):
        calls["n"] += 1
        if "Clause 2. " in chunk and calls["n"] > 0 and not release.is_set() and chunk.startswith("1."):
            release.wait(60)                                  # a call that ignores every timeout
        return {"summary": "Part of an agreement.", "clauses": []}
    mp.setattr(cr, "analyze_contract_with_llm", stuck_on_one)
    r = _start(a)
    assert r.status_code == 200
    t0 = time.time()
    st = _wait(a, r.get_json()["job_id"], timeout=30)
    release.set()
    assert time.time() - t0 < 25, "the job waited for the stuck call instead of stopping at the time limit"
    assert st["status"] == "complete"
    cov = st["results"]["coverage"]
    assert cov["partial"] and cov["timed_out_sections"] >= 1 and any("too long" in w for w in cov["warnings"])


def test_if_nothing_answers_in_time_the_job_fails_and_never_reports_no_risks(world):
    _f, a, _b, mp = world
    import routes.contract_routes as cr
    import utils.ai_helper as ah
    mp.setenv("ANALYSIS_MAX_SECONDS", "6")

    def too_slow(chunk, strategy="Defensive", **kw):
        raise ah.AITimeout("AI_TIMEOUT: test")
    mp.setattr(cr, "analyze_contract_with_llm", too_slow)
    st = _wait(a, _start(a).get_json()["job_id"])
    assert st["status"] == "failed" and st.get("results") in (None, {})
    assert "too slow" in st["error"] and "nothing was checked" in st["error"]


def test_one_unreadable_answer_is_tried_once_more(world):
    _f, a, _b, mp = world
    import routes.contract_routes as cr
    seen = {}

    def first_time_bad(chunk, strategy="Defensive", **kw):
        seen[chunk[:20]] = seen.get(chunk[:20], 0) + 1
        if seen[chunk[:20]] == 1:
            raise ValueError("AI returned an unparseable contract analysis chunk")
        return {"summary": "ok", "clauses": []}
    mp.setattr(cr, "analyze_contract_with_llm", first_time_bad)
    st = _wait(a, _start(a).get_json()["job_id"])
    assert st["status"] == "complete" and st["results"]["coverage"]["failed_sections"] == 0


def test_findings_come_back_in_document_order_whichever_section_finishes_first(world):
    _f, a, _b, mp = world
    import routes.contract_routes as cr
    text = "\n\n".join(f"{i}. Clause {i}. " + (f"Payment is due within {i} days of the invoice and delay attracts interest at 24% per month. " * 14) for i in range(1, 30))

    def per_chunk(chunk, strategy="Defensive", **kw):
        n = int(chunk.split(".")[0].strip() or 1) if chunk[:1].isdigit() else 1
        time.sleep(0.4 if n < 10 else 0.0)                    # the later sections answer first
        first = chunk.split("\n\n")[0]
        return {"summary": "s", "clauses": [{"title": f"Finding in {first[:12]}", "original_text": first.strip()[:140], "risk_level": "Medium",
                                             "explanation": "x", "location": first[:10], "playbook_rule": "Indian Contract Act, 1872", "suggested_revision": "y"}]}
    mp.setattr(cr, "analyze_contract_with_llm", per_chunk)
    st = _wait(a, _start(a, text).get_json()["job_id"])
    assert st["status"] == "complete"
    positions = [text.find(c["original_text"]) for c in st["results"]["clauses"]]
    assert len(positions) >= 3 and positions == sorted(positions)


# ── restart, stall, loss ─────────────────────────────────────────────────────────────────────────────────
def _plant_job(job_id, **fields):
    from utils.job_store import save_local_job
    job = {"job_id": job_id, "status": "processing", "progress": 42, "stage": "Reading the contract: section 1 of 2",
           "created_at": time.time(), "updated_at": time.time(), "results": None, "error": None}
    job.update(fields)
    save_local_job(job_id, job)


def _owner_id(client):
    return int(client.get("/api/auth/me").get_json().get("user", {}).get("id") or client.get("/api/auth/me").get_json().get("id"))


def test_a_job_whose_server_restarted_fails_at_once_instead_of_spinning(world):
    """The 30-minute screen: the job file still said 'processing' at 42%, but the thread that was doing the work was gone."""
    _f, a, _b, _mp = world
    uid = _owner_id(a)
    _plant_job("local_restarted-0001", user_id=uid, worker_pid=os.getpid())       # this process has no such running job
    st = a.get("/api/contract/analysis-status/local_restarted-0001").get_json()
    assert st["status"] == "failed" and "restarted" in st["error"] and "nothing was checked" in st["error"]


def test_a_job_with_no_heartbeat_from_another_process_fails_after_the_stale_limit(world):
    _f, a, _b, mp = world
    import routes.contract_routes as cr
    uid = _owner_id(a)
    _plant_job("local_stale-0001", user_id=uid, worker_pid=-5, updated_at=time.time() - 10)
    assert a.get("/api/contract/analysis-status/local_stale-0001").get_json()["status"] == "processing"   # a fresh heartbeat: leave it alone
    _plant_job("local_stale-0002", user_id=uid, worker_pid=-5, updated_at=time.time() - cr.JOB_STALE_SECONDS - 5)
    assert a.get("/api/contract/analysis-status/local_stale-0002").get_json()["status"] == "failed"


def test_nothing_runs_longer_than_the_hard_limit(world):
    _f, a, _b, _mp = world
    import routes.contract_routes as cr
    uid = _owner_id(a)
    _plant_job("local_old-0001", user_id=uid, worker_pid=-5, created_at=time.time() - cr.JOB_HARD_LIMIT_SECONDS - 10)
    st = a.get("/api/contract/analysis-status/local_old-0001").get_json()
    assert st["status"] == "failed" and "20 minutes" in st["error"]


def test_an_unknown_job_is_a_plain_404_and_the_stream_ends_with_a_failure(world):
    _f, a, _b, _mp = world
    r = a.get("/api/contract/analysis-status/local_never-existed")
    assert r.status_code == 404
    assert "run it again" in r.get_json()["error"]


@pytest.mark.parametrize("job_id", ["..", "local_x/../../etc/passwd", "local_" + "a" * 200, "local_%00x", "local_a b"])
def test_job_ids_cannot_reach_other_files(world, job_id):
    _f, a, _b, _mp = world
    from utils import job_store
    assert job_store.get_local_job(job_id) is None and job_store._path(job_id) is None
    assert a.get(f"/api/contract/analysis-status/{job_id}").status_code in (404, 405)


# ── cancel, fairness, privacy ────────────────────────────────────────────────────────────────────────────
def _slow_ai(mp, seconds=30):
    import routes.contract_routes as cr
    gate = threading.Event()

    def slow(chunk, strategy="Defensive", **kw):
        gate.wait(seconds)
        return {"summary": "s", "clauses": []}
    mp.setattr(cr, "analyze_contract_with_llm", slow)
    return gate


def test_cancel_stops_a_running_analysis_and_only_its_owner_can_do_it(world):
    _f, a, b, mp = world
    gate = _slow_ai(mp)
    job = _start(a).get_json()["job_id"]
    time.sleep(1)
    assert b.post(f"/api/contract/cancel/{job}").status_code == 404                 # somebody else's job looks like it does not exist
    assert a.get(f"/api/contract/analysis-status/{job}").get_json()["status"] == "processing"
    assert a.post(f"/api/contract/cancel/{job}").status_code == 200
    st = _wait(a, job, timeout=20)
    gate.set()
    assert st["status"] == "failed" and "cancelled" in st["error"]


def test_one_person_cannot_start_unlimited_analyses(world):
    _f, a, b, mp = world
    gate = _slow_ai(mp)
    ids = []
    for _ in range(2):
        r = _start(a)
        assert r.status_code == 200
        ids.append(r.get_json()["job_id"])
    third = _start(a)
    assert third.status_code == 429 and third.get_json()["code"] == "TOO_MANY_ANALYSES"
    assert _start(b).status_code == 200                                            # another advocate is not affected
    gate.set()
    for j in ids:
        _wait(a, j, timeout=30)


def test_finished_jobs_do_not_keep_the_contract_in_server_memory(world):
    _f, a, _b, mp = world
    import routes.contract_routes as cr
    mp.setattr(cr, "analyze_contract_with_llm", lambda chunk, strategy="Defensive", **kw: {"summary": "s", "clauses": []})
    job = _start(a).get_json()["job_id"]
    _wait(a, job)
    time.sleep(0.3)
    assert job not in cr.LOCAL_JOBS and job not in cr._LIVE_JOBS


# ── bounded side steps and speed ─────────────────────────────────────────────────────────────────────────
def test_a_slow_precedent_search_is_skipped_with_a_warning_not_waited_for(world):
    _f, a, _b, mp = world
    import routes.contract_routes as cr
    import tasks.contract_tasks as ct
    mp.setattr(cr, "analyze_contract_with_llm", lambda chunk, strategy="Defensive", **kw: {"summary": "s", "clauses": [
        {"title": "t", "original_text": "Each party shall perform its duties with reasonable care and skill.", "risk_level": "Low", "explanation": "e",
         "location": "1", "playbook_rule": "Indian Contract Act, 1872", "suggested_revision": "r"}]})
    mp.setenv("PINECONE_API_KEY", "x")
    mp.setenv("PINECONE_HOST", "example.invalid")
    mp.setattr(ct, "PRECEDENT_SECONDS", 1.0)
    import types
    import sys
    slow = types.ModuleType("pinecone")

    class Slow:
        def __init__(self, *a, **k):
            time.sleep(6)
    slow.Pinecone = Slow
    mp.setitem(sys.modules, "pinecone", slow)
    t0 = time.time()
    st = _wait(a, _start(a, CONTRACT[:3000]).get_json()["job_id"])
    assert st["status"] == "complete" and time.time() - t0 < 5.5
    assert any("precedent" in w.lower() or "reported cases" in w.lower() for w in st["results"]["coverage"]["warnings"])
    assert st["results"]["citations"] == []


def test_removing_near_duplicates_stays_fast_for_hundreds_of_findings():
    from routes.contract_routes import is_near_duplicate_risk
    import random
    random.seed(7)
    words = [f"term{i}" for i in range(3000)]
    accepted = []
    t0 = time.time()
    for _ in range(400):
        text = " ".join(random.choice(words) for _ in range(120))
        if not is_near_duplicate_risk(text, accepted):
            accepted.append(text)
    assert time.time() - t0 < 6
    assert is_near_duplicate_risk(accepted[0] + " .", accepted)               # and it still spots a real duplicate


def test_the_status_answer_tells_the_screen_how_far_along_it_is(world):
    _f, a, _b, mp = world
    gate = _slow_ai(mp)
    job = _start(a).get_json()["job_id"]
    seen = None
    for _ in range(40):
        seen = a.get(f"/api/contract/analysis-status/{job}").get_json()
        if seen.get("sections_total"):
            break
        time.sleep(0.25)
    gate.set()
    assert seen["sections_total"] >= 1 and seen["sections_done"] == 0 and seen["deadline_at"] > time.time()
    _wait(a, job, timeout=30)


# ── more attacks: abuse, damaged files, odd text ─────────────────────────────────────────────────────────
def test_twelve_advocates_analyse_at_once_and_each_gets_only_their_own_result(tmp_path, monkeypatch):
    flask_app = make_app(tmp_path, monkeypatch)
    _no_network_ai(monkeypatch)
    import routes.contract_routes as cr
    monkeypatch.setattr(cr, "analyze_contract_with_llm", lambda chunk, strategy="Defensive", **kw: (time.sleep(0.2), {"summary": "Summary " + chunk[:12], "clauses": []})[1])
    users = [register(flask_app, f"u{i}@example.com") for i in range(12)]
    jobs = []
    for i, u in enumerate(users):
        r = _start(u, f"{i}. Own contract number {i}. " + "Each party shall comply with the law. " * 20)
        assert r.status_code == 200, r.get_json()
        jobs.append(r.get_json()["job_id"])
    for i, (u, j) in enumerate(zip(users, jobs)):
        st = _wait(u, j, timeout=60)
        assert st["status"] == "complete" and f"Own contract number {i}." in st["results"]["raw_text"]
        other = users[(i + 1) % 12]
        assert other.get(f"/api/contract/analysis-status/{j}").status_code == 404
        assert other.post(f"/api/contract/cancel/{j}").status_code == 404


def test_a_storm_of_status_checks_never_causes_a_server_error(world):
    _f, a, _b, mp = world
    gate = _slow_ai(mp)
    job = _start(a).get_json()["job_id"]
    codes = []

    def hammer():
        for _ in range(25):
            codes.append(a.get(f"/api/contract/analysis-status/{job}").status_code)
    threads = [threading.Thread(target=hammer) for _ in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    gate.set()
    assert codes and set(codes) <= {200, 429}, set(codes)
    _wait(a, job, timeout=30)


def test_cancel_after_the_end_and_cancel_twice_are_harmless(world):
    _f, a, _b, mp = world
    import routes.contract_routes as cr
    mp.setattr(cr, "analyze_contract_with_llm", lambda chunk, strategy="Defensive", **kw: {"summary": "s", "clauses": []})
    job = _start(a).get_json()["job_id"]
    st = _wait(a, job)
    assert st["status"] == "complete"
    assert a.post(f"/api/contract/cancel/{job}").status_code == 200
    assert a.post(f"/api/contract/cancel/{job}").status_code == 200
    assert a.get(f"/api/contract/analysis-status/{job}").get_json()["status"] == "complete"      # a finished result is not undone
    assert a.post("/api/contract/cancel/local_nothing-here").status_code == 404


def test_a_damaged_job_file_is_a_plain_404_not_a_server_error(world):
    _f, a, _b, _mp = world
    from utils import job_store
    with open(os.path.join(job_store.JOB_DIR, "local_damaged-0001.json"), "w", encoding="utf-8") as f:
        f.write("{not json")
    r = a.get("/api/contract/analysis-status/local_damaged-0001")
    assert r.status_code == 404
    assert a.post("/api/contract/cancel/local_damaged-0001").status_code == 404


def test_signed_out_visitors_cannot_poll_or_cancel(world):
    flask_app, a, _b, mp = world
    import routes.contract_routes as cr
    mp.setattr(cr, "analyze_contract_with_llm", lambda chunk, strategy="Defensive", **kw: {"summary": "s", "clauses": []})
    job = _start(a).get_json()["job_id"]
    anon = flask_app.test_client()
    assert anon.get(f"/api/contract/analysis-status/{job}").status_code == 401
    assert anon.post(f"/api/contract/cancel/{job}").status_code in (401, 403)
    assert anon.get(f"/api/contract/stream/{job}").status_code == 401


@pytest.mark.parametrize("label,text", [
    ("no whitespace at all", "x" * 400000),
    ("control characters and NULs", ("Clause 1. Payment is due in 30 days.\x00\x01\x07\x1b[31m\n\n" * 60)),
    ("right-to-left override", ("‮Clause 1‬. The Client shall pay within 30 days of invoice. " * 80)),
    ("only punctuation", "....;;;;,,,," * 5000),
    ("hindi and tamil", ("खंड 1. ग्राहक 30 दिनों के भीतर भुगतान करेगा। பிரிவு 2. வாடிக்கையாளர் 30 நாட்களுக்குள் செலுத்த வேண்டும். " * 60)),
], ids=["no-whitespace", "control-chars", "rtl-override", "punctuation", "hindi-tamil"])
def test_odd_text_finishes_quickly_with_an_answer_never_a_hang(world, label, text):
    _f, a, _b, mp = world
    import routes.contract_routes as cr
    mp.setattr(cr, "analyze_contract_with_llm", lambda chunk, strategy="Defensive", **kw: {"summary": "s", "clauses": []})
    r = _start(a, text)
    assert r.status_code in (200, 413, 422), (label, r.status_code)
    if r.status_code == 200:
        t0 = time.time()
        st = _wait(a, r.get_json()["job_id"], timeout=40)
        assert st["status"] in ("complete", "failed") and time.time() - t0 < 30, label


def test_a_quote_in_another_script_is_grounded_exactly(world):
    _f, a, _b, mp = world
    import routes.contract_routes as cr
    text = "खंड 1. यह अनुबंध किसी भी समय बिना सूचना के समाप्त किया जा सकता है। खंड 2. भुगतान 30 दिनों में देय है।"
    mp.setattr(cr, "analyze_contract_with_llm", lambda chunk, strategy="Defensive", **kw: {"summary": "s", "clauses": [
        {"title": "Termination", "original_text": "यह अनुबंध किसी भी समय बिना सूचना के समाप्त किया जा सकता है", "risk_level": "High", "explanation": "e", "location": "1",
         "playbook_rule": "Indian Contract Act, 1872", "suggested_revision": "r"}]})
    st = _wait(a, _start(a, text).get_json()["job_id"])
    assert st["status"] == "complete" and st["results"]["clauses"] and st["results"]["clauses"][0]["original_text"] in text


# ── the shared AI allowance ──────────────────────────────────────────────────────────────────────────────
def test_calls_are_paced_inside_the_per_minute_token_allowance(monkeypatch):
    import utils.ai_helper as ah
    monkeypatch.setenv("LLM_TPM_BUDGET", "1000")
    monkeypatch.setenv("LLM_TPM_WINDOW_SECONDS", "1.5")
    pacer = ah._TokenPacer()
    t0 = time.time()
    pacer.acquire(800)
    pacer.acquire(800)                                   # does not fit with the first: waits for the window to pass
    assert 1.2 < time.time() - t0 < 3.5


def test_pacing_never_waits_past_the_deadline(monkeypatch):
    import utils.ai_helper as ah
    monkeypatch.setenv("LLM_TPM_BUDGET", "1000")
    monkeypatch.setenv("LLM_TPM_WINDOW_SECONDS", "60")
    pacer = ah._TokenPacer()
    pacer.acquire(800)
    t0 = time.time()
    with pytest.raises(ah.AITimeout):
        pacer.acquire(800, deadline=time.time() + 5)
    assert time.time() - t0 < 1


def test_one_oversized_request_still_runs_instead_of_waiting_forever(monkeypatch):
    import utils.ai_helper as ah
    monkeypatch.setenv("LLM_TPM_BUDGET", "100")
    pacer = ah._TokenPacer()
    t0 = time.time()
    pacer.acquire(5000)
    assert time.time() - t0 < 0.5


def test_real_usage_replaces_the_reservation(monkeypatch):
    import utils.ai_helper as ah
    monkeypatch.setenv("LLM_TPM_BUDGET", "1000")
    pacer = ah._TokenPacer()
    ev = pacer.acquire(800)
    pacer.settle(ev, 100)                                # the call used far less than reserved: the room is given back
    t0 = time.time()
    pacer.acquire(800)
    assert time.time() - t0 < 0.5


# ── an old browser tab still uses the live stream: it must not hold a server thread for long ────────────
def test_the_live_stream_closes_by_itself_so_it_cannot_hold_a_server_worker(world):
    _f, a, _b, mp = world
    import routes.contract_routes as cr
    gate = _slow_ai(mp)
    mp.setattr(cr, "STREAM_MAX_SECONDS", 2)
    job = _start(a).get_json()["job_id"]
    t0 = time.time()
    r = a.get(f"/api/contract/stream/{job}")
    body = r.get_data(as_text=True)
    gate.set()
    assert r.status_code == 200 and time.time() - t0 < 6
    assert '"state": "PROGRESS"' in body and "FAILURE" not in body       # it ended quietly; the page checks again
    _wait(a, job, timeout=30)


# ── memory: the free server stops everything at 512 MB ─────────────────────────────────────────────────────
def test_a_new_analysis_is_refused_politely_when_the_server_is_nearly_out_of_memory(world):
    _f, a, _b, mp = world
    import routes.contract_routes as cr
    from utils import metrics
    mp.setattr(metrics, "rss_mb", lambda: 600)
    r = _start(a)
    assert r.status_code == 503 and r.get_json()["code"] == "SERVER_BUSY" and "try again" in r.get_json()["message"]
    mp.setattr(metrics, "rss_mb", lambda: 200)
    mp.setattr(cr, "analyze_contract_with_llm", lambda chunk, strategy="Defensive", **kw: {"summary": "s", "clauses": []})
    assert _start(a).status_code == 200


def test_the_status_page_shows_memory_use(world):
    flask_app, a, _b, _mp = world
    r = a.get("/api/status")
    assert r.status_code == 200 and isinstance(r.get_json().get("memory_mb"), int) and r.get_json()["memory_mb"] > 0
