"""Synthetic 'paper' for the scan tests: pages photographed on a desk (tilted, in perspective, shadowed, rotated), scanner PDFs and separator sheets."""
import numpy as np
import pymupdf as fitz

from conftest import make_pdf


def page_image(text, dpi=150):
    import cv2
    d = fitz.open("pdf", make_pdf([text]))
    pix = d[0].get_pixmap(dpi=dpi, alpha=False)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, 3)
    d.close()
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def desk_photo(page, angle=4, persp=True, shadow=True, bg=(60, 70, 80), size=(3000, 2200)):
    import cv2
    H, W = size[1], size[0]
    canvas = np.full((H, W, 3), bg, np.uint8)
    ph, pw = page.shape[:2]
    scale = min(W * 0.75 / pw, H * 0.9 / ph)
    pg = cv2.resize(page, (int(pw * scale), int(ph * scale)))
    ph, pw = pg.shape[:2]
    src = np.float32([[0, 0], [pw, 0], [pw, ph], [0, ph]])
    dst = src + np.float32([[W / 2 - pw / 2, H / 2 - ph / 2]] * 4)
    if persp:
        dst += np.float32([[0, 30], [-20, 0], [0, -25], [25, 10]])
    R = cv2.getRotationMatrix2D((W / 2, H / 2), angle, 1.0)
    dst_h = np.hstack([dst, np.ones((4, 1), np.float32)]) @ R.T
    M = cv2.getPerspectiveTransform(src, dst_h.astype(np.float32))
    warped = cv2.warpPerspective(pg, M, (W, H), borderValue=(0, 0, 0))
    mask = cv2.warpPerspective(np.full(pg.shape[:2], 255, np.uint8), M, (W, H))
    out = np.where(mask[..., None] > 0, warped, canvas)
    if shadow:
        grad = np.tile(np.linspace(0.55, 1.0, W, dtype=np.float32), (H, 1))[..., None]
        out = (out.astype(np.float32) * np.where(mask[..., None] > 0, grad, 1.0)).astype(np.uint8)
    noise = np.random.RandomState(1).normal(0, 5, out.shape)
    return np.clip(out + noise, 0, 255).astype(np.uint8)


def jpeg(img, quality=82):
    import cv2
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    assert ok
    return buf.tobytes()


def photo_of(text, **kw):
    """JPEG bytes of a desk photo of a page that says `text`."""
    return jpeg(desk_photo(page_image(text), **kw))


def rotated(img, deg):
    import cv2
    code = {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}[deg]
    return cv2.rotate(img, code)


def blank_photo(**kw):
    import cv2
    img = np.full((1754, 1240, 3), 240, np.uint8)
    rs = np.random.RandomState(5)
    img = np.clip(img + rs.normal(0, 4, img.shape), 0, 255).astype(np.uint8)
    for _ in range(12):
        cv2.circle(img, (int(rs.randint(40, 1200)), int(rs.randint(40, 1700))), int(rs.randint(1, 3)), (120, 120, 120), -1)
    return jpeg(desk_photo(img, **kw))


def separator_photo(**kw):
    from utils import dms_scan as SC
    d = fitz.open("pdf", SC.separator_pdf(1))
    pix = d[0].get_pixmap(dpi=150, alpha=False)
    import cv2
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, 3)
    return jpeg(desk_photo(cv2.cvtColor(arr, cv2.COLOR_RGB2BGR), **kw))


PLAINT = ("IN THE COURT OF CIVIL JUDGE, SAKET DISTRICT COURT, NEW DELHI\nCS 10/2026\nSharma ... Plaintiff\nversus\nVerma ... Defendant\n"
          "PLAINT\nThe plaintiff above named respectfully submits as under:\n1. That the plaintiff is a resident of Delhi.\n2. That the defendant owes the plaintiff Rs. 5,00,000.")
PLAINT_P2 = ("3. That despite repeated demands the defendant has not paid.\nPRAYER\nIt is prayed that this Hon'ble Court may pass a decree.\n"
             "Place: New Delhi\nDated: 10-01-2026\nThrough Counsel\nSd/-\nAdvocate for the Plaintiff")
AFFIDAVIT = ("AFFIDAVIT\nIN THE COURT OF CIVIL JUDGE, SAKET DISTRICT COURT, NEW DELHI\nCS 10/2026\nSharma vs Verma\n"
             "I, Ramesh Sharma, son of Mohan Sharma, do hereby solemnly affirm and state on oath as under:\n1. That I am the plaintiff in the above suit.\nDeponent\nVERIFICATION")
VAKALATNAMA = ("VAKALATNAMA\nIN THE HIGH COURT OF DELHI AT NEW DELHI\nW.P.(C) 777/2025\nRajesh Kumar ... Petitioner\nversus\nUnion of India ... Respondent\n"
               "I, Rajesh Kumar, do hereby appoint Asha Rao, Advocate, to appear for me in the above matter.")
