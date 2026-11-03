"""One real call per language against the assistant's router, to see what the live key actually does.

NOT part of the test suite and never run by it: it spends real tokens. Run it yourself when you want the numbers.

    .\\.venv\\Scripts\\python.exe scripts\\assistant_smoke.py

It prints, per command: the model that answered, whether the reply was readable JSON, the feature and action proposed,
whether that proposal survives the registry allowlist, whether it would need Confirm, and the REAL total_tokens the
provider reported. Nothing is written to any database and no user data is touched.

Reads GROQ_API_KEY (or OPENAI_API_KEY) from the environment the same way the app does. It never prints a key.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

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


def main():
    if not (os.getenv("GROQ_API_KEY") or os.getenv("OPENAI_API_KEY")):
        print("No model key in the environment. Set GROQ_API_KEY (or OPENAI_API_KEY) and run again.")
        return 1

    print(f"registry: {len(reg.features())} features")
    eng, eng_fb = assistant_models(indic=False)
    ind, ind_fb = assistant_models(indic=True)
    print(f"english chain: {eng} -> {eng_fb}")
    print(f"indic chain:   {ind} -> {ind_fb}")
    print("-" * 100)

    grand_total = 0
    for label, text, hint in COMMANDS:
        candidates = reg.find_candidates(text)
        indic = router.is_indic(text, hint)
        estimate = router.estimate_tokens(router.build_messages(text, candidates)[0]["content"]) + router.estimate_tokens(text)
        print(f"\n[{label}] {text}")
        print(f"  candidates : {[c['id'] for c in candidates] or 'none'}")
        print(f"  indic      : {indic}   estimated tokens: {estimate}")
        if not candidates:
            print("  -> no candidate feature, so the route would ask a question without calling a model")
            continue

        started = time.time()
        try:
            proposal = router.call_router_model(text, candidates, indic=indic)
        except router.AssistantBusy:
            print("  -> ASSISTANT_BUSY: the shared token allowance had no room within 3s")
            continue
        except router.RouterUnavailable as exc:
            print(f"  -> ASSISTANT_UNAVAILABLE: every model failed ({exc})")
            continue
        took = time.time() - started

        # call_router_model logs the model and the real usage; read them back from the pacer's last settled event.
        from utils.ai_helper import _PACER
        real_tokens = _PACER._events[-1][1] if _PACER._events else 0
        grand_total += int(real_tokens or 0)

        print(f"  valid JSON : {'yes' if proposal is not None else 'NO'}   took {took:.1f}s   real total_tokens: {real_tokens}")
        if proposal is None:
            print("  -> the route would ask a question (no retry)")
            continue
        checked = reg.validate_proposal(proposal, allowed_feature_ids=[c["id"] for c in candidates])
        if checked.get("ok"):
            print(f"  proposal   : {checked['feature']}.{checked['action']} inputs={checked['inputs']}")
            print(f"  confirm?   : {'YES - the lawyer must confirm' if checked['requires_confirm'] else 'no, read-only'}")
        else:
            print(f"  proposal   : refused by the registry ({checked['reason']}) -> clarify: {checked['question']}")

    print("-" * 100)
    print(f"real tokens spent in this run: {grand_total} (the account allows about 8000 per minute, shared)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
