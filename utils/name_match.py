"""Name matching for conflict checks, built for Indian names and firms.

Two names are compared after the noise is removed (M/s, Shri, Smt, Mr., Pvt Ltd, punctuation) and a sound-alike key is
made so spelling variants meet: Venkatesh / Venkatesan, Sundaram / Sundharam, Krishna / Krishnaa / Kishna, Mohamed /
Mohammad / Mohammed, Reddy / Reddi, Lakshmi / Laxmi, Gupta / Gupt. Initials match given names (R. Sundaram = Ramesh
Sundaram) but only as a "possible", never as a certain match.

Honest limit: names written in Indian scripts (Tamil, Devanagari, ...) are compared letter for letter only. This module
does not transliterate them.
"""
import re
import unicodedata
from difflib import SequenceMatcher
from functools import lru_cache

HONORIFICS = {"mr", "mrs", "ms", "miss", "shri", "shree", "sri", "smt", "shrimati", "kum", "dr", "prof", "adv", "advocate",
              "m s", "messrs", "late", "sh", "st", "the", "hon", "justice", "hr"}
COMPANY_WORDS = {"pvt", "private", "ltd", "limited", "llp", "co", "company", "corp", "corporation", "inc", "incorporated",
                 "and", "sons", "bros", "brothers", "enterprises", "enterprise", "industries", "traders", "trading", "agencies",
                 "associates", "services", "solutions", "group", "holdings"}
GENERIC = {"state", "of", "union", "india", "government", "govt", "the", "a", "an", "through", "by", "representing", "its", "city", "bank", "office", "department", "dept", "commissioner", "collector"}
ABBREVIATIONS = {"mohd": "mohammad", "md": "mohammad", "muhd": "mohammad", "mhd": "mohammad"}
RELATION = re.compile(r"\b(s/o|d/o|w/o|c/o|son of|daughter of|wife of|care of)\b.*$", re.I)
_SCRIPT_LETTER = re.compile(r"[^\W\d_]", re.UNICODE)


def _is_latin(s: str) -> bool:
    letters = _SCRIPT_LETTER.findall(s)
    return bool(letters) and all(ord(ch) < 0x250 for ch in letters)


@lru_cache(maxsize=65536)
def _tokens(name: str) -> tuple:
    """Clean words of a name: no honorifics or punctuation, lower-case, relation suffix (s/o ...) dropped."""
    s = unicodedata.normalize("NFKC", str(name or ""))
    s = RELATION.sub(" ", s)
    s = s.lower().replace("m/s", " ").replace("&", " and ")
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE).replace("_", " ")
    words = [ABBREVIATIONS.get(w, w) for w in s.split() if w and w not in HONORIFICS]
    return tuple(words)


def tokens(name: str) -> list:
    return list(_tokens(str(name or "")))


def core_tokens(name: str) -> list:
    """Name words without company suffixes (Pvt, Ltd, ...). Falls back to all words if that would leave nothing."""
    ts = tokens(name)
    core = [t for t in ts if t not in COMPANY_WORDS]
    return core or ts


_SOUND = [
    ("ksh", "x"), ("sch", "s"), ("tch", "c"), ("shh", "s"),
    ("sh", "s"), ("ch", "c"), ("th", "t"), ("dh", "d"), ("kh", "k"), ("gh", "g"), ("bh", "b"), ("jh", "j"), ("ph", "p"), ("zh", "j"),
    ("aa", "a"), ("ee", "i"), ("ii", "i"), ("oo", "u"), ("uu", "u"), ("ou", "u"), ("ai", "i"), ("ei", "i"), ("ay", "i"), ("ey", "i"),
    ("w", "v"), ("f", "p"), ("z", "j"), ("q", "k"), ("x", "ks"), ("y", "i"), ("c", "k"), ("o", "u"), ("e", "i"),
]


@lru_cache(maxsize=65536)
def sound_key(word: str) -> str:
    """A spelling-insensitive key for one Latin word."""
    w = re.sub(r"[^a-z]", "", word.lower())
    if not w:
        return word.lower()
    for a, b in _SOUND:
        w = w.replace(a, b)
    w = re.sub(r"(.)\1+", r"\1", w)                       # ll -> l, ss -> s
    w = re.sub(r"^m(u|o)h?am+(a|i)d?$", "mhmd", w)         # Mohamed / Muhammad family
    if len(w) > 3:
        w = re.sub(r"[aiu]+$", "", w) or w                 # Gupta/Gupt, Reddy/Reddi, Krishna/Krishn, Sundaram stays
    w = re.sub(r"n$", "", w) if len(w) > 5 and w.endswith("an") and w[:-2].endswith(("sh", "s", "t", "k", "d")) else w
    return w


def _skeleton(key: str) -> str:
    return re.sub(r"[aiu]", "", key)


def _similar(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def _word_match(a: str, b: str) -> float:
    """1.0 same, 0.95 same sound, else string similarity of the sound keys (0..1)."""
    if a == b:
        return 1.0
    if not (_is_latin(a) and _is_latin(b)):
        return 0.0
    ka, kb = sound_key(a), sound_key(b)
    if ka == kb:
        return 0.95
    if len(ka) >= 5 and len(kb) >= 5:
        s = _similar(ka, kb)
        if s >= 0.84:
            return s
    sa, sb = _skeleton(ka), _skeleton(kb)
    if len(sa) >= 3 and sa == sb and ka[0] == kb[0]:
        return 0.82                                       # same consonants, different vowels: a weak match
    return 0.0


def _initial_of(word: str):
    return word[0] if len(word) == 1 else None


def compare(a: str, b: str) -> dict:
    """Compare two names. Returns {level: 'same'|'likely'|'possible'|'none', score, why}.

    same      every word matches letter for letter, in any order (Kumar Arun = Arun Kumar)
    likely    every word matches by sound, or one name's words are all inside the other's (a firm with and without "Pvt Ltd")
    possible  same surname/last word and the first names are initials or sound alike; or most words match
    """
    ta, tb = tokens(a), tokens(b)
    ca, cb = core_tokens(a), core_tokens(b)
    if not ca or not cb:
        return {"level": "none", "score": 0.0, "why": ""}
    if sorted(ta) == sorted(tb):
        return {"level": "same", "score": 1.0, "why": "The names are the same."}
    if sorted(ca) == sorted(cb):
        return {"level": "same", "score": 0.98, "why": "The names are the same apart from words like Pvt Ltd."}

    # words every public body or office has say nothing about who it is: compare the rest only
    ca = [w for w in ca if w not in GENERIC]
    cb = [w for w in cb if w not in GENERIC]
    if not ca or not cb:
        return {"level": "none", "score": 0.0, "why": ""}
    small, big = (ca, cb) if len(ca) <= len(cb) else (cb, ca)
    # word-by-word best matches
    used, scores, weak = set(), [], []
    for w in small:
        best, bi = 0.0, None
        for i, v in enumerate(big):
            if i in used:
                continue
            m = _word_match(w, v)
            if m > best:
                best, bi = m, i
        if bi is not None and best > 0:
            used.add(bi)
        scores.append(best)
        if best == 0.0:
            weak.append(w)

    if all(s >= 0.95 for s in scores) and len(small) == len(big):
        return {"level": "likely", "score": round(min(scores), 2), "why": "The names sound alike and may be spelled differently."}
    if all(s >= 0.84 for s in scores) and len(small) == len(big):
        return {"level": "likely", "score": round(sum(scores) / len(scores), 2), "why": "The spellings are very close."}
    if len(small) >= 2 and all(s >= 0.95 for s in scores) and len(big) > len(small):
        return {"level": "possible", "score": 0.85, "why": "One name contains all the words of the other."}

    # initials: "R. Sundaram" / "Ramesh Sundaram" / "Sundaram R"
    if len(ca) >= 2 and len(cb) >= 2:
        for i, x in enumerate(ca):
            for j, y in enumerate(cb):
                if len(x) > 1 and len(y) > 1 and _word_match(x, y) >= 0.95:
                    rest_a = [w for k, w in enumerate(ca) if k != i]
                    rest_b = [w for k, w in enumerate(cb) if k != j]
                    for p in rest_a:
                        for q in rest_b:
                            if _word_match(p, q) >= 0.95 or (_initial_of(p) and q.startswith(p)) or (_initial_of(q) and p.startswith(q)):
                                return {"level": "possible", "score": 0.8, "why": "Same surname, and the first names match or one is an initial."}
    if len(small) == len(big) and len(small) >= 2 and all(sc >= 0.82 for sc in scores):
        return {"level": "possible", "score": round(min(scores), 2), "why": "The names have the same consonants and may be spelled differently."}
    if len(small) == 1 and len(big) >= 1 and scores and scores[0] >= 0.95 and len(small[0]) >= 5:
        return {"level": "possible", "score": 0.7, "why": "A single name matches one word of the other."}
    good = sum(1 for s in scores if s >= 0.95)
    if len(small) >= 3 and good / len(small) >= 0.67:
        return {"level": "possible", "score": 0.7, "why": "Most words of the names match."}
    return {"level": "none", "score": 0.0, "why": ""}


@lru_cache(maxsize=65536)
def _block_keys(name: str) -> frozenset:
    keys = set()
    for w in core_tokens(name):
        if w in GENERIC or len(w) == 1:
            continue
        k = sound_key(w) if _is_latin(w) else w
        keys.add(k)
        keys.add(_skeleton(k))
        keys.add(k[:4])
    return frozenset(x for x in keys if x)


def block_keys(name: str) -> frozenset:
    """Cheap keys for finding candidates: two names that compare() could call a match always share at least one."""
    return _block_keys(str(name or ""))
