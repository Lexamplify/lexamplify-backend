"""
services/supreme_court_seeder.py
Hardcoded Supreme Court virtual-court roster, transcribed directly from the
"Court List" screenshots supplied for this task (5 images, WhatsApp Image
2026-08-31 ...). Every row across all 5 images was read: Court Room, VC
Link, VC Meeting ID, Email ID. VC Meeting ID and Email ID were BLANK in
every single row without exception — not illegible, genuinely empty in the
source — so they're seeded as None here rather than fabricated. `judges` is
None for the same reason: no judge-name column exists in these screenshots
at all.

Court Rooms 1-17 use VC links of the form sci-vc.webex.com/meet/courtNN
(NN zero-padded to 2 digits); the two Registrar Courts use
.../meet/registrarcourtNN and are labeled "RC 1"/"RC 2" (with the space)
to match the screenshots' own display text exactly.
"""

SUPREME_COURT_SEED_DATA = [
    {"court_room": "1", "judges": None, "vc_link": "https://sci-vc.webex.com/meet/court01", "court_master_email": None},
    {"court_room": "2", "judges": None, "vc_link": "https://sci-vc.webex.com/meet/court02", "court_master_email": None},
    {"court_room": "3", "judges": None, "vc_link": "https://sci-vc.webex.com/meet/court03", "court_master_email": None},
    {"court_room": "4", "judges": None, "vc_link": "https://sci-vc.webex.com/meet/court04", "court_master_email": None},
    {"court_room": "5", "judges": None, "vc_link": "https://sci-vc.webex.com/meet/court05", "court_master_email": None},
    {"court_room": "6", "judges": None, "vc_link": "https://sci-vc.webex.com/meet/court06", "court_master_email": None},
    {"court_room": "7", "judges": None, "vc_link": "https://sci-vc.webex.com/meet/court07", "court_master_email": None},
    {"court_room": "8", "judges": None, "vc_link": "https://sci-vc.webex.com/meet/court08", "court_master_email": None},
    {"court_room": "9", "judges": None, "vc_link": "https://sci-vc.webex.com/meet/court09", "court_master_email": None},
    {"court_room": "10", "judges": None, "vc_link": "https://sci-vc.webex.com/meet/court10", "court_master_email": None},
    {"court_room": "11", "judges": None, "vc_link": "https://sci-vc.webex.com/meet/court11", "court_master_email": None},
    {"court_room": "12", "judges": None, "vc_link": "https://sci-vc.webex.com/meet/court12", "court_master_email": None},
    {"court_room": "13", "judges": None, "vc_link": "https://sci-vc.webex.com/meet/court13", "court_master_email": None},
    {"court_room": "14", "judges": None, "vc_link": "https://sci-vc.webex.com/meet/court14", "court_master_email": None},
    {"court_room": "15", "judges": None, "vc_link": "https://sci-vc.webex.com/meet/court15", "court_master_email": None},
    {"court_room": "16", "judges": None, "vc_link": "https://sci-vc.webex.com/meet/court16", "court_master_email": None},
    {"court_room": "17", "judges": None, "vc_link": "https://sci-vc.webex.com/meet/court17", "court_master_email": None},
    {"court_room": "RC 1", "judges": None, "vc_link": "https://sci-vc.webex.com/meet/registrarcourt01", "court_master_email": None},
    {"court_room": "RC 2", "judges": None, "vc_link": "https://sci-vc.webex.com/meet/registrarcourt02", "court_master_email": None},
]


def seed_supreme_court_roster(db, SupremeCourtRoster) -> int:
    """Idempotent: clears the table before inserting, so re-running never
    duplicates rows. Returns the number of rows inserted."""
    SupremeCourtRoster.query.delete()
    for entry in SUPREME_COURT_SEED_DATA:
        db.session.add(SupremeCourtRoster(**entry))
    db.session.commit()
    return len(SUPREME_COURT_SEED_DATA)
