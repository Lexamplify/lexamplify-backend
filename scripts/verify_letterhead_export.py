"""
Regression guard for the DOCX letterhead export geometry.

Run:  python scripts/verify_letterhead_export.py

Asserts the invariants that took many iterations to get right (see the
"letterhead-export-logic" memory). If any assert fails, the header/footer
geometry has regressed — do NOT ship until green. This checks the DOCX XML
directly (fast, no Word needed). For a visual check, render page 1 to PNG
with utils.draft_engine.export.to_docx + utils.docx_preview and LOOK.
"""
import io
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.draft_engine import export as exporter  # noqa: E402
from utils.draft_engine.export import _estimate_header_height_cm  # noqa: E402
from docx import Document  # noqa: E402

BLEED = ("band", "dual-tone", "border")
ALL = ("band", "dual-tone", "border", "classic")

LH_FULL = {
    "name": "Khare & Associates",
    "tagline": "Advocates & Legal Consultants",
    "address": "7B, Barakhamba Road, Connaught Place, New Delhi 110001",
    "contact": "+91 11 2345 6789 | contact@khareassociates.in | www.khareassociates.in",
    "enrolment_number": "D/1234/2015",
    "bar_council": "Bar Council of Delhi",
    "accent_color": "#1A2E4A",
    "confidential": True,
    "footer": "Khare & Associates · All India Practice",
}
LH_MIN = {"name": "ABC Law", "accent_color": "#6B1D2A"}
LH_LONG = {
    **LH_FULL,
    "name": "Very Long Firm Name & Associates Advocates and Legal Consultants LLP",
    "tagline": "Specialists in Commercial, Civil, Criminal and Constitutional Law Practice",
}

BODY = [{"type": "para", "text": "Body paragraph text for the draft. " * 12}] * 2

failures = []


def check(cond, msg):
    if not cond:
        failures.append(msg)


def dxa(xml, tag):
    m = re.search(r'<w:%s[^/]*w="(-?\d+)"' % tag, xml)
    return int(m.group(1)) if m else None


def run_case(design, lh, label):
    data = exporter.to_docx(BODY, "t", None, letterhead={**lh, "design": design})
    doc = Document(io.BytesIO(data))
    sec = doc.sections[0]
    pw = sec.page_width.cm
    lm = sec.left_margin.cm
    rm = sec.right_margin.cm
    tm = sec.top_margin.cm

    with zipfile.ZipFile(io.BytesIO(data)) as z:
        hdr = z.read("word/header1.xml").decode("utf-8", "replace")
        ftr = z.read("word/footer1.xml").decode("utf-8", "replace")

    if design in BLEED:
        # Invariant: zero page side-margins so bands span edge-to-edge.
        check(abs(lm) < 0.02 and abs(rm) < 0.02,
              f"[{label}/{design}] bleed design must have 0 side margins, got L={lm} R={rm}")
        # Invariant: header & footer tables are full page width, indent 0.
        for part, xml in (("header", hdr), ("footer", ftr)):
            w = dxa(xml, "tblW")
            ind = dxa(xml, "tblInd")
            check(w is not None and abs(w - round(pw * 567)) < 40,
                  f"[{label}/{design}] {part} tblW must be full page ({round(pw*567)}), got {w}")
            check(ind == 0,
                  f"[{label}/{design}] {part} tblInd must be 0 under zero margins, got {ind}")
    else:  # classic — normal margins, not bleed
        check(abs(lm - 2.54) < 0.1 and abs(rm - 2.54) < 0.1,
              f"[{label}/{design}] classic must keep 2.54cm side margins, got L={lm} R={rm}")

    # Invariant: top margin fits the measured header + gap, no overlap, floored.
    hh = _estimate_header_height_cm(sec.first_page_header)
    hd = sec.header_distance.cm
    check(tm >= 3.0 - 0.01, f"[{label}/{design}] top margin below 3.0cm floor: {tm}")
    check(tm + 0.25 >= hd + hh,
          f"[{label}/{design}] top margin {tm:.2f} too small for header {hd+hh:.2f} (overlap risk)")
    check(tm <= hd + hh + 2.0,
          f"[{label}/{design}] top margin {tm:.2f} far larger than header {hd+hh:.2f} (wasteful)")

    # Invariant: tcPr children in schema order in header (tcW<shd<tcMar...).
    order = ["cnfStyle", "tcW", "gridSpan", "hMerge", "vMerge", "tcBorders",
             "shd", "noWrap", "tcMar", "textDirection", "tcFit", "vAlign", "hideMark"]
    for tcpr in re.findall(r"<w:tcPr>.*?</w:tcPr>", hdr, flags=re.DOTALL):
        kids = [k for k in re.findall(r"<w:(\w+)", tcpr)[1:] if k in order]
        idxs = [order.index(k) for k in kids]
        check(idxs == sorted(idxs),
              f"[{label}/{design}] header tcPr children out of schema order: {kids}")


def main():
    for design in ALL:
        run_case(design, LH_MIN, "min")
        run_case(design, LH_FULL, "full")
        run_case(design, LH_LONG, "long")
    # Auto-fit must actually scale: long content → larger top margin than minimal.
    for design in ALL:
        d_min = Document(io.BytesIO(exporter.to_docx(BODY, "t", None, letterhead={**LH_MIN, "design": design}))).sections[0].top_margin.cm
        d_long = Document(io.BytesIO(exporter.to_docx(BODY, "t", None, letterhead={**LH_LONG, "design": design}))).sections[0].top_margin.cm
        check(d_long > d_min,
              f"[auto-fit/{design}] long content ({d_long}) must give bigger top margin than minimal ({d_min})")

    if failures:
        print("FAILED — letterhead export geometry regressed:\n")
        for f in failures:
            print("  -", f)
        sys.exit(1)
    print("OK — all letterhead export invariants hold (4 designs x 3 content sizes).")


if __name__ == "__main__":
    main()
