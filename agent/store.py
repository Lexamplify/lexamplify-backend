"""SQLite persistence for agent tasks. Same _ensure_schema pattern as the
rest of the app (see routes/letterhead_routes.py); tables live in the one
consolidated database. All functions take an explicit db_path so tests can
point them at a throwaway file.
"""
import json
import sqlite3
import uuid
from datetime import datetime, timezone

TASK_STATES = ("CREATED", "PLANNING", "EXECUTING", "RECOVERING", "WAITING_FOR_USER",
               "WAITING_FOR_APPROVAL", "VERIFYING", "COMPLETED", "FAILED", "CANCELLED")
STEP_STATES = ("PENDING", "RUNNING", "DONE", "FAILED", "SKIPPED")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, workspace_id INTEGER,
  instruction TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'CREATED',
  plan_json TEXT, result_json TEXT, error_json TEXT,
  created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS agent_steps (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, idx INTEGER NOT NULL,
  tool TEXT NOT NULL, inputs_json TEXT, depends_on_json TEXT,
  risk TEXT NOT NULL DEFAULT 'A', state TEXT NOT NULL DEFAULT 'PENDING',
  output_json TEXT, verification TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS agent_checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, step_idx INTEGER NOT NULL,
  snapshot_json TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS agent_failure_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT, error_code TEXT NOT NULL, tool TEXT,
  signature TEXT, resolution_json TEXT, verified INTEGER NOT NULL DEFAULT 0, created_at TEXT);
CREATE TABLE IF NOT EXISTS agent_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, who TEXT NOT NULL,
  text TEXT NOT NULL, created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_agent_steps_task ON agent_steps(task_id, idx);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_user ON agent_tasks(user_id, workspace_id);
"""


def _now():
    return datetime.now(timezone.utc).isoformat()


def connect(db_path):
    conn = sqlite3.connect(db_path, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.executescript(_SCHEMA)
    return conn


def create_task(db_path, user_id, workspace_id, instruction):
    task_id = uuid.uuid4().hex
    with connect(db_path) as c:
        c.execute("INSERT INTO agent_tasks (id, user_id, workspace_id, instruction, state, created_at, updated_at) "
                  "VALUES (?,?,?,?, 'CREATED', ?, ?)",
                  (task_id, user_id, workspace_id, instruction, _now(), _now()))
    return task_id


def set_task_state(db_path, task_id, state, result=None, error=None):
    assert state in TASK_STATES, state
    with connect(db_path) as c:
        c.execute("UPDATE agent_tasks SET state=?, result_json=COALESCE(?, result_json), "
                  "error_json=COALESCE(?, error_json), updated_at=? WHERE id=?",
                  (state, json.dumps(result) if result is not None else None,
                   json.dumps(error) if error is not None else None, _now(), task_id))


def save_plan(db_path, task_id, plan):
    """plan: list of dicts {tool, inputs, depends_on, risk}."""
    with connect(db_path) as c:
        c.execute("UPDATE agent_tasks SET plan_json=?, updated_at=? WHERE id=?",
                  (json.dumps(plan), _now(), task_id))
        c.execute("DELETE FROM agent_steps WHERE task_id=?", (task_id,))
        for i, s in enumerate(plan):
            c.execute("INSERT INTO agent_steps (id, task_id, idx, tool, inputs_json, depends_on_json, risk, state, "
                      "idempotency_key, updated_at) VALUES (?,?,?,?,?,?,?, 'PENDING', ?, ?)",
                      (uuid.uuid4().hex, task_id, i, s["tool"], json.dumps(s.get("inputs") or {}),
                       json.dumps(s.get("depends_on") or []), s.get("risk", "A"),
                       f"{task_id}:{i}", _now()))


def get_task(db_path, task_id):
    with connect(db_path) as c:
        t = c.execute("SELECT * FROM agent_tasks WHERE id=?", (task_id,)).fetchone()
        if not t:
            return None
        steps = c.execute("SELECT * FROM agent_steps WHERE task_id=? ORDER BY idx", (task_id,)).fetchall()
        msgs = c.execute("SELECT who, text, created_at FROM agent_messages WHERE task_id=? ORDER BY id", (task_id,)).fetchall()
    task = dict(t)
    task["plan"] = json.loads(task.pop("plan_json") or "[]")
    task["result"] = json.loads(task.pop("result_json") or "null")
    task["error"] = json.loads(task.pop("error_json") or "null")
    task["steps"] = [dict(s, inputs=json.loads(s["inputs_json"] or "{}"),
                          output=json.loads(s["output_json"] or "null")) for s in steps]
    task["messages"] = [dict(m) for m in msgs]
    return task


def list_tasks(db_path, user_id, workspace_id=None, limit=50):
    with connect(db_path) as c:
        if workspace_id is not None:
            rows = c.execute("SELECT id, instruction, state, created_at, updated_at FROM agent_tasks "
                             "WHERE user_id=? AND workspace_id=? ORDER BY created_at DESC LIMIT ?",
                             (user_id, workspace_id, limit)).fetchall()
        else:
            rows = c.execute("SELECT id, instruction, state, created_at, updated_at FROM agent_tasks "
                             "WHERE user_id=? ORDER BY created_at DESC LIMIT ?", (user_id, limit)).fetchall()
    return [dict(r) for r in rows]


def set_step(db_path, task_id, idx, state=None, output=None, verification=None, bump_attempts=False):
    sets, args = ["updated_at=?"], [_now()]
    if state:
        assert state in STEP_STATES, state
        sets.append("state=?"); args.append(state)
    if output is not None:
        sets.append("output_json=?"); args.append(json.dumps(output))
    if verification is not None:
        sets.append("verification=?"); args.append(verification)
    if bump_attempts:
        sets.append("attempts=attempts+1")
    args += [task_id, idx]
    with connect(db_path) as c:
        c.execute(f"UPDATE agent_steps SET {', '.join(sets)} WHERE task_id=? AND idx=?", args)


def add_message(db_path, task_id, who, text):
    with connect(db_path) as c:
        c.execute("INSERT INTO agent_messages (task_id, who, text, created_at) VALUES (?,?,?,?)",
                  (task_id, who, text, _now()))


def save_checkpoint(db_path, task_id, step_idx, snapshot):
    with connect(db_path) as c:
        c.execute("INSERT INTO agent_checkpoints (task_id, step_idx, snapshot_json, created_at) VALUES (?,?,?,?)",
                  (task_id, step_idx, json.dumps(snapshot), _now()))


def record_failure(db_path, error_code, tool, signature, resolution, verified=False):
    with connect(db_path) as c:
        c.execute("INSERT INTO agent_failure_memory (error_code, tool, signature, resolution_json, verified, created_at) "
                  "VALUES (?,?,?,?,?,?)", (error_code, tool, signature, json.dumps(resolution), int(verified), _now()))


def lookup_failure(db_path, error_code, tool):
    with connect(db_path) as c:
        r = c.execute("SELECT resolution_json FROM agent_failure_memory WHERE error_code=? AND tool=? AND verified=1 "
                      "ORDER BY id DESC LIMIT 1", (error_code, tool)).fetchone()
    return json.loads(r["resolution_json"]) if r else None
