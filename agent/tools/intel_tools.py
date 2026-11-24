"""Application-intelligence tools: ask the codebase index (A) and rebuild
it (A). Answers carry file:line evidence and the git commit the index was
built from, so a stale index is visible, not silent."""
import os

from agent import intel
from agent.tools.registry import Tool, register, VERIFIED_SUCCESS, PARTIALLY_VERIFIED


def _repo_root():
    return os.getcwd()


def _ask_codebase(ctx, inputs):
    res = intel.search_code(ctx["db_path"], inputs.get("question") or "")
    return {"hits": res["hits"], "count": len(res["hits"]),
            "commit": res.get("commit"), "indexed_at": res.get("indexed_at")}


def _verify_ask(ctx, i, out):
    if out.get("commit") is None:
        return (PARTIALLY_VERIFIED, "code index has never been built — run index_codebase first")
    return (VERIFIED_SUCCESS, f"answered from index built at commit {out['commit']}")


register(Tool(
    name="ask_codebase",
    description="Look up where something lives in the LexAmplify codebase (routes, functions, classes) "
                "with file:line evidence. Requires question.",
    required_inputs=["question"], risk="A",
    run=_ask_codebase, verify=_verify_ask,
))


def _index_codebase(ctx, inputs):
    return intel.scan_repo(_repo_root(), ctx["db_path"])


register(Tool(
    name="index_codebase",
    description="(Re)build the codebase knowledge index. Run when the code has changed.",
    required_inputs=[], risk="A",
    run=_index_codebase,
    verify=lambda c, i, out: ((VERIFIED_SUCCESS, f"indexed {out['symbols']} symbols from {out['files']} files @ {out['commit']}")
                              if out.get("symbols") else (PARTIALLY_VERIFIED, "index built but empty")),
))
