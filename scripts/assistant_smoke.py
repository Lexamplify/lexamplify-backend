"""One real call per language against the assistant's router, to see what the live key actually does.

NOT part of the test suite and never run by it against a real key: it spends real tokens. Run it yourself.

    .\\.venv\\Scripts\\python.exe scripts\\assistant_smoke.py

For each command it prints
  * the candidate block that is sent to the model (the static rules text is printed once at the top),
  * every model call made: the model asked for, the model that answered, finish_reason, and the REAL prompt, completion
    and total token counts the provider reported,
  * the model's RAW reply, exactly as it came back,
  * what the model wrote for "feature" and "action",
  * and the verdict POST /api/assistant/command would reach: a proposal, or a clarify question and the reason.

The verdict mirrors the route on purpose (see classify()): a reply with a null feature or action is a question the model
asked, not a refusal by the registry. tests/test_assistant_command.py checks the two never disagree.

The reply shown under "after clean-up" is what call_router_model hands the route: the feature id and action trimmed,
lower-cased and with one trailing "*" dropped, and the inputs cut down to what the lawyer actually said (a date only if
those exact words are in the command). The RAW REPLY above it is untouched.

Keys: the script loads .env the way app.py does (python-dotenv, never overriding a variable that is already set) and never
prints a key, a header or the environment. Nothing is written to any database.
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from utils import feature_registry as reg            # noqa: E402
from utils import assistant_router as router         # noqa: E402
from utils.model_config import assistant_models      # noqa: E402

COMMANDS = [
    ("English", "add a hearing next Tuesday in the calendar", None),
    ("English", "find the rent agreement in the document hub", None),
    ("Hindi (Devanagari)", "कल की सुनवाई दिखाओ", None),
    ("Hindi (Roman)", "kal ki sunwai ka notice draft karna hai", "hi"),
    ("Tamil", "அடுத்த வாரம் விசாரணை காட்டு", None),
]


def classify(proposal, candidates):
    """What POST /api/assistant/command does with a parsed model reply.

    Mirrors the route's order exactly: an unreadable reply is a question; a null feature or action is a question the MODEL
    chose to ask; anything else is checked against the registry and the features that were offered.
    """
    if proposal is None:
        return {"verdict": "clarify", "why": "unreadable_reply", "question": None}
    if proposal.get("feature") is None or proposal.get("action") is None:
        asked = proposal.get("question")
        return {"verdict": "clarify", "why": "model_asked_a_question", "question": asked if isinstance(asked, str) else None}
    checked = reg.validate_proposal(proposal, allowed_feature_ids=[c["id"] for c in candidates])
    if not checked.get("ok"):
        return {"verdict": "clarify", "why": checked["reason"], "question": checked["question"]}
    return {"verdict": "ok", "why": None, "feature": checked["feature"], "action": checked["action"],
            "inputs": checked["inputs"], "requires_confirm": checked["requires_confirm"]}


_OPTION_KEYS = ("response_format", "reasoning_effort")


def install_recorder(calls):
    """Wrap llm_client.completion so every model call is recorded (reply, finish_reason, real usage) without changing it.
    Returns a function that puts the original back. Only the reply and the numbers are kept: never the messages, never a key."""
    from utils import llm_client
    original = llm_client.completion

    def recording(*args, **kwargs):
        entry = {"asked": kwargs.get("model"), "fallbacks": list(kwargs.get("fallbacks") or []),
                 "options": [k for k in _OPTION_KEYS if k in kwargs], "max_tokens": kwargs.get("max_tokens")}
        try:
            res = original(*args, **kwargs)
        except Exception as exc:  # noqa: BLE001 - the provider's own text can hold account details: class and status only
            entry["error"] = f"{type(exc).__name__} (status {getattr(exc, 'status', 0)})"
            calls.append(entry)
            raise
        usage = getattr(res, "usage", None)
        choice = res.choices[0] if getattr(res, "choices", None) else None
        entry.update(answered_by=getattr(res, "model", None),
                     content=getattr(getattr(choice, "message", None), "content", None),
                     finish=getattr(choice, "finish_reason", None),
                     prompt_tokens=getattr(usage, "prompt_tokens", None),
                     completion_tokens=getattr(usage, "completion_tokens", None),
                     total=int(getattr(usage, "total_tokens", 0) or 0))
        calls.append(entry)
        return res

    llm_client.completion = recording

    def restore():
        llm_client.completion = original
    return restore


def _indent(text, pad="      "):
    return "\n".join(pad + line for line in str(text).splitlines()) or pad


def main(load_env=True):
    if load_env:
        try:
            from dotenv import load_dotenv
            load_dotenv(os.path.join(ROOT, ".env"), override=False)     # the same call app.py makes; never overrides, never prints
        except ImportError:
            pass

    if not (os.getenv("GROQ_API_KEY") or os.getenv("OPENAI_API_KEY")):
        print("No model key found (set GROQ_API_KEY or OPENAI_API_KEY in the environment or in .env) and run again.")
        return 1

    print(f"registry: {len(reg.features())} features")
    eng, eng_fb = assistant_models(indic=False)
    ind, ind_fb = assistant_models(indic=True)
    print(f"english chain: {eng} -> {eng_fb}")
    print(f"indic chain:   {ind} -> {ind_fb}")
    print("\nSTATIC RULES TEXT (sent as the start of the system message every time):")
    print(_indent(router.SYSTEM_PROMPT.rstrip()))
    print("=" * 100)

    calls = []
    restore = install_recorder(calls)
    grand_total = 0
    try:
        for label, text, hint in COMMANDS:
            candidates = reg.find_candidates(text)
            indic = router.is_indic(text, hint)
            block = router.candidate_block(candidates)
            estimate = router.estimate_tokens(router.build_messages(text, candidates)[0]["content"]) + router.estimate_tokens(text)
            print(f"\n[{label}] {text}")
            print(f"  candidates : {[c['id'] for c in candidates] or 'none'}")
            print(f"  indic      : {indic}   estimated prompt tokens: {estimate}")
            print("  CANDIDATE BLOCK SENT TO THE MODEL:")
            print(_indent(block or "(none)"))
            if not candidates:
                print("  -> no candidate feature, so the route asks a question without calling a model")
                continue

            del calls[:]
            started = time.time()
            try:
                proposal = router.call_router_model(text, candidates, indic=indic)
            except router.AssistantBusy:
                print("  -> ASSISTANT_BUSY: the shared token allowance had no room within 3s")
                continue
            except router.RouterUnavailable as exc:
                for i, c in enumerate(calls, 1):
                    print(f"  model call {i}: asked={c['asked']} -> {c.get('error', 'no error recorded')}")
                print(f"  -> ASSISTANT_UNAVAILABLE: every model failed ({exc})")
                continue
            took = time.time() - started

            for i, c in enumerate(calls, 1):
                print(f"  model call {i}: asked={c['asked']} options={c['options'] or 'none'} max_tokens={c['max_tokens']}")
                if "error" in c:
                    print(f"    error: {c['error']}")
                    continue
                grand_total += c["total"]
                print(f"    answered_by={c['answered_by']} finish_reason={c['finish']}  tokens: prompt={c['prompt_tokens']} "
                      f"completion={c['completion_tokens']} total={c['total']}")
                print("    RAW REPLY:")
                print(_indent(c["content"] if (c["content"] or "").strip() else "<empty reply>", "      "))

            print(f"  valid JSON : {'yes' if proposal is not None else 'NO'}   took {took:.1f}s")
            if proposal is not None:
                print(f"  after clean-up (ids trimmed/lower-cased/one '*' dropped; inputs cut to the lawyer's own words): "
                      f"feature={proposal.get('feature')!r}  action={proposal.get('action')!r}  inputs={proposal.get('inputs')!r}")
                if proposal.get("feature") is not None:
                    shown = {c["id"]: [a["id"] for a in c["actions"]] for c in candidates}
                    print(f"  allowed    : {shown}")
            verdict = classify(proposal, candidates)
            if verdict["verdict"] == "ok":
                print(f"  route says : PROPOSAL {verdict['feature']}.{verdict['action']} inputs={verdict['inputs']}  "
                      f"{'(needs Confirm)' if verdict['requires_confirm'] else '(read-only, no Confirm)'}")
            else:
                print(f"  route says : CLARIFY because {verdict['why']}")
                if verdict["question"]:
                    print(f"               question: {verdict['question']}")
    finally:
        restore()

    print("=" * 100)
    print(f"real tokens spent in this run: {grand_total} (the account allows about 8000 per minute, shared)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
