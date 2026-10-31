"""Turn a normal text-based PDF into a scanned-looking PDF.

Every page is rasterized to an image, then re-wrapped in a new PDF. The
output has NO embedded text layer, which forces the Contract Analyzer
to use its OCR fallback (RapidOCR / Tesseract) when you upload it.

Usage:
    python scripts/make_scanned_pdf.py <input.pdf> <output.pdf> [--dpi 180]
"""
import argparse
import sys
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description="Convert a text PDF into a scanned image PDF.")
    ap.add_argument("input", type=Path, help="Source PDF (text-based).")
    ap.add_argument("output", type=Path, help="Where to write the scanned PDF.")
    ap.add_argument("--dpi", type=int, default=180,
                    help="Image DPI per page. 150 = fast / blurry, 220 = slow / crisp. Default 180.")
    args = ap.parse_args()

    if not args.input.exists():
        print(f"error: input not found: {args.input}", file=sys.stderr)
        return 2

    try:
        import fitz
    except ImportError:
        print("error: PyMuPDF (pymupdf) not installed. Run: pip install pymupdf", file=sys.stderr)
        return 2

    src = fitz.open(str(args.input))
    out = fitz.open()
    print(f"source: {args.input}  pages={src.page_count}  dpi={args.dpi}")

    mat = fitz.Matrix(args.dpi / 72.0, args.dpi / 72.0)
    for i, page in enumerate(src):
        pix = page.get_pixmap(matrix=mat, alpha=False)
        img_bytes = pix.tobytes("png")
        rect = fitz.Rect(0, 0, pix.width, pix.height)
        new_page = out.new_page(width=pix.width, height=pix.height)
        new_page.insert_image(rect, stream=img_bytes)
        if (i + 1) % 25 == 0 or i == src.page_count - 1:
            print(f"  rasterised {i + 1}/{src.page_count}")

    out.save(str(args.output), garbage=4, deflate=True)
    out.close()
    src.close()
    print(f"wrote scanned PDF: {args.output}  size={args.output.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
