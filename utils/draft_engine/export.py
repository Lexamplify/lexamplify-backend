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
    """Add text, highlighting every [Bracketed Field: ...]."""
    pos = 0
    for m in BRACKET_RE.finditer(text):
        if m.start() > pos:
            _run(paragraph, text[pos:m.start()], bold, size, underline)
        r = _run(paragraph, m.group(0), bold, size, underline)
        r.font.highlight_color = WD_COLOR_INDEX.YELLOW
        pos = m.end()
    if pos < len(text):
        _run(paragraph, text[pos:], bold, size, underline)


def _run(paragraph, text, bold, size, underline):
    r = paragraph.add_run(text)
    r.bold = bold
    r.underline = underline
    r.font.name = FONT
    r.font.size = Pt(size)
    r._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    return r


def _fmt(p, align="left", space_after=8, line=1.5, left=None, first=None, keep_next=False):
    pf = p.paragraph_format
    p.alignment = _ALIGN.get(align, WD_ALIGN_PARAGRAPH.LEFT)
    pf.space_after = Pt(space_after)
    pf.space_before = Pt(0)
    pf.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    pf.line_spacing = line
    if left is not None:
        pf.left_indent = Cm(left)
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


def _build_headers_footers(doc, letterhead, title):
    """Install proper legal-grade headers and footers on the first
    section. letterhead is None or a dict:
        {name, tagline, address, contact, footer, confidential}
    """
    sec = doc.sections[0]
    # Enable per-page-position headers/footers so page 1 can carry the
    # full letterhead while page 2+ carries only a small continuation
    # header. Without this flag, Word treats first_page_header the same
    # as header and the letterhead would also appear on continuation pages.
    sec.different_first_page_header_footer = True
    _firm = ((letterhead or {}).get("name") or "").strip()
    _tag = ((letterhead or {}).get("tagline") or "").strip()
    _addr = ((letterhead or {}).get("address") or "").strip()
    _contact = ((letterhead or {}).get("contact") or "").strip()
    _footer_note = ((letterhead or {}).get("footer") or "").strip()
    _confidential = bool((letterhead or {}).get("confidential"))

    # ── FIRST-PAGE HEADER: full letterhead ─────────────────────────
    fph = sec.first_page_header
    # python-docx creates an empty paragraph on access; reuse the first
    # one so we don't end up with a stray blank line above the letterhead.
    first_para = fph.paragraphs[0] if fph.paragraphs else fph.add_paragraph()
    if _firm:
        _runs(first_para, _firm, bold=True, size=17)
        _fmt(first_para, "center", space_after=2, line=1.1)
        if _tag:
            p = fph.add_paragraph()
            _runs(p, _tag, bold=False, size=10)
            _fmt(p, "center", space_after=2, line=1.1)
        if _addr:
            # Address can be multi-line; keep each line in its own paragraph
            # so Word doesn't wrap it strangely.
            for line in [ln for ln in _addr.splitlines() if ln.strip()][:3]:
                p = fph.add_paragraph()
                _runs(p, line, bold=False, size=9)
                _fmt(p, "center", space_after=0, line=1.1)
        if _contact:
            p = fph.add_paragraph()
            _runs(p, _contact, bold=False, size=9)
            _fmt(p, "center", space_after=2, line=1.1)
        # Thin rule under the letterhead to divide it from the body.
        rule = fph.add_paragraph()
        _rule(rule)

    # ── CONTINUATION HEADER (page 2+): small firm name + doc title ─
    ch = sec.header
    chp = ch.paragraphs[0] if ch.paragraphs else ch.add_paragraph()
    # Use a tab to right-align the title while keeping firm name left.
    if _firm or title:
        tab_stops = chp.paragraph_format.tab_stops
        try:
            tab_stops.add_tab_stop(Cm(16.0), WD_ALIGN_PARAGRAPH.RIGHT)
        except Exception:
            pass
        _runs(chp, _firm or "", bold=False, size=9)
        chp.add_run("\t")
        _runs(chp, str(title or "")[:80], bold=False, size=9)
        _fmt(chp, "left", space_after=2, line=1.0)
        _rule(chp)

    # ── FOOTER: every page ─────────────────────────────────────────
    # Table-based layout: 3 columns (left: confidentiality / center:
    # firm name / right: Page X of Y). Table gives us reliable
    # independent alignment per cell — a single paragraph with tabs
    # drifts when the content widths change.
    foot = sec.footer
    # Clear whatever python-docx auto-inserted and build fresh.
    for p in list(foot.paragraphs):
        p._element.getparent().remove(p._element)
    rule_p = foot.add_paragraph()
    _runs(rule_p, "", size=1)
    _rule(rule_p)
    from docx.enum.table import WD_ALIGN_VERTICAL
    tbl = foot.add_table(rows=1, cols=3, width=Cm(16.0))
    tbl.autofit = False
    for cell, width in zip(tbl.columns[0].cells, (Cm(6.0), Cm(5.0), Cm(5.0))):
        pass
    tbl.columns[0].width = Cm(6.0)
    tbl.columns[1].width = Cm(5.0)
    tbl.columns[2].width = Cm(5.0)
    row = tbl.rows[0].cells
    # Left: confidentiality (only when flagged)
    pl = row[0].paragraphs[0]
    if _confidential:
        _runs(pl, "ATTORNEY–CLIENT PRIVILEGED & CONFIDENTIAL", bold=True, size=7)
    _fmt(pl, "left", space_after=0, line=1.0)
    # Center: firm name (or footer text if the firm set one), small
    pc = row[1].paragraphs[0]
    _runs(pc, _footer_note or _firm or "", bold=False, size=8)
    _fmt(pc, "center", space_after=0, line=1.0)
    # Right: Page X of Y (live field codes)
    pr = row[2].paragraphs[0]
    pr.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    r = pr.add_run("Page ")
    r.font.name, r.font.size = FONT, Pt(9)
    _add_field(pr, "PAGE", size=9)
    r = pr.add_run(" of ")
    r.font.name, r.font.size = FONT, Pt(9)
    _add_field(pr, "NUMPAGES", size=9)


def _normalize_letterhead(lh):
    """Accept the old list-of-lines shape OR the new structured dict.
    Returns a dict {name, tagline, address, contact, footer, confidential}
    or None when there's nothing to render."""
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


def to_docx(blocks, title="Document", letterhead_lines=None, letterhead=None) -> bytes:
    blocks = _safe_blocks(blocks)
    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
    sec.left_margin = sec.right_margin = Cm(2.54)
    sec.top_margin = sec.bottom_margin = Cm(2.54)
    # Give the footer room so it never collides with the body text.
    sec.footer_distance = Cm(1.2)
    sec.header_distance = Cm(1.0)
    st = doc.styles["Normal"]
    st.font.name, st.font.size = FONT, Pt(12)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    doc.core_properties.title = str(title)[:120]
    doc.core_properties.author = "LexAmplify"

    # Build full legal headers + footers. The new letterhead kwarg takes
    # a dict (name/tagline/address/contact/footer/confidential); the old
    # letterhead_lines kwarg is still accepted for backward compat.
    _lh = _normalize_letterhead(letterhead if letterhead is not None else letterhead_lines)
    _build_headers_footers(doc, _lh, title)

    for b in blocks:
        t = b["type"]
        if t == "pagebreak":
            doc.add_page_break()
        elif t == "spacer":
            _fmt(doc.add_paragraph(), space_after=6, line=1.0)
        elif t == "title":
            p = doc.add_paragraph()
            _runs(p, b.get("text", ""), bold=True, size=14, underline=True)
            _fmt(p, "center", 14, 1.5, keep_next=True)
        elif t == "heading":
            p = doc.add_paragraph()
            _runs(p, b.get("text", ""), bold=True)
            _fmt(p, "left", 6, 1.5, keep_next=True)
        elif t in ("right", "center"):
            p = doc.add_paragraph()
            _runs(p, b.get("text", ""), bold=bool(b.get("bold")))
            _fmt(p, t, 4, 1.15)
        elif t == "address":
            for i, line in enumerate(b.get("lines", [])):
                p = doc.add_paragraph()
                _runs(p, line, bold=(i == 0))
                _fmt(p, "left", 0 if i < len(b["lines"]) - 1 else 10, 1.15, left=0.0)
        elif t == "signature":
            for i, line in enumerate(b.get("lines", [])):
                p = doc.add_paragraph()
                _runs(p, line, bold=(i == 0))
                _fmt(p, "left", 0, 1.15, left=8.5, keep_next=(i < len(b["lines"]) - 1))
        elif t in ("numbered", "lettered"):
            p = doc.add_paragraph()
            label = f"{b.get('number', '')}." if t == "numbered" else b.get("letter", "")
            _runs(p, f"{label}\t{b.get('text', '')}")
            _fmt(p, "justify", 8, 1.5, left=1.27, first=-1.27)
            p.paragraph_format.tab_stops.add_tab_stop(Cm(1.27))
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
            _fmt(p, b.get("align", "left"), 8, 1.5, keep_next=bool(b.get("bold")))
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
