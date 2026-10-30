"""
utils/dms_pdftext.py - printing text and QR codes onto PDF pages (labels, bundle index, separator sheets).

Fonts: a Unicode TrueType font is used when the server has one (DejaVu / Noto / FreeSans / Arial are looked for, or set
DMS_PDF_FONT=/path/to/font.ttf); otherwise the built-in Helvetica. A character the chosen font cannot draw is shown as "?" and
reported through `Face.lost`, so callers can tell the person instead of printing wrong text silently.
"""
import io
import os
import re
import unicodedata

try:
    import pymupdf as fitz
except ImportError:  # pragma: no cover
    import fitz

_REGULAR = [
    os.getenv("DMS_PDF_FONT", ""),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf", "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf", "/usr/share/fonts/noto/NotoSans-Regular.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
    "C:\\Windows\\Fonts\\segoeui.ttf", "C:\\Windows\\Fonts\\arial.ttf",
    "/Library/Fonts/Arial Unicode.ttf", "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
]
_BOLD = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf", "/usr/share/fonts/noto/NotoSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    "C:\\Windows\\Fonts\\segoeuib.ttf", "C:\\Windows\\Fonts\\arialbd.ttf",
]
_WIDE = [       # scripts the first choice may lack (Devanagari, Tamil, ...): tried only when needed
    "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf", "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
    "/usr/share/fonts/truetype/lohit-devanagari/Lohit-Devanagari.ttf", "/usr/share/fonts/truetype/noto/NotoSansTamil-Regular.ttf",
    "C:\\Windows\\Fonts\\Nirmala.ttf", "C:\\Windows\\Fonts\\mangal.ttf", "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    # more places Indic-capable fonts live: Windows (Arial Unicode MS, Latha for Tamil), Debian/Ubuntu/Fedora/Arch Noto + Lohit
    "C:\\Windows\\Fonts\\ARIALUNI.TTF", "C:\\Windows\\Fonts\\latha.ttf", "C:\\Windows\\Fonts\\Nirmala.ttc",
    "/usr/share/fonts/noto/NotoSansDevanagari-Regular.ttf", "/usr/share/fonts/noto/NotoSansTamil-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansTamilUI-Regular.ttf", "/usr/share/fonts/truetype/noto/NotoSansDevanagariUI-Regular.ttf",
    "/usr/share/fonts/google-noto/NotoSansDevanagari-Regular.ttf", "/usr/share/fonts/google-noto/NotoSansTamil-Regular.ttf",
    "/usr/share/fonts/truetype/lohit-tamil/Lohit-Tamil.ttf", "/usr/share/fonts/TTF/NotoSansDevanagari-Regular.ttf",
    "/usr/share/fonts/TTF/NotoSansTamil-Regular.ttf", "/usr/share/fonts/opentype/noto/NotoSansDevanagari-Regular.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansTamil-Regular.ttf",
]
_MONO = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", "/usr/share/fonts/dejavu/DejaVuSansMono.ttf", "/usr/share/fonts/TTF/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf", "C:\\Windows\\Fonts\\consola.ttf",
]


def _first(paths):
    for p in paths:
        if p and os.path.isfile(p):
            return p
    return None


class Face:
    """One font family: regular / bold / mono. Measures text, wraps it, draws it, remembers what it could not draw.

    Text that Helvetica can already draw is drawn with the built-in PDF fonts (nothing is embedded, so a 500-page bundle does not
    grow); text it cannot draw (₹, accented capitals outside Latin-1, Indian scripts...) uses a Unicode TrueType font from the
    server when there is one, and shows "?" for any letter even that font lacks."""

    BASE = {"reg": "helv", "bold": "hebo", "mono": "cour"}
    # the built-in PDF fonts speak Latin-1 only; when there is no TrueType font to fall back on, typographic punctuation becomes plain
    ASCII = {"—": "-", "–": "-", "‒": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "•": "*", "·": "-", "…": "...", "\u00a0": " ", "₹": "Rs.",
             "→": "->", "\u2009": " ", "\u200b": ""}

    def __init__(self):
        self.files = {"reg": _first(_REGULAR), "bold": _first(_BOLD), "mono": _first(_MONO)}
        if not self.files["bold"]:
            self.files["bold"] = self.files["reg"]
        self.base = {k: fitz.Font(v) for k, v in self.BASE.items()}
        self.ttf, self.lost = {}, False
        self.cands = {}
        for k, lists in (("reg", [_REGULAR, _WIDE]), ("bold", [_BOLD, _REGULAR, _WIDE]), ("mono", [_MONO, _REGULAR, _WIDE])):
            seen, found = set(), []
            for lst in lists:
                for path in lst:
                    if path and path not in seen and os.path.isfile(path):
                        seen.add(path)
                        try:
                            found.append((fitz.Font(fontfile=path), path))
                        except Exception:
                            pass
            self.cands[k] = found
            if found:
                self.ttf[k] = found[0]
        self.unicode = "reg" in self.ttf
        self._embedded = set()

    @staticmethod
    def _plain(text):
        text = unicodedata.normalize("NFC", str(text or ""))
        return re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", " ", text).replace("\t", " ")

    def _choose(self, text, kind):
        """-> (font_object, ttf_path_or_None) able to draw as much of `text` as possible."""
        base = self.base[kind]
        if all(ch in "\n " or (ord(ch) < 256 and base.has_glyph(ord(ch))) for ch in text):
            return base, None
        best, best_n = None, -1
        for font, path in self.cands.get(kind, []):
            n = sum(1 for ch in text if ch not in "\n " and font.has_glyph(ord(ch)))
            if n == sum(1 for ch in text if ch not in "\n "):
                return font, path
            if n > best_n:
                best, best_n = (font, path), n
        return best if best else (base, None)

    def clean(self, text, kind="reg"):
        text = self._plain(text)
        font, path = self._choose(text, kind)
        if path is None and any(ord(ch) >= 256 for ch in text):
            text = "".join(self.ASCII.get(ch, ch) for ch in text)
        out = []
        for ch in text:
            if ch in "\n " or (font.has_glyph(ord(ch)) and (path is not None or ord(ch) < 256)):
                out.append(ch)
            else:
                out.append("?")
                self.lost = True
        return "".join(out)

    def width(self, text, size, kind="reg"):
        text = self._plain(text)
        font, _p = self._choose(text, kind)
        return font.text_length(self.clean(text, kind), fontsize=size)

    def wrap(self, text, size, max_w, kind="reg", max_lines=None):
        """Greedy word wrap; a single word wider than the line is broken by letters. Adds an ellipsis when max_lines cuts text."""
        raw = self._plain(text)
        font, _p = self._choose(raw, kind)
        words = self.clean(raw, kind).replace("\n", " ").split(" ")
        tl = lambda t: font.text_length(t, fontsize=size)
        lines, cur = [], ""
        for w in words:
            if not w:
                continue
            trial = (cur + " " + w).strip()
            if tl(trial) <= max_w:
                cur = trial
                continue
            if cur:
                lines.append(cur)
                cur = ""
            while tl(w) > max_w and len(w) > 1:
                n = len(w)
                while n > 1 and tl(w[:n]) > max_w:
                    n -= 1
                lines.append(w[:n])
                w = w[n:]
            cur = w
        if cur:
            lines.append(cur)
        if max_lines and len(lines) > max_lines:
            lines = lines[:max_lines]
            last = lines[-1]
            while last and tl(last + "…") > max_w:
                last = last[:-1]
            lines[-1] = last.rstrip() + "…"
        return lines

    def register(self, page):
        """Kept for callers that pass `names` around; fonts are now embedded on demand by text()."""
        return dict(self.BASE)

    def text(self, page, names, xy, text, size, kind="reg", color=(0, 0, 0)):
        raw = self._plain(text)
        font, path = self._choose(raw, kind)
        shown = self.clean(raw, kind)
        if path:
            name = f"X{kind}"
            key = (id(page.parent), page.number, kind)
            if key not in self._embedded:
                page.insert_font(fontname=name, fontfile=path)
                self._embedded.add(key)
        else:
            name = self.BASE[kind]
        page.insert_text(xy, shown, fontsize=size, fontname=name, color=color)


def qr_png(data, scale=6, border=1):
    """A QR code as PNG bytes (black on white, medium error correction)."""
    import segno
    buf = io.BytesIO()
    segno.make(data, error="m", micro=False).save(buf, kind="png", scale=scale, border=border, dark="#000000", light="#ffffff")
    return buf.getvalue()


MM = 72.0 / 25.4
