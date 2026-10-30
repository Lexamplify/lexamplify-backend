"""Saving a draft (Auto-Draft Studio): the browser chooses the id, the server owns the row.

Two things are checked here:
  - the id comes from the browser, so it has to be a short piece of text and it must never be allowed to
    reach another advocate's row (tests/test_cross_tenant_tables.py proves that across the tables);
  - the owner can keep saving their own draft over and over - the save is an upsert, so the second save of
    the same id must update the row, not fail.
"""
import pytest

from tests.helpers_app import make_app, register


@pytest.fixture()
def world(tmp_path, monkeypatch):
    flask_app = make_app(tmp_path, monkeypatch)
    a = register(flask_app, "a@example.com")
    return flask_app, a


def test_the_owner_can_save_the_same_draft_again(world):
    _flask_app, a = world
    first = a.post("/api/drafts", json={"id": "draft_mine_1", "title": "Notice", "rawText": "first"})
    assert first.status_code == 200, first.get_data(as_text=True)
    second = a.post("/api/drafts", json={"id": "draft_mine_1", "title": "Notice", "rawText": "second"})
    assert second.status_code == 200, second.get_data(as_text=True)
    drafts = a.get("/api/drafts").get_json()
    assert len(drafts) == 1, drafts
    assert drafts[0]["rawText"] == "second", drafts


def test_a_draft_without_an_id_is_still_saved(world):
    _flask_app, a = world
    r = a.post("/api/drafts", json={"title": "Notice", "rawText": "text"})
    assert r.status_code == 200, r.get_data(as_text=True)
    drafts = a.get("/api/drafts").get_json()
    assert len(drafts) == 1 and drafts[0]["rawText"] == "text", drafts


def test_a_draft_id_that_is_not_a_short_piece_of_text_is_refused(world):
    _flask_app, a = world
    for bad in (["a"], {"a": 1}, 12.5, "", "   ", "x" * 121):
        r = a.post("/api/drafts", json={"id": bad, "title": "Notice"})
        assert r.status_code == 400, (bad, r.status_code, r.get_data(as_text=True)[:120])


def test_saving_a_draft_needs_a_session(world):
    flask_app, _a = world
    r = flask_app.test_client().post("/api/drafts", json={"id": "draft_x", "title": "Notice"})
    assert r.status_code == 401
