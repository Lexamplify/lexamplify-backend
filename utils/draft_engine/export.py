"""Export a structured document (blocks) to Word and PDF. Output comes from the JSON blocks, not from HTML.

Word: A4, Times New Roman 12 pt, 1.5 line spacing, numbered paragraphs with hanging indent, page numbers,
[Bracketed Fields] highlighted yellow so nothing unresolved goes out unnoticed.
PDF: same blocks via fpdf2. It needs a Unicode TrueType font for the rupee sign; see _find_font().
"""
import io
import os
import re

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_COLOR_INDEX, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

from .render import BRACKET_RE

FONT = "Times New Roman"
_ALIGN = {"left": WD_ALIGN_PARAGRAPH.LEFT, "right": WD_ALIGN_PARAGRAPH.RIGHT,
          "center": WD_ALIGN_PARAGRAPH.CENTER, "justify": WD_ALIGN_PARAGRAPH.JUSTIFY}
MAX_BLOCKS = 800
MAX_TEXT = 6000


def _safe_blocks(blocks):
    """Accept only what the renderer produces; cap sizes so an export call cannot be used to exhaust memory."""
    if not isinstance(blocks, list) or len(blocks) > MAX_BLOCKS:
        raise ValueError("document too large or malformed")
    out = []
    for b in blocks:
        if not isinstance(b, dict) or not isinstance(b.get("type"), str):
            raise ValueError("malformed block")
        c = {"type": b["type"]}
        if isinstance(b.get("text"), str):
            c["text"] = b["text"][:MAX_TEXT]
        if isinstance(b.get("lines"), list):
            c["lines"] = [str(x)[:MAX_TEXT] for x in b["lines"][:60]]
        if isinstance(b.get("rows"), list):
            c["rows"] = [[str(x)[:600] for x in row[:12]] for row in b["rows"][:200] if isinstance(row, list)]
            c["header"] = bool(b.get("header"))
        for k in ("align",):
            if b.get(k) in _ALIGN:
                c[k] = b[k]
        if b.get("bold"):
            c["bold"] = True
        if isinstance(b.get("number"), int):
            c["number"] = b["number"]
        if isinstance(b.get("letter"), str):
            c["letter"] = b["letter"][:6]
        out.append(c)
    return out


def _runs(paragraph, text, bold=False, size=12, underline=False):
    """Add text, highlighting every [Bracketed Field: ...]. Returns the
    list of runs created so callers can style them further (e.g. apply a
    color to the firm name in the letterhead header)."""
    out = []
    pos = 0
    for m in BRACKET_RE.finditer(text):
        if m.start() > pos:
            out.append(_run(paragraph, text[pos:m.start()], bold, size, underline))
        r = _run(paragraph, m.group(0), bold, size, underline)
        r.font.highlight_color = WD_COLOR_INDEX.YELLOW
        out.append(r)
        pos = m.end()
    if pos < len(text):
        out.append(_run(paragraph, text[pos:], bold, size, underline))
    return out


def _run(paragraph, text, bold, size, underline):
    r = paragraph.add_run(text)
    r.bold = bold
    r.underline = underline
    r.font.name = FONT
    r.font.size = Pt(size)
    r._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    return r


def _fmt(p, align="left", space_after=8, line=1.5, left=None, first=None, keep_next=False, right=None):
    pf = p.paragraph_format
    p.alignment = _ALIGN.get(align, WD_ALIGN_PARAGRAPH.LEFT)
    pf.space_after = Pt(space_after)
    pf.space_before = Pt(0)
    pf.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    pf.line_spacing = line
    if left is not None:
        pf.left_indent = Cm(left)
    if right is not None:
        pf.right_indent = Cm(right)
    if first is not None:
        pf.first_line_indent = Cm(first)
    pf.keep_with_next = keep_next
    pf.widow_control = True


def _add_field(paragraph, instr, size=10):
    """Insert a Word field (e.g. PAGE, NUMPAGES) at the current end of
    the paragraph. These update automatically on open — so 'Page X of Y'
    shows real numbers no matter how long the document grows."""
    run = paragraph.add_run()
    run.font.name, run.font.size = FONT, Pt(size)
    for kind, text in (("begin", None), (None, instr), ("end", None)):
        if kind:
            el = OxmlElement("w:fldChar")
            el.set(qn("w:fldCharType"), kind)
        else:
            el = OxmlElement("w:instrText")
            el.set(qn("xml:space"), "preserve")
            el.text = text
        run._r.append(el)
    return run


def _rule(paragraph, color="999999"):
    """Add a thin horizontal rule below the paragraph. Used to separate
    the letterhead block from the body on page 1, and to lift the
    footer visually from the page."""
    pPr = paragraph._p.get_or_add_pPr()
    pbdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "6")        # ~0.75pt
    bottom.set(qn("w:space"), "4")
    bottom.set(qn("w:color"), color)
    pbdr.append(bottom)
    pPr.append(pbdr)


def _accent_border(paragraph, hex_color, sz=24):
    """Draw a solid colored bottom border under a paragraph. sz is in
    eighths of a point (24 = 3pt). Used as the clean accent rule."""
    pPr = paragraph._p.get_or_add_pPr()
    pbdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), str(sz))
    bottom.set(qn("w:space"), "2")
    bottom.set(qn("w:color"), hex_color)
    pbdr.append(bottom)
    pPr.append(pbdr)


def _hex_to_rgb(hex_str):
    """'#1A2E4A' → RGBColor(0x1A, 0x2E, 0x4A). Falls back to navy."""
    h = (hex_str or '').lstrip('#')
    if len(h) != 6:
        return RGBColor(0x1A, 0x2E, 0x4A)
    return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


# Canonical child order for w:tcPr (CT_TcPrInner). Word DROPS properties
# that appear out of this order — which is exactly why cell margins were
# being ignored and left-aligned header/footer text bled to the page edge.
_TCPR_ORDER = [
    "w:cnfStyle", "w:tcW", "w:gridSpan", "w:hMerge", "w:vMerge",
    "w:tcBorders", "w:shd", "w:noWrap", "w:tcMar", "w:textDirection",
    "w:tcFit", "w:vAlign", "w:hideMark",
]


def _tcpr_set(cell, element):
    """Insert `element` into the cell's w:tcPr at its schema-correct position,
    replacing any existing element of the same tag. Guarantees Word honours
    every property (width, shading, borders, margins) regardless of the order
    we happen to call the helpers in."""
    tcPr = cell._tc.get_or_add_tcPr()
    tag = element.tag
    for old in tcPr.findall(tag):
        tcPr.remove(old)
    order = [qn(t) for t in _TCPR_ORDER]
    my_idx = order.index(tag) if tag in order else len(order)
    anchor = None
    for child in tcPr:
        ci = order.index(child.tag) if child.tag in order else len(order)
        if ci > my_idx:
            anchor = child
            break
    if anchor is not None:
        anchor.addprevious(element)
    else:
        tcPr.append(element)


def _set_cell_shading(cell, hex_color):
    """Fill a table cell with a solid background colour."""
    shading = OxmlElement("w:shd")
    shading.set(qn("w:val"), "clear")
    shading.set(qn("w:color"), "auto")
    shading.set(qn("w:fill"), hex_color)
    _tcpr_set(cell, shading)


def _remove_table_borders(tbl):
    """Strip all borders from a table so it looks like a layout grid."""
    tblPr = tbl._tbl.tblPr
    if tblPr is None:
        tblPr = OxmlElement("w:tblPr")
        tbl._tbl.insert(0, tblPr)
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "none")
        el.set(qn("w:sz"), "0")
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), "auto")
        borders.append(el)
    tblPr.append(borders)


def _set_cell_width(cell, cm_val):
    """Set explicit cell width (replaces any existing w:tcW)."""
    tcW = OxmlElement("w:tcW")
    tcW.set(qn("w:w"), str(int(cm_val * 567)))
    tcW.set(qn("w:type"), "dxa")
    _tcpr_set(cell, tcW)


def _set_cell_margins(cell, top=0, bottom=0, left=60, right=60):
    """Set cell padding in twentieths of a point (dxa).

    Word's w:tcMar honours w:top / w:left / w:bottom / w:right. The logical
    w:start / w:end variants are NOT reliably applied as cell padding (Word
    silently ignores them here), so left-aligned text ends up flush against
    the cell edge. We emit the traditional w:left / w:right and insert the
    tcMar at its schema-correct position via _tcpr_set."""
    mar = OxmlElement("w:tcMar")
    for side, val in (("top", top), ("left", left), ("bottom", bottom), ("right", right)):
        el = OxmlElement(f"w:{side}")
        el.set(qn("w:w"), str(int(val)))
        el.set(qn("w:type"), "dxa")
        mar.append(el)
    _tcpr_set(cell, mar)


def _darken(hex_color, ratio=0.18):
    """Return a darker variant of a hex color. ratio=0.18 ≈ 18% darker.
    Used for band / border / dual-tone FILLS so the printed/rendered colour
    has real impact rather than looking washed out next to the on-screen
    preview. We keep this one-step shift so a mid-brightness accent still
    reads as that accent (not a different hue)."""
    h = (hex_color or '').lstrip('#')
    if len(h) != 6:
        return hex_color
    r = max(0, int(int(h[0:2], 16) * (1 - ratio)))
    g = max(0, int(int(h[2:4], 16) * (1 - ratio)))
    b = max(0, int(int(h[4:6], 16) * (1 - ratio)))
    return f"{r:02X}{g:02X}{b:02X}"


def _set_table_full_page_width(tbl, section):
    """Make the given table span the full page width edge-to-edge, escaping
    the section's left/right margins via a negative w:tblInd. Used for band /
    dual-tone / border headers and band / dual-tone footers so the coloured
    strip bleeds to the very edge of the page like modern letterhead stock."""
    # python-docx stores page/margin dims in EMU; 1 cm = 360000 EMU, 1 dxa = 1/20 pt = 1 cm / 56.6929...
    # Convert via the Cm() helper: 1 dxa = 1 cm / 56.6929 ≈ 17.639 EMU, but simpler to use the raw
    # cm → dxa factor of 567 (since 1 cm = 72/2.54 pt = 28.3464 pt = 566.929 dxa).
    page_w_emu = section.page_width
    left_m_emu = section.left_margin
    # EMU → dxa: dxa = emu / 635.
    page_w_dxa = int(page_w_emu / 635)
    left_m_dxa = int(left_m_emu / 635)
    tblPr = tbl._tbl.tblPr
    if tblPr is None:
        tblPr = OxmlElement("w:tblPr")
        tbl._tbl.insert(0, tblPr)
    # w:tblW — explicit full page width
    tblW = tblPr.find(qn("w:tblW"))
    if tblW is None:
        tblW = OxmlElement("w:tblW")
        tblPr.append(tblW)
    tblW.set(qn("w:w"), str(page_w_dxa))
    tblW.set(qn("w:type"), "dxa")
    # w:tblInd — negative indent to pull the table back past the left margin
    tblInd = tblPr.find(qn("w:tblInd"))
    if tblInd is None:
        tblInd = OxmlElement("w:tblInd")
        tblPr.append(tblInd)
    tblInd.set(qn("w:w"), str(-left_m_dxa))
    tblInd.set(qn("w:type"), "dxa")
    # w:tblLayout fixed so the column widths we set actually stick
    tblLayout = tblPr.find(qn("w:tblLayout"))
    if tblLayout is None:
        tblLayout = OxmlElement("w:tblLayout")
        tblPr.append(tblLayout)
    tblLayout.set(qn("w:type"), "fixed")


def _build_headers_footers(doc, letterhead, title):
    """Professional legal-grade headers and footers. Dispatches to the
    selected design style: classic (default), band, border, dual-tone."""
    sec = doc.sections[0]
    sec.different_first_page_header_footer = True
    # Inside a full-bleed band (full-width table, page margins 0) the only
    # reliable way to line inner text up with the body column is a PARAGRAPH
    # indent equal to the VISUAL text margin. When the page margins are zero
    # (bleed designs) that visual margin is 2.54 cm, recreated on the body as
    # a Normal-style indent; for classic it is the real page margin. Either
    # way the body sits 2.54 cm in, so header/footer text uses the same.
    _vis_margin_cm = sec.left_margin.cm if sec.left_margin.cm > 0.1 else 2.54
    _vis_margin_r_cm = sec.right_margin.cm if sec.right_margin.cm > 0.1 else 2.54
    _LPAD_CM = _vis_margin_cm
    _RPAD_CM = _vis_margin_r_cm
    # dxa versions for vertical cell padding; horizontal is 0 under full bleed
    # (centred band/strip text centres on the full page width).
    _LMPAD = max(0, int(sec.left_margin / 635))
    _RMPAD = max(0, int(sec.right_margin / 635))
    _firm = ((letterhead or {}).get("name") or "").strip()
    _tag = ((letterhead or {}).get("tagline") or "").strip()
    _addr = ((letterhead or {}).get("address") or "").strip()
    _contact = ((letterhead or {}).get("contact") or "").strip()
    _footer_note = ((letterhead or {}).get("footer") or "").strip()
    _confidential = bool((letterhead or {}).get("confidential"))
    _logo = ((letterhead or {}).get("logo_path") or "").strip()
    _header_img = ((letterhead or {}).get("header_image") or "").strip()
    _enrol = ((letterhead or {}).get("enrolment_number") or "").strip()
    _bar = ((letterhead or {}).get("bar_council") or "").strip()
    _courts = ((letterhead or {}).get("courts") or "").strip()
    _quals = ((letterhead or {}).get("qualifications") or "").strip()
    _gstin = ((letterhead or {}).get("gstin") or "").strip()
    _accent = ((letterhead or {}).get("accent_color") or "").strip()
    _design = ((letterhead or {}).get("design") or "classic").strip()
    accent_rgb = _hex_to_rgb(_accent) if _accent else RGBColor(0x1A, 0x2E, 0x4A)
    accent_hex_raw = (_accent or '#1A2E4A').lstrip('#')
    # Darker variant used for FILL (band background, footer band, border
    # rules). A 10% shift is enough to give the printed DOCX the rich,
    # deep tone of real letterhead stock without turning mid-brightness
    # colours into near-black blocks — 18% proved too heavy on navy &
    # charcoal, which came out looking muddy next to the preview.
    accent_hex = _darken(accent_hex_raw, 0.10)

    ar, ag, ab = accent_rgb[0], accent_rgb[1], accent_rgb[2]
    light_r = min(255, ar + int((255 - ar) * 0.88))
    light_g = min(255, ag + int((255 - ag) * 0.88))
    light_b = min(255, ab + int((255 - ab) * 0.88))
    light_hex = f"{light_r:02X}{light_g:02X}{light_b:02X}"
    # Mid-tone tint for the dual-tone lower strip. 70% accent + 30% white:
    # strong enough that the strip clearly reads as a lighter shade of the
    # SAME colour (e.g. a medium navy), not a washed-out grey. The earlier
    # 55% blend looked pastel/grey on screen and in print, which is what
    # "the colour looks light" was pointing at.
    mid_r = int(ar * 0.70 + 255 * 0.30)
    mid_g = int(ag * 0.70 + 255 * 0.30)
    mid_b = int(ab * 0.70 + 255 * 0.30)
    mid_hex = f"{mid_r:02X}{mid_g:02X}{mid_b:02X}"

    # ── Shared helpers: clean address / contact strings ──
    # One consistent separator everywhere (a spaced middle dot), so the
    # header never shows the old mix of 3-spaces / "|" / "·".
    _SEP = "   ·   "

    def _addr_line():
        if not _addr:
            return ""
        parts = [ln.strip().rstrip(",") for ln in _addr.splitlines() if ln.strip()]
        return ", ".join(parts)

    def _contact_line():
        # Split whatever the firm typed on | , · or newlines into clean
        # tokens and re-join with the single house separator.
        if not _contact:
            return ""
        toks = re.split(r"\s*[|·\n]\s*", _contact)
        return _SEP.join(t.strip() for t in toks if t.strip())

    def _contact_oneliner():
        parts = [s for s in (_addr_line(), _contact_line()) if s]
        return _SEP.join(parts)

    # ── Shared helper: enrolment detail line ──
    def _enrol_detail():
        if not _enrol:
            return ""
        d = f"Enrolment No. {_enrol}"
        if _bar:
            d += f"   |   {_bar}"
        return d

    fph = sec.first_page_header
    for p in list(fph.paragraphs):
        p._element.getparent().remove(p._element)

    # Full header image takes precedence over any design
    if _header_img and os.path.isfile(_header_img):
        try:
            lp = fph.add_paragraph()
            run = lp.add_run()
            run.add_picture(_header_img, width=Cm(17))
            _fmt(lp, "center", space_after=4, line=1.1)
        except Exception:
            pass
    elif _firm:
        has_logo = _logo and os.path.isfile(_logo)

        if _design == "band":
            # ── BAND DESIGN ──────────────────────────────────────────────
            # A cohesive two-tier header block, full-bleed to both side edges
            # and the top edge:
            #   • Row 0  – deep accent band: firm name + tagline (+enrolment)
            #   • Row 1  – slim light-tint strip: address · phone · email · web
            # Putting the contact in its OWN connected strip (instead of
            # floating grey text below the band) is what makes the header
            # read as one finished unit rather than two detached pieces.
            _addr_c = _addr_line()
            _contact_c = _contact_line()
            _has_strip = bool(_addr_c or _contact_c)
            htbl = fph.add_table(rows=2 if _has_strip else 1, cols=1, width=Cm(21.0))
            _remove_table_borders(htbl)
            _set_table_full_page_width(htbl, sec)

            cell = htbl.rows[0].cells[0]
            _set_cell_shading(cell, accent_hex)
            _set_cell_width(cell, 21.0)
            _set_cell_margins(cell, top=260, bottom=200, left=_LMPAD, right=_RMPAD)

            fp = cell.paragraphs[0]
            fp.text = ""
            for run in _runs(fp, _firm, bold=True, size=22):
                run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
            _fmt(fp, "center", space_after=2, line=1.05)

            if _tag:
                p = cell.add_paragraph()
                for run in _runs(p, _tag, bold=False, size=10.5):
                    run.italic = True
                    run.font.color.rgb = RGBColor(0xE6, 0xE6, 0xE6)
                _fmt(p, "center", space_after=0, line=1.1)

            if _enrol_detail():
                p = cell.add_paragraph()
                for run in _runs(p, _enrol_detail(), bold=False, size=8):
                    run.font.color.rgb = RGBColor(0xCC, 0xCC, 0xCC)
                _fmt(p, "center", space_after=0, line=1.1)

            # Connected contact strip (light accent tint, dark accent text).
            if _has_strip:
                strip = htbl.rows[1].cells[0]
                _set_cell_shading(strip, light_hex)
                _set_cell_width(strip, 21.0)
                _set_cell_margins(strip, top=90, bottom=90, left=_LMPAD, right=_RMPAD)
                sp = strip.paragraphs[0]
                sp.text = ""
                line = _SEP.join([s for s in (_addr_c, _contact_c) if s])
                for run in _runs(sp, line, bold=False, size=8.5):
                    run.font.color.rgb = accent_rgb
                _fmt(sp, "center", space_after=0, line=1.15)

        elif _design == "border":
            # ── BORDER DESIGN: thick left accent bar, modern layout ──
            # Two columns across the full page width: a transparent spacer
            # that ends just LEFT of the body margin, then a text column
            # whose left border IS the accent bar (sitting ~0.3 cm left of
            # the body column). A 0.3 cm paragraph indent then lands the text
            # exactly on the body column. This keeps the bar visible (it is
            # NOT clipped at the page edge) and the text aligned with the body.
            _bar_gap = 0.30
            _spacer_cm = max(0.0, _LPAD_CM - _bar_gap)
            htbl = fph.add_table(rows=1, cols=2, width=Cm(21.0))
            _remove_table_borders(htbl)
            _set_table_full_page_width(htbl, sec)
            spacer, cell = htbl.rows[0].cells[0], htbl.rows[0].cells[1]
            _set_cell_width(spacer, _spacer_cm)
            _set_cell_width(cell, 21.0 - _spacer_cm)
            _set_cell_margins(spacer, top=0, bottom=0, left=0, right=0)
            _set_cell_margins(cell, top=60, bottom=40, left=0, right=_RMPAD)
            # Thick accent bar = the text cell's left border.
            tcBorders = OxmlElement("w:tcBorders")
            left_bdr = OxmlElement("w:left")
            left_bdr.set(qn("w:val"), "single")
            left_bdr.set(qn("w:sz"), "48")  # 6pt thick
            left_bdr.set(qn("w:space"), "0")
            left_bdr.set(qn("w:color"), accent_hex)
            tcBorders.append(left_bdr)
            _tcpr_set(cell, tcBorders)

            fp = cell.paragraphs[0]
            fp.text = ""
            for run in _runs(fp, _firm, bold=True, size=22):
                run.font.color.rgb = accent_rgb
            _fmt(fp, "left", space_after=2, line=1.05, left=_bar_gap)

            if _tag:
                p = cell.add_paragraph()
                for run in _runs(p, _tag, bold=False, size=10):
                    run.italic = True
                    run.font.color.rgb = RGBColor(0x55, 0x55, 0x55)
                _fmt(p, "left", space_after=2, line=1.1, left=_bar_gap)

            if _quals:
                p = cell.add_paragraph()
                for run in _runs(p, _quals, bold=False, size=9):
                    run.font.color.rgb = RGBColor(0x55, 0x55, 0x55)
                _fmt(p, "left", space_after=0, line=1.1, left=_bar_gap)

            if _enrol_detail():
                p = cell.add_paragraph()
                for run in _runs(p, _enrol_detail(), bold=False, size=8.5):
                    run.font.color.rgb = RGBColor(0x77, 0x77, 0x77)
                _fmt(p, "left", space_after=0, line=1.1, left=_bar_gap)

            if _courts:
                p = cell.add_paragraph()
                for run in _runs(p, f"Practising before: {_courts}", bold=False, size=8.5):
                    run.font.color.rgb = RGBColor(0x77, 0x77, 0x77)
                _fmt(p, "left", space_after=0, line=1.1, left=_bar_gap)

            cline = _contact_oneliner()
            if cline:
                cp = cell.add_paragraph()
                for run in _runs(cp, cline, bold=False, size=8.5):
                    run.font.color.rgb = RGBColor(0x66, 0x66, 0x66)
                _fmt(cp, "left", space_after=0, line=1.15, left=_bar_gap)

        elif _design == "dual-tone":
            # ── DUAL-TONE: accent band + lighter strip below (edge-to-edge) ──
            htbl = fph.add_table(rows=2, cols=1, width=Cm(21.0))
            _remove_table_borders(htbl)
            _set_table_full_page_width(htbl, sec)
            # Top row: dark accent
            top_cell = htbl.rows[0].cells[0]
            _set_cell_shading(top_cell, accent_hex)
            _set_cell_width(top_cell, 21.0)
            _set_cell_margins(top_cell, top=220, bottom=140, left=_LMPAD, right=_RMPAD)

            fp = top_cell.paragraphs[0]
            fp.text = ""
            for run in _runs(fp, _firm, bold=True, size=22):
                run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
            _fmt(fp, "center", space_after=0, line=1.1)

            if _tag:
                p = top_cell.add_paragraph()
                for run in _runs(p, _tag, bold=False, size=10):
                    run.italic = True
                    run.font.color.rgb = RGBColor(0xDD, 0xDD, 0xDD)
                _fmt(p, "center", space_after=0, line=1.1)

            # Bottom row: lighter tint strip with contact (full-bleed too)
            bot_cell = htbl.rows[1].cells[0]
            _set_cell_shading(bot_cell, mid_hex)
            _set_cell_width(bot_cell, 21.0)
            _set_cell_margins(bot_cell, top=80, bottom=80, left=_LMPAD, right=_RMPAD)

            cline = _contact_oneliner()
            bp = bot_cell.paragraphs[0]
            bp.text = ""
            if cline:
                for run in _runs(bp, cline, bold=False, size=8.5):
                    run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
                _fmt(bp, "center", space_after=0, line=1.15)
            elif _enrol_detail():
                for run in _runs(bp, _enrol_detail(), bold=False, size=8.5):
                    run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
                _fmt(bp, "center", space_after=0, line=1.15)
            else:
                _runs(bp, "", size=4)
                _fmt(bp, "center", space_after=0, line=1.0)

        else:
            # ── CLASSIC DESIGN (default): accent rule + gray contact ──
            if has_logo:
                htbl = fph.add_table(rows=1, cols=2, width=Cm(16.0))
                _remove_table_borders(htbl)
                logo_cell = htbl.rows[0].cells[0]
                info_cell = htbl.rows[0].cells[1]
                _set_cell_width(logo_cell, 4.0)
                _set_cell_width(info_cell, 12.0)
                _set_cell_margins(logo_cell, top=60, bottom=20, left=40, right=60)
                _set_cell_margins(info_cell, top=100, bottom=20, left=40, right=40)
                try:
                    lp = logo_cell.paragraphs[0]
                    lp.text = ""
                    run = lp.add_run()
                    run.add_picture(_logo, height=Cm(2.2))
                    _fmt(lp, "left", space_after=0, line=1.0)
                except Exception:
                    pass
            else:
                htbl = fph.add_table(rows=1, cols=1, width=Cm(16.0))
                _remove_table_borders(htbl)
                info_cell = htbl.rows[0].cells[0]
                _set_cell_width(info_cell, 16.0)
                _set_cell_margins(info_cell, top=100, bottom=20, left=40, right=40)
            align = "left" if has_logo else "center"

            fp = info_cell.paragraphs[0]
            fp.text = ""
            for run in _runs(fp, _firm, bold=True, size=24):
                run.font.color.rgb = accent_rgb
            _fmt(fp, align, space_after=2, line=1.05)

            if _tag:
                p = info_cell.add_paragraph()
                for run in _runs(p, _tag, bold=False, size=10.5):
                    run.italic = True
                    run.font.color.rgb = RGBColor(0x55, 0x55, 0x55)
                _fmt(p, align, space_after=2, line=1.1)

            if _quals:
                p = info_cell.add_paragraph()
                for run in _runs(p, _quals, bold=False, size=9):
                    run.font.color.rgb = RGBColor(0x55, 0x55, 0x55)
                _fmt(p, align, space_after=0, line=1.1)

            if _enrol:
                detail = f"Enrolment No. {_enrol}"
                if _bar:
                    detail += f"   |   {_bar}"
                p = info_cell.add_paragraph()
                for run in _runs(p, detail, bold=False, size=8.5):
                    run.font.color.rgb = RGBColor(0x77, 0x77, 0x77)
                _fmt(p, align, space_after=0, line=1.1)

            if _courts:
                p = info_cell.add_paragraph()
                for run in _runs(p, f"Practising before: {_courts}", bold=False, size=8.5):
                    run.font.color.rgb = RGBColor(0x77, 0x77, 0x77)
                _fmt(p, align, space_after=0, line=1.1)

            rule_p = fph.add_paragraph()
            _runs(rule_p, "", size=2)
            _accent_border(rule_p, accent_hex, sz=24)
            _fmt(rule_p, "center", space_after=2, line=1.0)

            cline = _contact_oneliner()
            if cline:
                cp = fph.add_paragraph()
                for run in _runs(cp, cline, bold=False, size=8.5):
                    run.font.color.rgb = RGBColor(0x66, 0x66, 0x66)
                _fmt(cp, "center", space_after=0, line=1.15)
            if _gstin:
                gp = fph.add_paragraph()
                for run in _runs(gp, f"GSTIN: {_gstin}", bold=False, size=7.5):
                    run.font.color.rgb = RGBColor(0x99, 0x99, 0x99)
                _fmt(gp, "center", space_after=0, line=1.1)

    # ── CONTINUATION HEADER (page 2+) ────────
    ch = sec.header
    for p in list(ch.paragraphs):
        p._element.getparent().remove(p._element)
    if _firm or title:
        if _design == "band":
            # Mini accent band for continuation (edge-to-edge)
            ct = ch.add_table(rows=1, cols=2, width=Cm(21.0))
            _remove_table_borders(ct)
            _set_table_full_page_width(ct, sec)
            for c in ct.rows[0].cells:
                _set_cell_shading(c, accent_hex)
            cl, cr = ct.rows[0].cells[0], ct.rows[0].cells[1]
            _set_cell_width(cl, 10.5)
            _set_cell_width(cr, 10.5)
            _set_cell_margins(cl, top=60, bottom=60, left=_LMPAD, right=100)
            _set_cell_margins(cr, top=60, bottom=60, left=100, right=_RMPAD)
            clp = cl.paragraphs[0]; clp.text = ""
            for run in _runs(clp, _firm or "", bold=True, size=9):
                run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
            _fmt(clp, "left", space_after=0, line=1.0)
            crp = cr.paragraphs[0]; crp.text = ""
            for run in _runs(crp, str(title or "")[:80], bold=False, size=9):
                run.font.color.rgb = RGBColor(0xDD, 0xDD, 0xDD)
            _fmt(crp, "right", space_after=0, line=1.0)
        elif _design == "border":
            # Left-border continuation (full-bleed)
            ct = ch.add_table(rows=1, cols=2, width=Cm(21.0))
            _remove_table_borders(ct)
            _set_table_full_page_width(ct, sec)
            cl, cr = ct.rows[0].cells[0], ct.rows[0].cells[1]
            _set_cell_width(cl, 10.5)
            _set_cell_width(cr, 10.5)
            _set_cell_margins(cl, top=40, bottom=20, left=_LMPAD, right=20)
            _set_cell_margins(cr, top=40, bottom=20, left=20, right=_RMPAD)
            tcBorders = OxmlElement("w:tcBorders")
            left_bdr = OxmlElement("w:left")
            left_bdr.set(qn("w:val"), "single")
            left_bdr.set(qn("w:sz"), "36")
            left_bdr.set(qn("w:space"), "0")
            left_bdr.set(qn("w:color"), accent_hex)
            tcBorders.append(left_bdr)
            _tcpr_set(cl, tcBorders)
            clp = cl.paragraphs[0]; clp.text = ""
            for run in _runs(clp, _firm or "", bold=True, size=9):
                run.font.color.rgb = accent_rgb
            _fmt(clp, "left", space_after=0, line=1.0)
            crp = cr.paragraphs[0]; crp.text = ""
            for run in _runs(crp, str(title or "")[:80], bold=False, size=9):
                run.font.color.rgb = RGBColor(0x77, 0x77, 0x77)
            _fmt(crp, "right", space_after=0, line=1.0)
        elif _design == "dual-tone":
            ct = ch.add_table(rows=1, cols=2, width=Cm(21.0))
            _remove_table_borders(ct)
            _set_table_full_page_width(ct, sec)
            for c in ct.rows[0].cells:
                _set_cell_shading(c, accent_hex)
            cl, cr = ct.rows[0].cells[0], ct.rows[0].cells[1]
            _set_cell_width(cl, 10.5)
            _set_cell_width(cr, 10.5)
            _set_cell_margins(cl, top=50, bottom=50, left=_LMPAD, right=100)
            _set_cell_margins(cr, top=50, bottom=50, left=100, right=_RMPAD)
            clp = cl.paragraphs[0]; clp.text = ""
            for run in _runs(clp, _firm or "", bold=True, size=9):
                run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
            _fmt(clp, "left", space_after=0, line=1.0)
            crp = cr.paragraphs[0]; crp.text = ""
            for run in _runs(crp, str(title or "")[:80], bold=False, size=9):
                run.font.color.rgb = RGBColor(0xDD, 0xDD, 0xDD)
            _fmt(crp, "right", space_after=0, line=1.0)
        else:
            ct = ch.add_table(rows=1, cols=2, width=Cm(16.0))
            _remove_table_borders(ct)
            cl = ct.rows[0].cells[0]
            cr = ct.rows[0].cells[1]
            _set_cell_width(cl, 8.0)
            _set_cell_width(cr, 8.0)
            _set_cell_margins(cl, top=20, bottom=10, left=20, right=20)
            _set_cell_margins(cr, top=20, bottom=10, left=20, right=20)
            clp = cl.paragraphs[0]; clp.text = ""
            for run in _runs(clp, _firm or "", bold=True, size=9):
                run.font.color.rgb = accent_rgb
            _fmt(clp, "left", space_after=0, line=1.0)
            crp = cr.paragraphs[0]; crp.text = ""
            for run in _runs(crp, str(title or "")[:80], bold=False, size=9):
                run.font.color.rgb = RGBColor(0x77, 0x77, 0x77)
            _fmt(crp, "right", space_after=0, line=1.0)
            rl = ch.add_paragraph()
            _runs(rl, "", size=1)
            _accent_border(rl, accent_hex, sz=12)
            _fmt(rl, "center", space_after=0, line=1.0)

    # ── FOOTER: build for BOTH default and first-page footers ───────
    def _build_footer(foot):
        for p in list(foot.paragraphs):
            p._element.getparent().remove(p._element)

        if _design == "band" or _design == "dual-tone":
            # Colored footer band — full-bleed across the page. Wider outer
            # columns (8 cm) so "PRIVILEGED & CONFIDENTIAL" fits on one line
            # once the body-margin paragraph indent is applied.
            tbl = foot.add_table(rows=1, cols=3, width=Cm(21.0))
            _remove_table_borders(tbl)
            _set_table_full_page_width(tbl, sec)
            tbl.autofit = False
            _fcols = (8.0, 5.0, 8.0)
            for _ci, _cw in enumerate(_fcols):
                tbl.columns[_ci].width = Cm(_cw)
            row = tbl.rows[0].cells
            for i, c in enumerate(row):
                _set_cell_shading(c, accent_hex)
                _set_cell_width(c, _fcols[i])
                _set_cell_margins(c, top=80, bottom=80, left=20, right=20)

            # Paragraph indents (not cell margins) keep the left label and
            # the page number aligned with the body column inside this
            # full-bleed footer band.
            pl = row[0].paragraphs[0]
            if _confidential:
                for run in _runs(pl, "PRIVILEGED & CONFIDENTIAL", bold=True, size=7):
                    run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
            _fmt(pl, "left", space_after=0, line=1.0, left=_LPAD_CM)

            pc = row[1].paragraphs[0]
            for run in _runs(pc, _footer_note or _firm or "", bold=False, size=8):
                run.font.color.rgb = RGBColor(0xDD, 0xDD, 0xDD)
            _fmt(pc, "center", space_after=0, line=1.0)

            pr = row[2].paragraphs[0]
            pr.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            r = pr.add_run("Page ")
            r.font.name, r.font.size = FONT, Pt(8.5)
            r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
            _add_field(pr, "PAGE", size=8.5)
            r = pr.add_run(" of ")
            r.font.name, r.font.size = FONT, Pt(8.5)
            r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
            _add_field(pr, "NUMPAGES", size=8.5)
            _fmt(pr, "right", space_after=0, line=1.0, right=_RPAD_CM)
            # Make PAGE/NUMPAGES field runs white too
            for run_el in pr._p.findall(qn("w:r")):
                rPr = run_el.find(qn("w:rPr"))
                if rPr is None:
                    rPr = OxmlElement("w:rPr")
                    run_el.insert(0, rPr)
                color_el = rPr.find(qn("w:color"))
                if color_el is None:
                    color_el = OxmlElement("w:color")
                    rPr.append(color_el)
                color_el.set(qn("w:val"), "FFFFFF")

        elif _design == "border":
            # Left-border footer — rule spans full page width
            rule_p = foot.add_paragraph()
            rule_p.paragraph_format.left_indent = -sec.left_margin
            rule_p.paragraph_format.right_indent = -sec.right_margin
            _runs(rule_p, "", size=2)
            _accent_border(rule_p, accent_hex, sz=16)
            _fmt(rule_p, "center", space_after=2, line=1.0)

            tbl = foot.add_table(rows=1, cols=3, width=Cm(21.0))
            _remove_table_borders(tbl)
            _set_table_full_page_width(tbl, sec)
            tbl.autofit = False
            _fcols = (8.0, 5.0, 8.0)
            for _ci, _cw in enumerate(_fcols):
                tbl.columns[_ci].width = Cm(_cw)
            row = tbl.rows[0].cells
            for i, c in enumerate(row):
                _set_cell_width(c, _fcols[i])
                _set_cell_margins(c, top=20, bottom=20, left=20, right=20)
            # Left border on first cell
            tcBorders = OxmlElement("w:tcBorders")
            left_bdr = OxmlElement("w:left")
            left_bdr.set(qn("w:val"), "single")
            left_bdr.set(qn("w:sz"), "36")
            left_bdr.set(qn("w:space"), "0")
            left_bdr.set(qn("w:color"), accent_hex)
            tcBorders.append(left_bdr)
            _tcpr_set(row[0], tcBorders)

            pl = row[0].paragraphs[0]
            if _confidential:
                for run in _runs(pl, "PRIVILEGED & CONFIDENTIAL", bold=True, size=7):
                    run.font.color.rgb = accent_rgb
            _fmt(pl, "left", space_after=0, line=1.0, left=_LPAD_CM)

            pc = row[1].paragraphs[0]
            for run in _runs(pc, _footer_note or _firm or "", bold=False, size=8):
                run.font.color.rgb = RGBColor(0x77, 0x77, 0x77)
            _fmt(pc, "center", space_after=0, line=1.0)

            pr = row[2].paragraphs[0]
            pr.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            r = pr.add_run("Page ")
            r.font.name, r.font.size = FONT, Pt(8.5)
            r.font.color.rgb = RGBColor(0x77, 0x77, 0x77)
            _add_field(pr, "PAGE", size=8.5)
            r = pr.add_run(" of ")
            r.font.name, r.font.size = FONT, Pt(8.5)
            r.font.color.rgb = RGBColor(0x77, 0x77, 0x77)
            _add_field(pr, "NUMPAGES", size=8.5)
            _fmt(pr, "right", space_after=0, line=1.0, right=_RPAD_CM)

        else:
            # Classic footer — rule spans full page width
            rule_p = foot.add_paragraph()
            rule_p.paragraph_format.left_indent = -sec.left_margin
            rule_p.paragraph_format.right_indent = -sec.right_margin
            _runs(rule_p, "", size=2)
            _accent_border(rule_p, accent_hex, sz=16)
            _fmt(rule_p, "center", space_after=2, line=1.0)

            tbl = foot.add_table(rows=1, cols=3, width=Cm(16.0))
            _remove_table_borders(tbl)
            tbl.autofit = False
            tbl.columns[0].width = Cm(6.0)
            tbl.columns[1].width = Cm(5.0)
            tbl.columns[2].width = Cm(5.0)
            row = tbl.rows[0].cells
            for c in row:
                _set_cell_margins(c, top=10, bottom=10, left=20, right=20)

            pl = row[0].paragraphs[0]
            if _confidential:
                for run in _runs(pl, "PRIVILEGED & CONFIDENTIAL", bold=True, size=7):
                    run.font.color.rgb = accent_rgb
            _fmt(pl, "left", space_after=0, line=1.0)

            pc = row[1].paragraphs[0]
            for run in _runs(pc, _footer_note or _firm or "", bold=False, size=8):
                run.font.color.rgb = RGBColor(0x77, 0x77, 0x77)
            _fmt(pc, "center", space_after=0, line=1.0)

            pr = row[2].paragraphs[0]
            pr.alignment = WD_ALIGN_PARAGRAPH.RIGHT
            r = pr.add_run("Page ")
            r.font.name, r.font.size = FONT, Pt(8.5)
            r.font.color.rgb = RGBColor(0x77, 0x77, 0x77)
            _add_field(pr, "PAGE", size=8.5)
            r = pr.add_run(" of ")
            r.font.name, r.font.size = FONT, Pt(8.5)
            r.font.color.rgb = RGBColor(0x77, 0x77, 0x77)
            _add_field(pr, "NUMPAGES", size=8.5)

    _build_footer(sec.footer)
    _build_footer(sec.first_page_footer)


def _normalize_letterhead(lh):
    """Accept the old list-of-lines shape OR the new structured dict.
    Returns a dict or None when there's nothing to render."""
    if lh is None:
        return None
    if isinstance(lh, dict):
        return lh
    if isinstance(lh, (list, tuple)) and lh:
        # Legacy: first line was the firm name, rest went underneath. Map
        # it onto the structured dict so headers/footers still work.
        lines = [str(x).strip() for x in lh if str(x).strip()]
        return {
            "name": lines[0] if lines else "",
            "address": "\n".join(lines[1:4]) if len(lines) > 1 else "",
            "contact": lines[4] if len(lines) > 4 else "",
            "tagline": "", "footer": "", "confidential": False,
        }
    return None


def _render_blocks(doc, blocks, base_indent=0.0):
    """Render the structured blocks into the document body.

    base_indent (cm) is added to every paragraph's left/right indent. For
    the full-bleed designs the page margins are zero, so this recreates the
    visual text margin. Blocks that set their own left indent add it on top
    of the base so the relative layout is preserved."""
    b_l = base_indent          # body left inset
    # Thin spacer: gives one line of breathing room between the first-page
    # header and body text. On continuation pages the margin already
    # provides the gap so this just adds a negligible ~3pt sliver.
    _fmt(doc.add_paragraph(), space_after=3, line=1.0, left=b_l or None, right=b_l or None)
    for b in blocks:
        t = b["type"]
        if t == "pagebreak":
            doc.add_page_break()
        elif t == "spacer":
            _fmt(doc.add_paragraph(), space_after=6, line=1.0, left=b_l or None, right=b_l or None)
        elif t == "title":
            p = doc.add_paragraph()
            _runs(p, b.get("text", ""), bold=True, size=14, underline=True)
            _fmt(p, "center", 14, 1.5, keep_next=True, left=b_l or None, right=b_l or None)
        elif t == "heading":
            p = doc.add_paragraph()
            _runs(p, b.get("text", ""), bold=True)
            _fmt(p, "left", 6, 1.5, keep_next=True, left=b_l or None, right=b_l or None)
        elif t in ("right", "center"):
            p = doc.add_paragraph()
            _runs(p, b.get("text", ""), bold=bool(b.get("bold")))
            _fmt(p, t, 4, 1.15, left=b_l or None, right=b_l or None)
        elif t == "address":
            for i, line in enumerate(b.get("lines", [])):
                p = doc.add_paragraph()
                _runs(p, line, bold=(i == 0))
                _fmt(p, "left", 0 if i < len(b["lines"]) - 1 else 10, 1.15, left=b_l, right=b_l or None)
        elif t == "signature":
            for i, line in enumerate(b.get("lines", [])):
                p = doc.add_paragraph()
                _runs(p, line, bold=(i == 0))
                _fmt(p, "left", 0, 1.15, left=b_l + 8.5, keep_next=(i < len(b["lines"]) - 1), right=b_l or None)
        elif t in ("numbered", "lettered"):
            p = doc.add_paragraph()
            label = f"{b.get('number', '')}." if t == "numbered" else b.get("letter", "")
            _runs(p, f"{label}\t{b.get('text', '')}")
            _fmt(p, "justify", 8, 1.5, left=b_l + 1.27, first=-1.27, right=b_l or None)
            p.paragraph_format.tab_stops.add_tab_stop(Cm(b_l + 1.27))
        elif t == "table":
            rows = b.get("rows", [])
            if rows:
                tbl = doc.add_table(rows=len(rows), cols=max(len(r) for r in rows))
                tbl.style = "Table Grid"
                tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
                for ri, row in enumerate(rows):
                    for ci, cell in enumerate(row):
                        c = tbl.cell(ri, ci)
                        c.text = ""
                        _runs(c.paragraphs[0], cell, bold=(b.get("header") and ri == 0), size=11)
                _fmt(doc.add_paragraph(), space_after=6, line=1.0)
        else:  # para
            p = doc.add_paragraph()
            _runs(p, b.get("text", ""), bold=bool(b.get("bold")))
            _fmt(p, b.get("align", "left"), 8, 1.5, keep_next=bool(b.get("bold")), left=b_l or None, right=b_l or None)


def _clear_body_keep_section(doc):
    """Remove all body content from a template document but keep the final
    section properties (w:sectPr) — which carry the page size, margins and
    the references to the template's own headers and footers. This lets us
    open a firm's letterhead .docx and pour fresh body text into it while
    its designed header/footer stay exactly as made."""
    body = doc.element.body
    for child in list(body):
        # The body-level sectPr is the very last child and holds the
        # header/footer references — keep it. Remove everything else
        # (paragraphs, tables, any placeholder "type your letter here").
        if child.tag == qn("w:sectPr"):
            continue
        body.remove(child)


_PT2CM = 2.54 / 72.0


def _estimate_header_height_cm(header, usable_width_cm=15.9):
    """Measure how tall the built header actually is, in cm, by walking its
    paragraphs and tables. Derives the page top margin from the REAL header
    content for ANY design — no hardcoded per-template numbers. It also
    estimates line WRAP (long contact lines etc.) from each paragraph's text
    length vs the width available to it, so a header whose text wraps to two
    lines is measured as two lines, not one."""
    import math
    from docx.oxml.ns import qn as _qn
    from docx.table import Table as _Table
    from docx.text.paragraph import Paragraph as _Paragraph

    def _dxa(el, attr='w'):
        try:
            return int(el.get(_qn('w:' + attr)))
        except Exception:
            return 0

    def _para_h(p, avail_cm):
        text = "".join(r.text or "" for r in p.runs)
        sizes = [r.font.size.pt for r in p.runs if r.font.size is not None]
        fs = max(sizes) if sizes else 11.0
        pf = p.paragraph_format
        ls = pf.line_spacing
        mult = ls if (isinstance(ls, float) and 0 < ls < 3) else 1.15
        sa = pf.space_after.pt if pf.space_after is not None else 0.0
        sb = pf.space_before.pt if pf.space_before is not None else 0.0
        # subtract this paragraph's own left/right indent from the width.
        li = pf.left_indent.cm if pf.left_indent is not None else 0.0
        ri = pf.right_indent.cm if pf.right_indent is not None else 0.0
        avail = max(1.0, avail_cm - li - ri)
        # average glyph advance ≈ 0.50 × font size (serif body text).
        char_w_cm = max(0.01, fs * 0.50 * _PT2CM)
        cpl = max(1, int(avail / char_w_cm))
        lines = max(1, math.ceil(len(text) / cpl)) if text else 1
        img_cm = 0.0
        for dr in p._p.findall('.//' + _qn('wp:extent')):
            try:
                img_cm = max(img_cm, int(dr.get('cy')) / 360000.0)
            except Exception:
                pass
        line_cm = (fs * 1.25 * mult) * lines * _PT2CM + (sa + sb) * _PT2CM
        return max(line_cm, img_cm + (sa + sb) * _PT2CM)

    def _cell_vmargin_cm(cell):
        tcPr = cell._tc.find(_qn('w:tcPr'))
        if tcPr is None:
            return 0.0
        mar = tcPr.find(_qn('w:tcMar'))
        if mar is None:
            return 0.0
        tot = 0.0
        for side in ('top', 'bottom'):
            el = mar.find(_qn('w:' + side))
            if el is not None:
                tot += _dxa(el) / 20.0  # dxa → pt
        return tot * _PT2CM

    def _cell_width_cm(cell):
        tcPr = cell._tc.find(_qn('w:tcPr'))
        if tcPr is not None:
            w = tcPr.find(_qn('w:tcW'))
            if w is not None and _dxa(w) > 0:
                return _dxa(w) / 567.0
        return usable_width_cm

    def _cell_hmargin_cm(cell):
        tcPr = cell._tc.find(_qn('w:tcPr'))
        if tcPr is None:
            return 0.0
        mar = tcPr.find(_qn('w:tcMar'))
        if mar is None:
            return 0.0
        tot = 0.0
        for side in ('left', 'right'):
            el = mar.find(_qn('w:' + side))
            if el is not None:
                tot += _dxa(el) / 567.0
        return tot

    total = 0.0
    for child in header._element.iterchildren():
        if child.tag == _qn('w:p'):
            total += _para_h(_Paragraph(child, header), usable_width_cm)
        elif child.tag == _qn('w:tbl'):
            tbl = _Table(child, header)
            for row in tbl.rows:
                row_h = 0.0
                for cell in row.cells:
                    avail = max(1.0, _cell_width_cm(cell) - _cell_hmargin_cm(cell))
                    ch = _cell_vmargin_cm(cell) + sum(_para_h(p, avail) for p in cell.paragraphs)
                    row_h = max(row_h, ch)
                total += row_h
    return total


def _apply_template_safe_margins(doc):
    """Template mapping engine entry point. Render the (body-cleared) template
    to detect its safe white content zone, then set the section's top/bottom
    margins so poured body text lands clear of the template's background art.
    No-op (keeps the template's own margins) if rendering is unavailable or no
    clear zone is found, so export never fails because of this."""
    import tempfile as _tf
    from docx.shared import Cm as _Cm
    try:
        from utils.docx_preview import detect_safe_content_margins_cm
    except Exception:
        return

    sec = doc.sections[0]
    try:
        pw_cm = sec.page_width.cm or 21.0
        ph_cm = sec.page_height.cm or 29.7
    except Exception:
        pw_cm, ph_cm = 21.0, 29.7

    # Render this exact doc (body already cleared) to detect the art.
    tmpdir = _tf.mkdtemp(prefix="lh_map_")
    tmp = os.path.join(tmpdir, "probe.docx")
    try:
        doc.save(tmp)
        box = detect_safe_content_margins_cm(tmp, page_height_cm=ph_cm, page_width_cm=pw_cm)
    finally:
        try:
            os.remove(tmp)
            os.rmdir(tmpdir)
        except Exception:
            pass
    if not box:
        return
    top_cm, bottom_cm = box
    # Only widen the margins (never shrink what the designer set), so we push
    # text IN to clear art but never pull it out over a side the template
    # already protected.
    cur_top = sec.top_margin.cm if sec.top_margin else 0
    cur_bot = sec.bottom_margin.cm if sec.bottom_margin else 0
    sec.top_margin = _Cm(max(cur_top, top_cm))
    sec.bottom_margin = _Cm(max(cur_bot, bottom_cm))


def to_docx(blocks, title="Document", letterhead_lines=None, letterhead=None) -> bytes:
    # ════════════════════════════════════════════════════════════════════
    # LETTERHEAD GEOMETRY IS LOAD-BEARING AND EASY TO BREAK.
    # Before changing header/footer layout, margins, indents or the
    # top-margin auto-fit below, read the invariants and WHY in the
    # "letterhead-export-logic" memory, and after ANY change run:
    #     python scripts/verify_letterhead_export.py
    # (then also render a page to PNG and LOOK — XML checks alone miss bugs).
    # Key rules that must not regress:
    #   • bleed designs (band/dual-tone/border) use ZERO page side margins;
    #     body inset comes from _render_blocks(base_indent=…), NOT Normal style.
    #   • all w:tcPr edits go through _tcpr_set (schema order, no dupes).
    #   • band text aligns to body via PARAGRAPH indent, never cell margins.
    #   • top margin is measured from the built header, never hardcoded.
    # ════════════════════════════════════════════════════════════════════
    blocks = _safe_blocks(blocks)

    # ── TEMPLATE PATH: firm uploaded a full .docx letterhead ─────────
    # If the letterhead record points at an uploaded Word template, use
    # THAT file as the base document. Its header, footer, logo, colours
    # and page numbers are already defined inside the file, so we keep
    # them and just inject the drafted body. This is the one-upload,
    # both-sections approach (how Word mail-merge / Lawyaw work).
    _lh_dict = letterhead if isinstance(letterhead, dict) else None
    _tpl = ((_lh_dict or {}).get("template_docx") or "").strip()
    if _tpl and os.path.isfile(_tpl):
        try:
            doc = Document(_tpl)
            _clear_body_keep_section(doc)
            doc.core_properties.title = str(title)[:120]
            # ── TEMPLATE MAPPING ENGINE ──────────────────────────────────
            # Templates often carry full-page background art (coloured
            # corners/bands) whose text margins don't clear it, so poured
            # body text collides with the decoration. Detect the safe white
            # content zone by rendering the empty template and fit the body's
            # top/bottom margins to it, so text lands between the top and
            # bottom art instead of over it. Best-effort: if rendering isn't
            # available, we keep the template's own margins.
            try:
                _apply_template_safe_margins(doc)
            except Exception:
                pass
            _render_blocks(doc, blocks)
            buf = io.BytesIO()
            doc.save(buf)
            return buf.getvalue()
        except Exception:
            # Corrupt or unreadable template — fall through to the
            # built-from-fields header/footer so export never fails.
            pass

    _MARGIN_CM = 2.54  # the visual left/right text margin

    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
    sec.bottom_margin = Cm(2.54)
    _design_for_layout = ((_lh_dict or {}).get("design") or "classic").strip() if _lh_dict else "classic"
    # Left/right EDGE bleed (zero page margins so a full-width table spans
    # edge-to-edge): band, dual-tone and border all want this.
    _bleed_header = _design_for_layout in ("band", "dual-tone", "border")
    # TOP-edge bleed: only the designs with a solid coloured fill should run
    # to the very top edge. Border/classic are bare text — pinning them to the
    # top edge looks cramped, so they keep a gap above the header.
    _filled_band = _design_for_layout in ("band", "dual-tone")
    # Full-bleed trick: Word clips a table at the page's right TEXT margin, so
    # a negative-indent band bleeds left but stops short on the right. The fix
    # is to set the real page left/right margins to ZERO (so a full-width
    # table spans edge-to-edge both sides) and recreate the visual text margin
    # as a per-paragraph indent on the body.
    if _bleed_header:
        sec.left_margin = sec.right_margin = Cm(0.0)
    else:
        sec.left_margin = sec.right_margin = Cm(_MARGIN_CM)
    # header_distance: filled bands bleed to the very top edge (0); border and
    # classic keep a comfortable gap so their bare header text isn't squashed
    # against the paper edge.
    _header_dist_cm = 0.0 if _filled_band else (0.9 if _design_for_layout == "border" else 1.0)
    sec.header_distance = Cm(_header_dist_cm)
    # Footer bleeds to the bottom edge for filled bands; normal gap otherwise.
    sec.footer_distance = Cm(1.2)
    # Provisional top margin; the real one is computed AFTER the header is
    # built, from its measured height (see below).
    sec.top_margin = Cm(4.0)
    st = doc.styles["Normal"]
    st.font.name, st.font.size = FONT, Pt(12)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    # With zero page margins (bleed designs) the body text would touch the
    # paper edge, so recreate the visual margin as a per-paragraph indent in
    # _render_blocks. We DON'T put it on the Normal style, because the
    # header/footer band cells also use Normal and must stay at 0 indent.
    _body_base = _MARGIN_CM if _bleed_header else 0.0
    doc.core_properties.title = str(title)[:120]
    doc.core_properties.author = "LexAmplify"

    # Build full legal headers + footers. The new letterhead kwarg takes
    # a dict (name/tagline/address/contact/footer/confidential); the old
    # letterhead_lines kwarg is still accepted for backward compat.
    _lh = _normalize_letterhead(letterhead if letterhead is not None else letterhead_lines)
    _build_headers_footers(doc, _lh, title)

    # ── Universal top-margin fit ─────────────────────────────────────────
    # Size top_margin for CONTINUATION pages (page 2+), whose running
    # header is compact. The first page gets its breathing room from
    # a thin spacer paragraph injected at the top of the body (see
    # _render_blocks), so Word's auto-push clears the tall first-page
    # header and then the spacer adds one visible line of gap.
    try:
        _hdr_h = _estimate_header_height_cm(sec.header)  # continuation header
    except Exception:
        _hdr_h = 0.0
    _BODY_GAP_CM = 0.4
    _computed_top = _header_dist_cm + _hdr_h + _BODY_GAP_CM
    sec.top_margin = Cm(max(2.0, round(_computed_top, 2)))

    _render_blocks(doc, blocks, base_indent=_body_base)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def docx_text(data: bytes) -> str:
    """Text of a .docx as the reader would see it (used to prove the file matches the preview)."""
    d = Document(io.BytesIO(data))
    parts = [p.text for p in d.paragraphs]
    for t in d.tables:
        for row in t.rows:
            parts.append(" | ".join(c.text for c in row.cells))
    return "\n".join(parts)


# ── PDF ────────────────────────────────────────────────────────────────────────────────────────
def _has_rupee(path) -> bool:
    try:
        from fontTools.ttLib import TTFont
        f = TTFont(path, lazy=True, fontNumber=0)
        return 0x20B9 in f.getBestCmap()
    except Exception:  # noqa: BLE001 - an unreadable font simply is not chosen for the rupee sign
        return False


def _find_font():
    """Return (regular, bold, has_rupee). Prefers a font that can print the rupee sign.
    Order: DRAFT_FONT_DIR, static/fonts (bundled), then common system fonts."""
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    dirs = [os.environ.get("DRAFT_FONT_DIR", ""), os.path.join(root, "static", "fonts"),
            r"C:\Windows\Fonts", "/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/truetype/liberation",
            "/usr/share/fonts/truetype/liberation2", "/Library/Fonts", "/System/Library/Fonts/Supplemental"]
    pairs = [("DejaVuSerif.ttf", "DejaVuSerif-Bold.ttf"), ("Tinos-Regular.ttf", "Tinos-Bold.ttf"),
             ("times.ttf", "timesbd.ttf"), ("LiberationSerif-Regular.ttf", "LiberationSerif-Bold.ttf"),
             ("Times New Roman.ttf", "Times New Roman Bold.ttf"), ("arial.ttf", "arialbd.ttf")]
    fallback = None
    for d in dirs:
        if not d:
            continue
        for reg, bold in pairs:
            r, b = os.path.join(d, reg), os.path.join(d, bold)
            if os.path.isfile(r) and os.path.isfile(b):
                if _has_rupee(r):
                    return r, b, True
                fallback = fallback or (r, b, False)
    return fallback or (None, None, False)


def to_pdf(blocks, title="Document", letterhead_lines=None, letterhead=None):
    """Returns (bytes, notes). `notes` lists anything the reader should
    know (e.g. fallback font used). `letterhead` is a dict matching the
    DOCX export shape (name, tagline, address, contact, footer,
    confidential). Legacy `letterhead_lines` list is still accepted."""
    from fpdf import FPDF

    blocks = _safe_blocks(blocks)
    notes = []
    reg, bold, has_rupee = _find_font()
    fonts = {}
    _lh = _normalize_letterhead(letterhead if letterhead is not None else letterhead_lines) or {}
    _firm = (_lh.get("name") or "").strip()
    _tag = (_lh.get("tagline") or "").strip()
    _addr = (_lh.get("address") or "").strip()
    _contact = (_lh.get("contact") or "").strip()
    _footer_note = (_lh.get("footer") or "").strip()
    _confidential = bool(_lh.get("confidential"))

    class _PDF(FPDF):
        """Legal-grade header/footer. FPDF's header()/footer() fire on
        EVERY page; we branch on page_no() so page 1 carries the full
        letterhead and page 2+ carries only a small continuation strip.
        Footer is uniform on every page."""
        def header(self):
            fam = fonts.get("fam", "Times")
            if self.page_no() == 1 and _firm:
                # Full letterhead
                self.set_y(12)
                self.set_font(fam, "B", 16)
                self.set_text_color(10, 10, 10)
                self.cell(0, 8, _firm[:120], align="C", new_x="LMARGIN", new_y="NEXT")
                if _tag:
                    self.set_font(fam, "", 10)
                    self.set_text_color(100, 100, 100)
                    self.cell(0, 5, _tag[:160], align="C", new_x="LMARGIN", new_y="NEXT")
                if _addr:
                    self.set_font(fam, "", 9)
                    self.set_text_color(90, 90, 90)
                    # Flatten multi-line address to a single comma-separated
                    # line so it fits cleanly in the header band without
                    # eating body space.
                    addr_one = ", ".join(ln.strip().rstrip(",") for ln in _addr.splitlines() if ln.strip())
                    self.cell(0, 4.5, addr_one[:200], align="C", new_x="LMARGIN", new_y="NEXT")
                if _contact:
                    self.set_font(fam, "", 9)
                    self.cell(0, 4.5, _contact[:160], align="C", new_x="LMARGIN", new_y="NEXT")
                # Rule under the letterhead
                self.ln(1)
                y = self.get_y()
                self.set_draw_color(150, 150, 150)
                self.line(self.l_margin, y, self.w - self.r_margin, y)
                self.set_text_color(0, 0, 0)
                # Body starts below here.
                self.set_y(y + 4)
            elif _firm or title:
                # Page 2+: continuation strip
                self.set_y(10)
                self.set_font(fam, "", 8)
                self.set_text_color(130, 130, 130)
                # Firm name left, title right.
                self.cell(0, 4, _firm[:80], align="L")
                self.set_y(10)
                self.cell(0, 4, str(title or "")[:80], align="R", new_x="LMARGIN", new_y="NEXT")
                self.ln(1)
                y = self.get_y()
                self.set_draw_color(210, 210, 210)
                self.line(self.l_margin, y, self.w - self.r_margin, y)
                self.set_text_color(0, 0, 0)

        def footer(self):
            fam = fonts.get("fam", "Times")
            self.set_y(-18)
            # Rule above footer
            self.set_draw_color(200, 200, 200)
            self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
            self.ln(1)
            self.set_font(fam, "", 8)
            self.set_text_color(120, 120, 120)
            W = self.w - self.l_margin - self.r_margin
            # Left: confidentiality (only when flagged)
            left_text = "ATTORNEY–CLIENT PRIVILEGED & CONFIDENTIAL" if _confidential else ""
            # Center: firm name OR firm-set footer text
            center_text = _footer_note or _firm or ""
            # Right: Page X of Y
            right_text = f"Page {self.page_no()} of {{nb}}"
            # 3-column cell row (new_x=END keeps us on the same line)
            self.cell(W / 3, 5, left_text, align="L", new_x="END", new_y="TOP")
            self.cell(W / 3, 5, center_text[:120], align="C", new_x="END", new_y="TOP")
            self.cell(W / 3, 5, right_text, align="R", new_x="LMARGIN", new_y="NEXT")
            self.set_text_color(0, 0, 0)

    pdf = _PDF(format="A4", unit="mm")
    pdf.set_margins(25.4, 25.4, 25.4)
    # Reserve extra top margin on page 1 for the letterhead, less on
    # continuation pages. 46mm covers a 4-line letterhead + rule + gap.
    pdf.set_auto_page_break(True, 28)
    pdf.set_title(str(title)[:120])
    # Enable {nb} total-page substitution for 'Page X of Y'.
    pdf.alias_nb_pages()
    if reg:
        pdf.add_font("Body", "", reg)
        pdf.add_font("Body", "B", bold)
        fonts["fam"] = "Body"
        fam = "Body"
        if has_rupee:
            subst = lambda s: s  # noqa: E731
        else:
            subst = lambda s: s.replace("₹", "Rs. ")  # noqa: E731
            notes.append("The PDF font has no rupee sign, so amounts are written as 'Rs.'. Install a bundled font (static/fonts) to fix this.")
    else:
        fam = "Times"
        notes.append("PDF used a basic font because no Unicode font is installed; the rupee sign is written as 'Rs.'.")
        subst = lambda s: s.replace("₹", "Rs. ").encode("latin-1", "replace").decode("latin-1")  # noqa: E731
    pdf.add_page()
    W = pdf.w - pdf.l_margin - pdf.r_margin

    def para(text, align="L", bold_all=False, size=12, h=7.0, indent=0.0, space=3.0):
        text = subst(text)
        pdf.set_x(pdf.l_margin + indent)
        pos = 0
        segs = []
        for m in BRACKET_RE.finditer(text):
            if m.start() > pos:
                segs.append((text[pos:m.start()], False))
            segs.append((m.group(0), True))
            pos = m.end()
        if pos < len(text):
            segs.append((text[pos:], False))
        if align in ("C", "R"):
            # centred/right-aligned lines are short: flatten to one string (brackets keep colour only in L/J)
            pdf.set_font(fam, "B" if bold_all else "", size)
            pdf.multi_cell(W - indent, h, text, align=align, new_x="LMARGIN", new_y="NEXT")
        else:
            for chunk, is_field in segs:
                pdf.set_font(fam, "B" if (bold_all or is_field) else "", size)
                pdf.set_text_color(160, 40, 30) if is_field else pdf.set_text_color(0, 0, 0)
                pdf.write(h, chunk)
            pdf.set_text_color(0, 0, 0)
            pdf.ln(h)
        pdf.ln(space)

    # NOTE: no inline letterhead loop here anymore — the full letterhead
    # is rendered by _PDF.header() on page 1 (and the small continuation
    # strip on page 2+). Dumping letterhead_lines into the body again
    # here would duplicate the firm name.
    for b in blocks:
        t = b["type"]
        if t == "pagebreak":
            pdf.add_page()
        elif t == "spacer":
            pdf.ln(4)
        elif t == "title":
            para(b.get("text", ""), "C", True, 14, 8, space=4)
        elif t == "heading":
            para(b.get("text", ""), "L", True)
        elif t == "right":
            para(b.get("text", ""), "R", bool(b.get("bold")), h=6, space=1)
        elif t == "center":
            para(b.get("text", ""), "C", bool(b.get("bold")), h=6, space=1)
        elif t == "address":
            for i, line in enumerate(b.get("lines", [])):
                para(line, "L", i == 0, h=6, space=0)
            pdf.ln(4)
        elif t == "signature":
            for i, line in enumerate(b.get("lines", [])):
                para(line, "L", i == 0, h=6, indent=W * 0.5, space=0)
        elif t in ("numbered", "lettered"):
            label = f"{b.get('number', '')}.  " if t == "numbered" else f"{b.get('letter', '')}  "
            para(label + b.get("text", ""), "L", indent=0.0 if t == "numbered" else 8.0)
        elif t == "table":
            for row in b.get("rows", []):
                para(" | ".join(row), "L", bool(b.get("header") and row is b["rows"][0]), size=11, h=6, space=1)
            pdf.ln(3)
        else:
            para(b.get("text", ""), "L", bool(b.get("bold")))
    out = bytes(pdf.output())
    return out, notes
