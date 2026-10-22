"""The route table, frozen: a refactor may not quietly drop a route, rename it or move it.

The app has 364 routes. Nobody can check 364 of them by eye, so the whole table is written down in
tests/route_snapshot.txt - one line per route: its methods, its path, its endpoint and whether the sign-in
gate lets anyone through. This test walks app.url_map and compares it with that file. A route that
disappears, appears, changes name or changes sides fails the build.

Regenerate the file on purpose only, and read the diff before you commit it:
    REGENERATE_ROUTE_SNAPSHOT=1 python -m pytest tests/test_route_snapshot.py -q
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_gate import gate_class      # noqa: E402
from helpers_app import make_app     # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SNAPSHOT_FILE = os.path.join(HERE, "route_snapshot.txt")
REGENERATE = os.environ.get("REGENERATE_ROUTE_SNAPSHOT") == "1"


def snapshot_lines(flask_app):
    rows = []
    for rule in flask_app.url_map.iter_rules():
        methods = sorted(m for m in rule.methods if m not in ("HEAD", "OPTIONS"))
        if not methods:
            continue
        line = " | ".join([",".join(methods), rule.rule, rule.endpoint, gate_class(rule.rule)])
        rows.append(((rule.rule, ",".join(methods)), line))
    return [line for _key, line in sorted(rows, key=lambda r: r[0])]


def read_snapshot():
    if not os.path.isfile(SNAPSHOT_FILE):
        pytest.fail(f"{SNAPSHOT_FILE} is missing - write it with REGENERATE_ROUTE_SNAPSHOT=1")
    with open(SNAPSHOT_FILE, encoding="utf-8") as fh:
        return [line.rstrip("\n") for line in fh if line.strip()]


@pytest.fixture()
def app(tmp_path, monkeypatch):
    monkeypatch.setenv("DMS_STRICT_MOUNT", "1")     # a hub that cannot start must fail the test, not shrink the table
    return make_app(tmp_path, monkeypatch, name="snapshot.db")


def test_the_route_table_has_not_changed(app):
    current = snapshot_lines(app)
    assert current, "no routes at all - the app did not start properly"

    if REGENERATE:
        with open(SNAPSHOT_FILE, "w", encoding="utf-8") as fh:
            fh.write("\n".join(current) + "\n")
        pytest.skip(f"route snapshot rewritten with {len(current)} routes - read the diff before committing it")

    expected = read_snapshot()
    gone = [line for line in expected if line not in current]
    new = [line for line in current if line not in expected]
    assert not gone and not new, (
        "the route table has changed.\n"
        f"routes that are gone or changed:\n  " + "\n  ".join(gone) + "\n"
        f"routes that are new or changed:\n  " + "\n  ".join(new) + "\n"
        "If the change is intended, rewrite the file with REGENERATE_ROUTE_SNAPSHOT=1 and say so in the commit."
    )


def test_the_snapshot_file_is_not_stale(app):
    """The recorded file must describe this app: the same number of routes, the same groups."""
    expected = read_snapshot()
    current = snapshot_lines(app)
    assert len(expected) == len(current), f"the snapshot has {len(expected)} routes, the app has {len(current)}"
    groups = {}
    for line in current:
        groups[line.rsplit(" | ", 1)[1]] = groups.get(line.rsplit(" | ", 1)[1], 0) + 1
    assert groups.get("public", 0) == 19, f"the public list changed: {groups}"
    assert groups.get("signed-in", 0) == 335, f"the signed-in routes changed: {groups}"
