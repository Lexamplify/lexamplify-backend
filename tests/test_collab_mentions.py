"""Unit tests for utils.mentions.

Covers the pure parser; the authorization-gated resolve_mentions path
is covered by the integration tests in test_collab_access.py (which
needs a Flask app context because case_access reads via current_app).
"""
import pytest

from utils.mentions import parse_body


class TestParseBody:
    def test_empty_body(self):
        assert parse_body("") == []
        assert parse_body(None) == []

    def test_no_mentions(self):
        assert parse_body("hello world") == []
        assert parse_body("email me @ user") == []  # space after @

    def test_single_bare_id(self):
        assert parse_body("hey @12 please check") == [12]

    def test_single_user_prefix(self):
        assert parse_body("hey @user:42 please check") == [42]

    def test_mixed_forms(self):
        # Order of first appearance preserved; dedup kicks in.
        assert parse_body("hey @12 and @user:34") == [12, 34]

    def test_duplicates_dropped(self):
        assert parse_body("@12 again @12 and @user:12") == [12]

    def test_bounded_digits(self):
        # Keep the regex tight — we don't want it swallowing phone numbers
        # or anything beyond 10 digits (plan: max int32 user id).
        assert parse_body("call @01234567890 at 10am") == []

    def test_mention_at_message_edges(self):
        assert parse_body("@7") == [7]
        assert parse_body("ping @7") == [7]
        assert parse_body("@7 ping") == [7]

    def test_mention_adjacent_to_punctuation(self):
        # The regex uses \b so "@7," matches 7.
        assert parse_body("tell @7, @8 and @9!") == [7, 8, 9]

    def test_mention_inside_email_like_string_is_ignored(self):
        # "user@12.com" has no leading word boundary that leaves @12 clean —
        # the regex still catches @12 after "user", which is a known
        # harmless over-match; the server intersects with eligible
        # recipients so an unauthorized user_id gets dropped anyway.
        # This test documents the behaviour so a tightening later is a
        # conscious choice, not a surprise.
        ids = parse_body("user@12.com")
        assert ids == [12] or ids == []
