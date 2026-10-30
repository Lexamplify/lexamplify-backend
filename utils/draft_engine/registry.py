"""Document-type registry: loads utils/doc_types/*.json and checks each definition is well formed.

A definition is data, not code: slots (what must be asked), fixed block text with {{slot|filter}} anchors,
the statutes it cites and the timelines it relies on. Adding a document type means adding a JSON file.
"""
import json
import os
import re
from functools import lru_cache

TYPES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "doc_types")

SLOT_TYPES = {"name", "address", "text", "longtext", "date", "amount", "cheque_no", "mobile", "pan", "gstin",
              "pin", "ifsc", "number", "choice"}
BLOCK_TYPES = {"title", "heading", "para", "numbered", "lettered", "address", "right", "center", "signature",
               "table", "pagebreak", "spacer"}
FILTERS = {"date", "inr", "words", "upper", "plain"}
REF_RE = re.compile(r"\{\{\s*([a-z0-9_]+)(?:\|([a-z_]+))?\s*\}\}")


class RegistryError(ValueError):
    pass


def _check(defn: dict, fname: str) -> None:
    for key in ("id", "label", "slots", "blocks"):
        if key not in defn:
            raise RegistryError(f"{fname}: missing '{key}'")
    ids = [s.get("id") for s in defn["slots"]]
    if len(ids) != len(set(ids)):
        raise RegistryError(f"{fname}: duplicate slot ids")
    for s in defn["slots"]:
        if s.get("type") not in SLOT_TYPES:
            raise RegistryError(f"{fname}: slot {s.get('id')} has unknown type {s.get('type')!r}")
        if not s.get("label"):
            raise RegistryError(f"{fname}: slot {s.get('id')} has no label")
    known = set(ids)

    def refs(text):
        for m in REF_RE.finditer(text or ""):
            if m.group(1) not in known:
                raise RegistryError(f"{fname}: block refers to unknown slot {m.group(1)!r}")
            if m.group(2) and m.group(2) not in FILTERS:
                raise RegistryError(f"{fname}: unknown filter {m.group(2)!r}")

    for b in defn["blocks"]:
        if b.get("type") not in BLOCK_TYPES:
            raise RegistryError(f"{fname}: unknown block type {b.get('type')!r}")
        refs(b.get("text", ""))
        for line in b.get("lines", []) or []:
            refs(line)
        if b.get("each") and b["each"] not in known:
            raise RegistryError(f"{fname}: 'each' refers to unknown slot {b['each']!r}")
        for w in b.get("when", []) or []:
            if w not in known:
                raise RegistryError(f"{fname}: 'when' refers to unknown slot {w!r}")
        for row in b.get("rows", []) or []:
            for cell in row:
                refs(cell)


@lru_cache(maxsize=1)
def _load() -> dict:
    out = {}
    for fname in sorted(os.listdir(TYPES_DIR)):
        if not fname.endswith(".json") or fname == "statutes.json":
            continue
        with open(os.path.join(TYPES_DIR, fname), encoding="utf-8") as fh:
            defn = json.load(fh)
        _check(defn, fname)
        if defn["id"] in out:
            raise RegistryError(f"duplicate document type id {defn['id']}")
        out[defn["id"]] = defn
    return out


def all_types() -> dict:
    return _load()


def get_type(type_id: str):
    return _load().get(str(type_id or ""))


def list_types() -> list:
    """What the picker shows: id, label, how long it takes, how many questions, and the review status."""
    rows = []
    for d in _load().values():
        rows.append({
            "id": d["id"], "label": d["label"], "short": d.get("short") or d["label"],
            "category": d.get("category", "other"), "minutes": d.get("minutes", 5),
            "required_count": sum(1 for s in d["slots"] if s.get("required")),
            "review": d.get("review", {}).get("status", "unreviewed"),
        })
    return sorted(rows, key=lambda r: r["short"].lower())


def public_definition(type_id: str):
    """The slots and statutory notes the wizard needs. The block text stays server-side."""
    d = get_type(type_id)
    if not d:
        return None
    return {
        "id": d["id"], "label": d["label"], "short": d.get("short") or d["label"],
        "minutes": d.get("minutes", 5), "review": d.get("review", {}),
        "timelines": d.get("timelines", []), "statutes": d.get("statutes", []), "notes": d.get("notes", []),
        "slots": d["slots"],
    }
