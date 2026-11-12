"""The Agent Engine: a deterministic state machine that owns the task
lifecycle. The LLM plans (and later helps recover); the engine executes,
checkpoints, retries within bounds, verifies, and persists every move.
"""
import traceback

from agent import context, planner, store
from agent.tools import registry
from agent.tools.registry import VERIFIED_SUCCESS, PARTIALLY_VERIFIED

MAX_ATTEMPTS_PER_STEP = 2


def submit_task(db_path, user_id, workspace_id, instruction):
    """Create -> plan -> execute (synchronously for v1). Returns the full task dict."""
    task_id = store.create_task(db_path, user_id, workspace_id, instruction)
    store.add_message(db_path, task_id, "you", instruction)
    ctx = {"db_path": db_path, "user_id": user_id, "workspace_id": workspace_id}

    store.set_task_state(db_path, task_id, "PLANNING")
    try:
        ctx_note = context.fetch(db_path, user_id, workspace_id)["note"]
        kind, payload, reply = planner.make_plan(instruction, context_note=ctx_note)
    except planner.PlanError as e:
        store.set_task_state(db_path, task_id, "FAILED", error={"code": e.code, "message": str(e)})
        store.add_message(db_path, task_id, "ai", f"I couldn't plan that: {e}")
        return store.get_task(db_path, task_id)
    except Exception as e:  # provider/network problems — fail cleanly, never crash the route
        store.set_task_state(db_path, task_id, "FAILED",
                             error={"code": "EXTERNAL_SERVICE_UNAVAILABLE", "message": str(e)})
        store.add_message(db_path, task_id, "ai", f"The AI service is unavailable: {e}")
        return store.get_task(db_path, task_id)

    if kind == "question":
        store.set_task_state(db_path, task_id, "WAITING_FOR_USER")
        store.add_message(db_path, task_id, "ai", payload)
        return store.get_task(db_path, task_id)

    store.save_plan(db_path, task_id, payload)
    store.add_message(db_path, task_id, "ai", reply)
    return _execute(ctx, task_id)


def resume_with_answer(db_path, user_id, workspace_id, task_id, answer):
    """User answered a WAITING_FOR_USER question: re-plan with the original
    instruction + the answer as added context."""
    task = store.get_task(db_path, task_id)
    if not task or task["state"] != "WAITING_FOR_USER":
        return task
    store.add_message(db_path, task_id, "you", answer)
    combined = f"{task['instruction']}\n\nAdditional details from the user: {answer}"
    ctx = {"db_path": db_path, "user_id": user_id, "workspace_id": workspace_id}

    store.set_task_state(db_path, task_id, "PLANNING")
    try:
        ctx_note = context.fetch(db_path, user_id, workspace_id)["note"]
        kind, payload, reply = planner.make_plan(combined, context_note=ctx_note)
    except Exception as e:
        store.set_task_state(db_path, task_id, "FAILED", error={"code": "VALIDATION_FAILED", "message": str(e)})
        store.add_message(db_path, task_id, "ai", f"I couldn't plan that: {e}")
        return store.get_task(db_path, task_id)

    if kind == "question":
        store.set_task_state(db_path, task_id, "WAITING_FOR_USER")
        store.add_message(db_path, task_id, "ai", payload)
        return store.get_task(db_path, task_id)

    store.save_plan(db_path, task_id, payload)
    store.add_message(db_path, task_id, "ai", reply)
    return _execute(ctx, task_id)


def approve_step(db_path, user_id, workspace_id, task_id, step_idx, decision):
    """Resolve a WAITING_FOR_APPROVAL task: approve executes the held step,
    reject skips it and fails the task."""
    task = store.get_task(db_path, task_id)
    if not task or task["state"] != "WAITING_FOR_APPROVAL":
        return task
    ctx = {"db_path": db_path, "user_id": user_id, "workspace_id": workspace_id}
    if decision != "approve":
        store.set_step(db_path, task_id, step_idx, state="SKIPPED")
        store.set_task_state(db_path, task_id, "CANCELLED")
        store.add_message(db_path, task_id, "ai", "Okay — I won't do that. Task cancelled.")
        return store.get_task(db_path, task_id)
    store.add_message(db_path, task_id, "you", "Approved.")
    return _execute(ctx, task_id, approved_idx=step_idx)


def _execute(ctx, task_id, approved_idx=None):
    db_path = ctx["db_path"]
    store.set_task_state(db_path, task_id, "EXECUTING")
    task = store.get_task(db_path, task_id)
    results = {}
    for s in task["steps"]:
        if s["state"] == "DONE":
            results[s["idx"]] = s["output"]

    for step in task["steps"]:
        idx = step["idx"]
        if step["state"] in ("DONE", "SKIPPED"):
            continue
        tool = registry.get_tool(step["tool"])

        # Category C holds for human approval unless this exact step was just approved.
        if tool.risk == "C" and approved_idx != idx:
            store.set_task_state(db_path, task_id, "WAITING_FOR_APPROVAL")
            store.add_message(db_path, task_id, "ai",
                              f"Step {idx + 1} ({tool.name}) is consequential and needs your approval before I run it.")
            return store.get_task(db_path, task_id)

        output, last_err = None, None
        for attempt in range(MAX_ATTEMPTS_PER_STEP):
            store.set_step(db_path, task_id, idx, state="RUNNING", bump_attempts=True)
            try:
                output = tool.run(ctx, step["inputs"])
                last_err = None
                break
            except Exception as e:
                last_err = e
                store.record_failure(db_path, "UNKNOWN_ERROR", tool.name,
                                     f"{type(e).__name__}: {e}", {"traceback": traceback.format_exc()[-800:]})

        if last_err is not None:
            store.set_step(db_path, task_id, idx, state="FAILED",
                           output={"error": f"{type(last_err).__name__}: {last_err}"})
            store.set_task_state(db_path, task_id, "FAILED",
                                 error={"code": "UNKNOWN_ERROR", "message": str(last_err), "step": idx})
            store.add_message(db_path, task_id, "ai",
                              f"Step {idx + 1} ({tool.name}) failed after {MAX_ATTEMPTS_PER_STEP} attempts: {last_err}")
            return store.get_task(db_path, task_id)

        store.set_task_state(db_path, task_id, "VERIFYING")
        classification, evidence = tool.verify(ctx, step["inputs"], output)
        store.set_step(db_path, task_id, idx, state="DONE", output=output,
                       verification=f"{classification}: {evidence}")
        store.save_checkpoint(db_path, task_id, idx, {"output": output, "verification": classification})

        if classification not in (VERIFIED_SUCCESS, PARTIALLY_VERIFIED):
            store.set_task_state(db_path, task_id, "FAILED",
                                 error={"code": "VALIDATION_FAILED",
                                        "message": f"verification failed at step {idx}: {evidence}", "step": idx})
            store.add_message(db_path, task_id, "ai",
                              f"I ran step {idx + 1} but could not verify it worked ({evidence}), so I'm not marking this done.")
            return store.get_task(db_path, task_id)

        results[idx] = output
        store.set_task_state(db_path, task_id, "EXECUTING")

    summary = _summarize(results)
    store.set_task_state(db_path, task_id, "COMPLETED", result={"steps": results})
    store.add_message(db_path, task_id, "ai", summary)
    return store.get_task(db_path, task_id)


def _summarize(results):
    notes = []
    for idx in sorted(results):
        out = results[idx] or {}
        if out.get("duplicate"):
            notes.append(out.get("note", "Skipped a duplicate."))
        elif "matter_id" in out:
            notes.append(f"Created matter #{out['matter_id']} — “{out.get('title', '')}”.")
        elif "event_id" in out:
            notes.append(f"Added “{out.get('title', '')}” to the calendar for {out.get('event_date', '')}.")
        elif "conflict" in out:
            notes.append(out.get("note", ""))
        elif "navigate_to" in out:
            notes.append(f"Opening {out['navigate_to']} for you.")
        elif "documents" in out:
            notes.append(f"Found {out.get('count', 0)} documents in the vault.")
        elif "matters" in out:
            notes.append(f"Found {out.get('count', 0)} matters in this workspace.")
    return " ".join(notes) or "Done. All steps completed and verified."
