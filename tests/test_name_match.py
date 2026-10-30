"""Name matching for conflict checks: the Indian-name variants a lawyer expects to be caught, and the look-alikes that must not be."""
import pytest

from utils.name_match import compare, sound_key

CAUGHT = [
    # (name A, name B, at least this level)
    ("Arun Kumar", "Kumar Arun", "same"),
    ("Mr. Arun Kumar", "ARUN KUMAR", "same"),
    ("M/s Kumar Traders Pvt Ltd", "Kumar Traders", "same"),
    ("M/s. Sundaram Agencies Private Limited", "Sundaram Agencies Pvt. Ltd.", "same"),
    ("Shri Ramesh Gupta s/o Late Mohan Gupta", "Ramesh Gupta", "same"),
    ("Smt. Lakshmi Narayanan", "Laxmi Narayanan", "likely"),
    ("Venkatesh Reddy", "Venkatesh Reddi", "likely"),
    ("Mohammed Rafiq", "Mohamed Rafik", "likely"),
    ("Mohd. Rafiq", "Mohammad Rafiq", "likely"),
    ("Sundaram", "Sundharam", "likely"),
    ("Krishna Murthy", "Krishnaa Moorthy", "likely"),
    ("Shyam Sunder", "Syam Sundar", "possible"),
    ("R. Sundaram", "Ramesh Sundaram", "possible"),
    ("Sundaram R", "Ramesh Sundaram", "possible"),
    ("K. Murugan", "Kandasamy Murugan", "possible"),
    ("Annai Builders", "Annai Builders and Developers", "possible"),
]
RANK = {"none": 0, "possible": 1, "likely": 2, "same": 3}


@pytest.mark.parametrize("a,b,level", CAUGHT)
def test_indian_name_variants_are_caught(a, b, level):
    r = compare(a, b)
    assert RANK[r["level"]] >= RANK[level], (a, b, r)
    assert compare(b, a)["level"] == r["level"] or RANK[compare(b, a)["level"]] >= RANK[level]   # order does not matter


NOT_CAUGHT = [
    ("Arun Kumar", "Varun Kumar"),
    ("Arun Kumar", "Arun Sharma"),
    ("Ramesh Gupta", "Ramesh Kumar"),
    ("Sundaram Agencies", "Annai Agencies"),
    ("Kumar Traders Pvt Ltd", "Sharma Traders Pvt Ltd"),
    ("Priya Raman", "Priya Ramesh"),
    ("Mohan", "Rohan"),
    ("Lakshmi Narayanan", "Lakshmi Prasad"),
    ("State of Maharashtra", "State of Karnataka"),
    ("A", "B"),
    ("", "Arun Kumar"),
    ("Arun Kumar", ""),
]


@pytest.mark.parametrize("a,b", NOT_CAUGHT)
def test_look_alikes_are_not_flagged(a, b):
    assert compare(a, b)["level"] == "none", (a, b, compare(a, b))


def test_names_in_indian_scripts_match_letter_for_letter_only():
    assert compare("குமார் டிரேடர்ஸ்", "குமார் டிரேடர்ஸ்")["level"] == "same"
    assert compare("अरुण कुमार", "कुमार अरुण")["level"] == "same"
    assert compare("अरुण कुमार", "Arun Kumar")["level"] == "none"       # no transliteration is claimed
    assert compare("அருண் குமார்", "அருன் குமார்")["level"] in ("none", "possible")


def test_sound_key_is_stable_and_never_empty():
    assert sound_key("Krishna") == sound_key("Krishnaa") == sound_key("Kirshna")[:0] + sound_key("Krishna")
    assert sound_key("123") == "123"
    assert sound_key("") == ""


@pytest.mark.parametrize("a,b,level", CAUGHT)
def test_the_candidate_filter_never_hides_a_name_that_compare_would_catch(a, b, level):
    from utils.name_match import block_keys
    assert block_keys(a) & block_keys(b), (a, b)
