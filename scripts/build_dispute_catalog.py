"""
scripts/build_dispute_catalog.py

Single readable source for the Dispute Library used by Auto-Draft Studio's
"Disputes" tab and the Dispute AI (routes/dispute_routes.py).

    python scripts/build_dispute_catalog.py

writes the SAME json to
    data/dispute_catalog.json                       (backend / AI grounding)
    frontend/src/data/disputeCatalog.json           (frontend, works offline)
and validates it. Never hand-edit the json - edit this file and re-run.

Accuracy policy
---------------
* Every statutory reference below was either checked against a primary or
  reputable secondary source in September 2026 or is a long-settled
  provision. Where a provision, threshold or period is state-specific,
  recently amended, under challenge, or not personally re-verified, the entry
  says so (see `limitation` / `cautions`) instead of asserting a number.
* This library is a drafting aid, not legal advice - the UI says so on every
  screen that shows it.
* The skeleton generator (frontend/src/utils/disputeDraft.js) only ever uses
  text from this file plus the facts the lawyer typed - it cannot invent law.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
REVIEWED = "2026-09-29"

CATEGORIES = [
    ("criminal",   "Bail & Criminal",            "Bail, anticipatory bail, quashing, complaints and cheque dishonour"),
    ("family",     "Family & Matrimonial",       "Divorce, maintenance, custody, domestic violence, personal laws"),
    ("consumer",   "Consumer",                   "Deficiency in service, defective goods, insurance, medical, e-commerce"),
    ("property",   "Property & Tenancy",         "Title, possession, partition, injunctions, eviction, RERA"),
    ("commercial", "Money & Commercial",         "Recovery, contract breach, MSME dues, arbitration, partnership, company law"),
    ("banking",    "Banking & Insolvency",       "IBC, DRT, SARFAESI"),
    ("employment", "Employment & Labour",        "Dues, terminations, POSH, service matters"),
    ("ip_cyber",   "IP, Cyber & Technology",     "Trademark, copyright, patents, cyber fraud, online defamation"),
    ("public",     "Writs, RTI & Public Law",    "Writs, PIL, RTI, contempt, notices to Government, GST appeals"),
    ("accident",   "Accident & Insurance",       "Motor accident claims and insurance repudiation"),
    ("succession", "Succession & Guardianship",  "Probate, letters of administration, succession certificate"),
    ("procedural", "Replies & Procedural",       "Written statements, applications, appeals, execution, caveats"),
]

PARTIES = {
    "accused":     ("Applicant / Accused",   "Respondent / State"),
    "petitioner":  ("Petitioner",            "Respondent"),
    "plaintiff":   ("Plaintiff",             "Defendant"),
    "complainant": ("Complainant",           "Accused"),
    "applicant":   ("Applicant",             "Respondent"),
    "consumer":    ("Complainant",           "Opposite Party"),
    "claimant":    ("Claimant",              "Respondent"),
    "appellant":   ("Appellant",             "Respondent"),
    "defendant":   ("Defendant",             "Plaintiff"),
    "notice":      ("Client (Sender)",       "Addressee"),
    "rti":         ("Applicant",             "Public Information Officer"),
}

# Facts every document of a kind needs - the lawyer always fills these.
BASES = {
    "petition": [
        {"key": "court", "label": "Court / Forum", "hint": "e.g. Court of the Principal District & Sessions Judge, Chennai", "type": "text"},
        {"key": "case_no", "label": "Case / FIR / Diary No. (if any)", "hint": "Leave blank for fresh filing", "type": "text"},
        {"key": "p1_name", "label": "{P1} — full name", "hint": "As in identity documents", "type": "text"},
        {"key": "p1_desc", "label": "{P1} — parentage/spouse, age, occupation, address", "hint": "S/o, W/o, aged, occupation, r/o", "type": "textarea"},
        {"key": "p2_name", "label": "{P2} — full name", "hint": "", "type": "text"},
        {"key": "p2_desc", "label": "{P2} — description and address", "hint": "", "type": "textarea"},
        {"key": "advocate", "label": "Advocate (name & enrolment no.)", "hint": "", "type": "text"},
        {"key": "place", "label": "Place", "hint": "", "type": "text"},
        {"key": "date", "label": "Date", "hint": "", "type": "date"},
    ],
    "notice": [
        {"key": "date", "label": "Date of notice", "hint": "", "type": "date"},
        {"key": "mode", "label": "Mode of service", "hint": "Registered Post A.D. / Speed Post / Courier / Email", "type": "text"},
        {"key": "p1_name", "label": "Client (sender) — full name", "hint": "", "type": "text"},
        {"key": "p1_desc", "label": "Client — description and address", "hint": "", "type": "textarea"},
        {"key": "p2_name", "label": "Addressee — full name", "hint": "", "type": "text"},
        {"key": "p2_desc", "label": "Addressee — description and address", "hint": "", "type": "textarea"},
        {"key": "notice_days", "label": "Compliance period (days)", "hint": "Use the statutory period where one is stated below", "type": "number"},
        {"key": "advocate", "label": "Advocate (name, enrolment no., address)", "hint": "", "type": "textarea"},
        {"key": "place", "label": "Place", "hint": "", "type": "text"},
    ],
    "reply": [
        {"key": "date", "label": "Date of reply", "hint": "", "type": "date"},
        {"key": "p1_name", "label": "Client (noticee) — full name", "hint": "", "type": "text"},
        {"key": "p1_desc", "label": "Client — description and address", "hint": "", "type": "textarea"},
        {"key": "p2_name", "label": "Sender / their advocate — name", "hint": "", "type": "text"},
        {"key": "p2_desc", "label": "Sender / their advocate — address", "hint": "", "type": "textarea"},
        {"key": "notice_date", "label": "Date of the notice being replied to", "hint": "", "type": "date"},
        {"key": "notice_ref", "label": "Reference no. of that notice", "hint": "", "type": "text"},
        {"key": "advocate", "label": "Advocate (name, enrolment no., address)", "hint": "", "type": "textarea"},
        {"key": "place", "label": "Place", "hint": "", "type": "text"},
    ],
    "rti": [
        {"key": "p1_name", "label": "Applicant — full name", "hint": "", "type": "text"},
        {"key": "p1_desc", "label": "Applicant — postal address (and email/phone)", "hint": "", "type": "textarea"},
        {"key": "authority", "label": "Public authority", "hint": "Name of department / body", "type": "text"},
        {"key": "pio", "label": "Address of the PIO", "hint": "", "type": "textarea"},
        {"key": "fee_mode", "label": "Fee payment details", "hint": "e.g. IPO / DD / online transaction no.; or BPL certificate no.", "type": "text"},
        {"key": "place", "label": "Place", "hint": "", "type": "text"},
        {"key": "date", "label": "Date", "hint": "", "type": "date"},
    ],
}

CATALOG = []


def S(ref, note=""):
    return {"ref": ref, "note": note}


def F(key, label, hint="", type="text"):
    return {"key": key, "label": label, "hint": hint, "type": type}


def D(id, cat, title, blurb, *, doc, forum, parties="petitioner", statutes=(), limitation="",
      pre=(), facts=(), outline=(), grounds=(), prayers=(), annex=(), cautions=(),
      sections=(), kind="petition", verification="affidavit", ai=True, keywords=""):
    CATALOG.append({
        "id": id, "cat": cat, "title": title, "blurb": blurb, "kind": kind,
        "doc": doc, "forum": forum, "parties": list(PARTIES[parties]),
        "statutes": [s if isinstance(s, dict) else S(*s) for s in statutes],
        "limitation": limitation, "pre": list(pre), "facts": list(facts),
        "outline": list(outline), "grounds": list(grounds), "prayers": list(prayers),
        "annex": list(annex), "cautions": list(cautions),
        "sections": [{"h": h, "b": b} for h, b in sections],
        "verification": verification, "ai": ai, "keywords": keywords,
    })


COMMON_CAUTION_VERIFY = "Confirm every statutory reference against India Code and the current amendments before filing."

# ═════════════════════════════════════════════════════════════════════
#  1. BAIL & CRIMINAL
# ═════════════════════════════════════════════════════════════════════
BAIL_FACTS = [
    F("fir_no", "FIR No. / Crime No.", "", "text"),
    F("ps", "Police Station", "", "text"),
    F("offences", "Offences / sections invoked", "BNS sections (or IPC if the FIR pre-dates 1 July 2024) and any special statute", "text"),
    F("arrest_date", "Date of arrest / custody", "", "date"),
    F("chargesheet", "Investigation status", "Chargesheet filed on ___ / investigation pending", "text"),
    F("earlier_bail", "Earlier bail applications and outcome", "Court, date, result — write 'None' if none", "textarea"),
]
BAIL_ANNEX = ["Copy of the FIR", "Copy of remand / custody orders", "Chargesheet (if filed)",
              "Order(s) on earlier bail application(s), if any", "Identity and address proof of applicant and proposed sureties"]
BAIL_OUTLINE = [
    "The FIR — date, police station, and the allegations against the applicant in brief",
    "Arrest and custody — date of arrest, period spent in custody so far",
    "Investigation status — recoveries, chargesheet, what remains to be done",
    "Earlier bail applications — court, date, outcome (full disclosure)",
    "The applicant's personal background — family, employment, roots in the community",
]
BAIL_GROUNDS = [
    "The allegations, even taken at their face value, do not make out the ingredients of the offence(s) alleged against the applicant. [Explain, with reference to the FIR and material collected.]",
    "Custodial interrogation is not required: [investigation is complete / chargesheet has been filed / recoveries have been effected].",
    "The applicant is not a flight risk, has deep roots in the community, and will not tamper with evidence or influence witnesses; the applicant will abide by any condition the Court imposes.",
    "The applicant has been in custody for [period]; the trial is unlikely to conclude soon, and prolonged pre-trial detention infringes Article 21 of the Constitution.",
    "Parity: co-accused [name], alleged to have played a similar or greater role, was granted bail by [court] on [date]. [Delete if not applicable.]",
    "The applicant has no criminal antecedents. [Or disclose antecedents and explain why they do not weigh against bail.]",
]
BAIL_CAUTIONS = [
    "Disclose every earlier bail application and its outcome — suppression is a common reason for dismissal.",
    "Check whether the offence attracts a special-statute bail bar (NDPS s.37, PMLA s.45, UAPA, etc.) — see the separate entries.",
    "FIRs registered before 1 July 2024 are still governed by the IPC/CrPC framework; the BNSS/BNS apply to later offences (savings clause, BNSS s.531).",
]

D("bail-regular-sessions", "criminal", "Regular Bail — Court of Session / High Court",
  "Regular bail in a non-bailable offence before the Sessions Court or High Court.",
  doc="Application for Regular Bail under Section 483 of the Bharatiya Nagarik Suraksha Sanhita, 2023",
  forum="Court of Session / High Court", parties="accused",
  statutes=[S("Section 483, BNSS 2023", "Special powers of the High Court and Court of Session regarding bail (earlier s.439 CrPC)"),
            S("Article 21, Constitution of India", "Personal liberty")],
  limitation="No limitation. Check whether the High Court's practice requires the Sessions Court to be approached first.",
  pre=["Confirm the correct forum: Magistrate (s.480) or Sessions Court/High Court (s.483).",
       "Obtain the FIR, remand orders, and any earlier bail orders."],
  facts=BAIL_FACTS, outline=BAIL_OUTLINE, grounds=BAIL_GROUNDS,
  prayers=["Release the applicant on regular bail in FIR / Crime No. {{fir_no}} of Police Station {{ps}} on such terms and conditions as this Hon'ble Court deems fit."],
  annex=BAIL_ANNEX, cautions=BAIL_CAUTIONS,
  keywords="bail regular jail custody arrested accused release non-bailable 483 439 437")

D("bail-magistrate", "criminal", "Regular Bail — Magistrate (non-bailable offence)",
  "Bail in a non-bailable offence before the Magistrate.",
  doc="Application for Regular Bail under Section 480 of the Bharatiya Nagarik Suraksha Sanhita, 2023",
  forum="Court of the Magistrate", parties="accused",
  statutes=[S("Section 480, BNSS 2023", "Bail in non-bailable offences by the Magistrate (earlier s.437 CrPC)"),
            S("Section 478, BNSS 2023", "Bail as of right in bailable offences (earlier s.436 CrPC)")],
  limitation="No limitation.",
  pre=["Confirm the offence is non-bailable and triable/handled at Magistrate level — if it is bailable, apply under s.478 (bail as of right).",
       "Note that a Magistrate cannot grant bail where reasonable grounds exist to believe the accused is guilty of an offence punishable with death or life imprisonment, subject to the statutory exceptions — check s.480(1)."],
  facts=BAIL_FACTS, outline=BAIL_OUTLINE, grounds=BAIL_GROUNDS,
  prayers=["Release the applicant on bail in FIR / Crime No. {{fir_no}} of Police Station {{ps}} on such terms and conditions as this Hon'ble Court deems fit."],
  annex=BAIL_ANNEX, cautions=BAIL_CAUTIONS,
  keywords="bail magistrate 480 437 non bailable bailable 478 436")

D("bail-anticipatory", "criminal", "Anticipatory Bail",
  "Pre-arrest bail where arrest is apprehended in a non-bailable offence.",
  doc="Application for Anticipatory Bail under Section 482 of the Bharatiya Nagarik Suraksha Sanhita, 2023",
  forum="Court of Session / High Court", parties="accused",
  statutes=[S("Section 482, BNSS 2023", "Direction for grant of bail to a person apprehending arrest (earlier s.438 CrPC)")],
  limitation="No limitation, but the application must be made while arrest is apprehended.",
  pre=["Identify the accusation and why arrest is apprehended (FIR registered / notice received / threats).",
       "Check the High Court's practice on the Sessions Court being approached first.",
       "Be ready to appear for the final hearing: the Court may require the applicant's presence."],
  facts=[F("fir_no", "FIR No. / Crime No. (or nature of accusation)"), F("ps", "Police Station"),
         F("offences", "Offences / sections invoked", "", "text"),
         F("apprehension", "Why arrest is apprehended", "Notice under BNSS s.35, calls, threats, complaint filed", "textarea"),
         F("cooperation", "Cooperation with investigation so far", "Dates of appearance, documents given", "textarea"),
         F("earlier_bail", "Earlier applications and outcome", "", "textarea")],
  outline=["The accusation — FIR or complaint and its allegations in brief",
           "Why the applicant apprehends arrest",
           "The applicant's cooperation with the investigation so far",
           "The applicant's personal background — family, employment, roots in the community",
           "Earlier applications — court, date, outcome (full disclosure)"],
  grounds=["The applicant has been falsely implicated; the allegations do not disclose the ingredients of the offence(s). [Explain.]",
           "The applicant has joined / will join the investigation whenever called and will cooperate fully.",
           "There is no need for custodial interrogation: [documents / material already collected or available for production].",
           "The applicant is not a flight risk and will not tamper with evidence or threaten witnesses; the applicant will abide by any conditions imposed.",
           "The accusation appears intended to humiliate or harass the applicant: [explain the background — civil dispute, personal enmity, etc.]."],
  prayers=["Direct that, in the event of arrest in connection with {{fir_no}} of Police Station {{ps}}, the applicant be released on bail on such terms and conditions as this Hon'ble Court deems fit.",
           "Grant interim protection from arrest till the disposal of this application."],
  annex=["Copy of the FIR / complaint", "Notice(s) received from the police, if any", "Proof of cooperation with the investigation",
         "Order(s) on any earlier application", "Identity and address proof of the applicant"],
  cautions=["Ask for interim protection expressly if arrest is imminent.",
            "Anticipatory bail is discretionary: candid disclosure of antecedents and earlier applications matters.",
            "Special statutes may restrict it (e.g. the SC/ST (Prevention of Atrocities) Act) — check the statute invoked."],
  keywords="anticipatory bail pre-arrest bail apprehend arrest 482 438 protection from arrest")

D("bail-default", "criminal", "Default (Statutory) Bail",
  "Bail as of right where the chargesheet is not filed within the statutory period.",
  doc="Application for Default Bail under Section 187(3) of the Bharatiya Nagarik Suraksha Sanhita, 2023",
  forum="Court of the Magistrate / Court exercising remand jurisdiction", parties="accused",
  statutes=[S("Section 187(3), BNSS 2023", "Default bail — 90 days for offences punishable with death, life imprisonment or imprisonment of 10 years or more; 60 days for other offences (earlier s.167(2) CrPC)")],
  limitation="The right accrues on expiry of the period and must be claimed before the chargesheet is filed.",
  pre=["Compute the exact date detention began (date of first remand) and the day the 60/90-day period ended.",
       "Check that no chargesheet was filed within time, and that the application is filed and pressed before any late chargesheet is filed."],
  facts=[F("fir_no", "FIR No. / Crime No."), F("ps", "Police Station"), F("offences", "Offences / sections invoked"),
         F("remand_date", "Date of first remand", "", "date"), F("period", "Applicable period (60 / 90 days) and why", "", "text"),
         F("expiry_date", "Date on which the period expired", "", "date"),
         F("cs_status", "Chargesheet status on the date of the application", "", "text")],
  outline=["Date of arrest and first remand", "The offence(s) and the statutory period that applies",
           "Expiry of the period without a chargesheet", "Filing of this application before any chargesheet"],
  grounds=["The statutory period of [60/90] days expired on [date] and no chargesheet had been filed by then.",
           "The right to default bail is an indefeasible statutory right that accrues on expiry of the period; the applicant has exercised it by filing this application before any chargesheet.",
           "The applicant is ready and willing to furnish bail bonds and abide by conditions the Court may impose."],
  prayers=["Declare that the applicant has become entitled to default bail under Section 187(3) BNSS and release the applicant on bail on furnishing bail bonds in FIR / Crime No. {{fir_no}}."],
  annex=["Copy of the FIR", "Remand orders showing the date of first remand", "Proof that no chargesheet was filed within the period (docket / case status)"],
  cautions=["A chargesheet filed before the application is made can defeat the claim — file and press the application immediately on expiry.",
            "BNSS s.187 changes how police custody can be staggered; check the full section before computing periods."],
  keywords="default bail statutory bail chargesheet not filed 60 days 90 days 187 167(2)")

D("bail-undertrial-479", "criminal", "Release of Undertrial who has served part of the maximum sentence",
  "Release on bail/bond where the undertrial has served one-half (or one-third for a first-time offender) of the maximum sentence.",
  doc="Application for Release under Section 479 of the Bharatiya Nagarik Suraksha Sanhita, 2023",
  forum="Trial Court", parties="accused",
  statutes=[S("Section 479, BNSS 2023", "Maximum period for which an undertrial can be detained (earlier s.436A CrPC); first-time offenders are entitled to release after one-third of the maximum sentence")],
  limitation="No limitation.",
  pre=["Confirm the offence is not punishable with death or life imprisonment (excluded), and that the accused is not facing multiple pending cases that bar release.",
       "Compute the period of custody undergone (delay caused by the accused is excluded) against the maximum sentence."],
  facts=[F("fir_no", "FIR No. / Case No."), F("offences", "Offences charged"), F("max_sentence", "Maximum sentence for the offence", "", "text"),
         F("custody_period", "Period of custody undergone", "", "text"), F("first_offender", "First-time offender? (Yes/No, and basis)", "", "text")],
  outline=["The charge and the maximum sentence prescribed", "The period of custody undergone", "Whether the applicant is a first-time offender"],
  grounds=["The applicant has undergone detention for [period], which exceeds [one-half / one-third] of the maximum sentence for the offence.",
           "The applicant is a first-time offender who has never been convicted of any offence. [Delete if not applicable.]",
           "The delay in trial is not attributable to the applicant."],
  prayers=["Release the applicant on bail / personal bond under Section 479 BNSS."],
  annex=["Custody certificate from the jail authority", "Charge sheet / charge framed", "Declaration of no previous conviction"],
  cautions=["Section 479 imposes a duty on the jail superintendent to move the Court on eligibility — mention if they have not."],
  keywords="undertrial 436A 479 half sentence one third first offender release jail custody period")

D("bail-ndps", "criminal", "Bail — NDPS Act offences",
  "Bail where the twin conditions of s.37 NDPS Act apply (commercial quantity).",
  doc="Application for Regular Bail under Section 483 BNSS read with Section 37 of the Narcotic Drugs and Psychotropic Substances Act, 1985",
  forum="Special Court under the NDPS Act / High Court", parties="accused",
  statutes=[S("Section 37, NDPS Act 1985", "Offences to be cognizable and non-bailable; twin conditions for bail in specified offences (Public Prosecutor heard; reasonable grounds for believing the accused is not guilty and not likely to commit an offence on bail)"),
            S("Section 483, BNSS 2023", "Bail — High Court / Court of Session")],
  limitation="No limitation.",
  pre=["Check the seized quantity against the statutory small / intermediate / commercial quantity — s.37's twin conditions bite for commercial quantity.",
       "Verify compliance with Sections 42, 50 and 52A NDPS Act (search, seizure, sampling) — non-compliance is often the strongest ground."],
  facts=BAIL_FACTS + [F("quantity", "Quantity and substance alleged", "", "text"), F("compliance", "Search / seizure / sampling defects noticed", "", "textarea")],
  outline=BAIL_OUTLINE + ["The contraband alleged, its quantity and category", "Procedural compliance under the NDPS Act — search, seizure, sampling, independent witnesses"],
  grounds=BAIL_GROUNDS + ["There are reasonable grounds for believing that the applicant is not guilty: [defects in seizure / sampling / link evidence — set out specifically].",
                          "The applicant is not likely to commit any offence while on bail. [State basis.]"],
  prayers=["Release the applicant on regular bail in {{fir_no}} on such terms and conditions as this Hon'ble Court deems fit."],
  annex=BAIL_ANNEX + ["Seizure memo and sampling / FSL documents"],
  cautions=BAIL_CAUTIONS + ["Address both limbs of Section 37 expressly — a bare 'no antecedents' plea is not enough."],
  keywords="ndps narcotics drugs ganja heroin commercial quantity section 37 bail")

D("bail-pmla", "criminal", "Bail — PMLA offences",
  "Bail in money-laundering cases where s.45 PMLA's twin conditions apply.",
  doc="Application for Regular Bail under Section 45 of the Prevention of Money-Laundering Act, 2002",
  forum="Special Court under the PMLA / High Court", parties="accused",
  statutes=[S("Section 45, PMLA 2002", "Offences cognizable and non-bailable; twin conditions (Public Prosecutor heard; reasonable grounds to believe the accused is not guilty and not likely to commit an offence on bail); proviso for women, minors, the sick and infirm"),
            S("Section 3 and 4, PMLA 2002", "Offence of money-laundering and its punishment")],
  limitation="No limitation.",
  pre=["Identify the scheduled (predicate) offence and its status — the PMLA case depends on it.",
       "Obtain the ECIR/complaint, arrest grounds and remand orders."],
  facts=[F("ecir_no", "ECIR / Complaint No."), F("scheduled_offence", "Scheduled (predicate) offence and its status", "", "text"),
         F("arrest_date", "Date of arrest by ED", "", "date"), F("complaint_status", "Prosecution complaint filed?", "", "text"),
         F("earlier_bail", "Earlier bail applications and outcome", "", "textarea")],
  outline=["The ECIR / prosecution complaint and the allegations", "Predicate offence and its present status",
           "Arrest by the Directorate of Enforcement and custody period", "Personal background and antecedents"],
  grounds=["Even on the Directorate's own case, there are reasonable grounds to believe the applicant is not guilty of money-laundering: [role, no proceeds of crime traced to the applicant, etc.].",
           "The applicant is not likely to commit any offence while on bail. [State basis.]",
           "The prolonged custody and the pace of the trial weigh in favour of bail; [period of custody; number of witnesses; stage of trial].",
           "The grounds of arrest were not [supplied in writing / supplied in time]. [Delete if not applicable.]"],
  prayers=["Release the applicant on bail in ECIR No. {{ecir_no}} on such terms and conditions as this Hon'ble Court deems fit."],
  annex=["Copy of the ECIR / complaint", "Arrest memo and grounds of arrest", "Remand orders", "Order(s) on earlier bail application(s)"],
  cautions=["Deal with both twin conditions; the courts test them at a prima facie level, not as a trial.",
            "Check the latest Supreme Court directions on the interaction of s.45 with Article 21 before relying on any precedent — this area moves quickly."],
  keywords="pmla money laundering ed enforcement directorate section 45 bail ecir")

D("bail-cancellation", "criminal", "Cancellation of Bail",
  "Application to cancel bail granted to the accused on supervening circumstances or misuse.",
  doc="Application for Cancellation of Bail under Section 483(3) of the Bharatiya Nagarik Suraksha Sanhita, 2023",
  forum="Court of Session / High Court (or the Magistrate under s.480(5) where bail was granted by the Magistrate)", parties="applicant",
  statutes=[S("Section 483(3), BNSS 2023", "Power of the High Court / Court of Session to set aside bail granted"),
            S("Section 480(5), BNSS 2023", "Cancellation of bail granted by a Magistrate")],
  limitation="No limitation.",
  pre=["Identify the specific misuse: tampering, threats to witnesses, violation of conditions, flight risk, or repeat offending.",
       "Distinguish cancellation (misuse after bail) from an appeal against an illegal grant of bail."],
  facts=[F("case_ref", "Crime / Case No."), F("bail_order", "Bail order — court, date and conditions", "", "textarea"),
         F("violations", "Violations or supervening circumstances", "Dates and evidence", "textarea")],
  outline=["The case and the bail order — court, date and conditions", "The conduct after bail that amounts to misuse",
           "Evidence of the misuse — dates, complaints, documents"],
  grounds=["The accused has violated the conditions of bail: [specify condition and violation].",
           "The accused has threatened or attempted to influence witnesses / tampered with evidence: [particulars].",
           "There has been a supervening circumstance that makes continuation of bail unjustified: [particulars]."],
  prayers=["Cancel the bail granted to the respondent by order dated {{bail_order}} in {{case_ref}} and direct the respondent to be taken into custody."],
  annex=["Copy of the bail order", "Evidence of violation (complaints, messages, call records, witness statements)"],
  cautions=["Courts cancel bail sparingly — give concrete, dated particulars, not general allegations."],
  keywords="cancel bail cancellation misuse of bail witness tampering violate conditions")

D("quash-fir-528", "criminal", "Quashing of FIR / Criminal Proceedings",
  "High Court petition to quash an FIR or proceedings under its inherent powers.",
  doc="Petition under Section 528 of the Bharatiya Nagarik Suraksha Sanhita, 2023 for Quashing of FIR / Proceedings",
  forum="High Court", parties="petitioner",
  statutes=[S("Section 528, BNSS 2023", "Saving of the inherent powers of the High Court (earlier s.482 CrPC)"),
            S("Article 226, Constitution of India", "Writ jurisdiction (alternative or additional)")],
  limitation="No limitation, but delay and laches are relevant.",
  pre=["Identify the ground for quashing: no offence on the face of the FIR, civil dispute given a criminal colour, abuse of process, or a genuine compromise in a compoundable / personal-in-nature matter.",
       "If quashing is sought on compromise, get the settlement deed and complainant's affidavit."],
  facts=[F("fir_no", "FIR / Case No."), F("ps", "Police Station / Court"), F("offences", "Offences invoked"),
         F("stage", "Stage of the case", "FIR only / chargesheet filed / cognizance taken / trial", "text"),
         F("ground", "Principal ground for quashing", "", "textarea")],
  outline=["The FIR / complaint and its allegations in brief", "Stage of investigation or trial",
           "Why the allegations, taken at face value, disclose no offence (or why proceedings are an abuse of process)",
           "Any settlement between the parties"],
  grounds=["Even if the allegations in the FIR are taken at face value and accepted in their entirety, they do not prima facie constitute the offence(s) alleged.",
           "The dispute is essentially civil in nature and the criminal proceedings are an abuse of the process of law: [particulars].",
           "The FIR is manifestly malicious and instituted with an ulterior motive for wreaking vengeance: [particulars]. [Delete if not applicable.]",
           "The parties have settled the dispute [settlement deed dated ___]; continuing the proceedings would serve no useful purpose. [Delete if not applicable.]"],
  prayers=["Quash FIR / Crime No. {{fir_no}} registered at {{ps}} and all consequential proceedings.",
           "Pending disposal, stay further proceedings / investigation and restrain coercive steps against the petitioner."],
  annex=["Copy of the FIR / complaint", "Chargesheet / order taking cognizance, if any", "Settlement deed and affidavits, if any"],
  cautions=["Quashing is exceptional; the court will not hold a mini-trial — plead only what is apparent on the face of the record."],
  keywords="quash fir 482 528 inherent powers high court abuse of process false case criminal proceedings")

D("fir-direction-175-3", "criminal", "Application for direction to register FIR (Magistrate)",
  "Application to the Magistrate to direct investigation where police refuse to register an FIR.",
  doc="Application under Section 175(3) of the Bharatiya Nagarik Suraksha Sanhita, 2023 for Registration of FIR and Investigation",
  forum="Court of the Magistrate", parties="applicant",
  statutes=[S("Section 175(3), BNSS 2023", "Magistrate's power to order investigation (earlier s.156(3) CrPC); the application must be supported by an affidavit"),
            S("Section 173, BNSS 2023", "Information in cognizable cases / FIR (earlier s.154 CrPC); on refusal, the substance may be sent to the Superintendent of Police")],
  limitation="No limitation.",
  pre=["Show that the police were approached first and refused, and that the substance of the information was sent to the Superintendent of Police.",
       "Prepare the supporting affidavit; the application is expected to disclose the steps taken so far."],
  facts=[F("ps", "Police Station approached"), F("date_first", "Date of first approach to police", "", "date"),
         F("sp_date", "Date the matter was sent to the Superintendent of Police", "", "date"),
         F("offences", "Offences disclosed", "", "text"), F("incident", "Incident and date", "", "textarea")],
  outline=["The incident and the offence(s) it discloses", "Approach to the police station and refusal",
           "Approach to the Superintendent of Police", "Why investigation by police is necessary"],
  grounds=["The information discloses a cognizable offence and the police were bound to register an FIR.",
           "The applicant approached the Station House Officer on [date] and the Superintendent of Police on [date], without result.",
           "Police investigation is necessary because [evidence is within the control of the accused / requires technical or forensic investigation]."],
  prayers=["Direct the SHO, {{ps}}, to register an FIR on the applicant's information and investigate under Section 175(3) BNSS."],
  annex=["Copy of written complaint to the police and postal / acknowledgement proof", "Copy of representation to the Superintendent of Police", "Supporting affidavit"],
  cautions=["Ensure the affidavit and prior approach to the SP are in place; courts routinely reject applications without them."],
  keywords="fir refuse register police complaint 156(3) 175(3) magistrate direction investigation")

D("complaint-private-223", "criminal", "Private Criminal Complaint (Magistrate)",
  "Complaint to the Magistrate for taking cognizance of an offence.",
  doc="Complaint under Section 223 of the Bharatiya Nagarik Suraksha Sanhita, 2023",
  forum="Court of the Magistrate", parties="complainant",
  statutes=[S("Section 223, BNSS 2023", "Examination of the complainant and cognizance on complaint (earlier s.200 CrPC); the accused is to be given an opportunity of being heard before cognizance")],
  limitation="Check the limitation provisions of the BNSS (earlier CrPC ss.467-473) for the offence — the period depends on the punishment.",
  pre=["Identify the offence and confirm it can be taken up on a private complaint (some require police report or sanction)."],
  facts=[F("offences", "Offences complained of (BNS sections)"), F("incident_date", "Date and place of offence", "", "text"),
         F("witnesses", "Witnesses to be examined", "", "textarea")],
  outline=["The parties and their relationship", "The offence — date, place, manner", "Evidence and witnesses", "Steps taken before approaching the Court"],
  grounds=["The facts stated disclose the commission of [offence] punishable under [BNS section].",
           "The Court has territorial jurisdiction because [the offence was committed / consequences ensued] within its limits."],
  prayers=["Take cognizance of the offence(s), issue process against the accused and try and punish the accused in accordance with law."],
  annex=["Documents relied on", "List of witnesses", "Affidavit of the complainant"],
  cautions=["The Court examines the complainant on oath before issuing process — be ready with the documents and witnesses."],
  verification="verification", keywords="private complaint magistrate complaint case cognizance 200 223 process")

D("complaint-138-ni", "criminal", "Cheque Dishonour Complaint — Section 138 NI Act",
  "Criminal complaint for dishonour of a cheque for insufficiency of funds or similar reasons.",
  doc="Complaint under Section 138 read with Section 142 of the Negotiable Instruments Act, 1881",
  forum="Court of the Judicial Magistrate First Class / Metropolitan Magistrate", parties="complainant",
  statutes=[S("Section 138, Negotiable Instruments Act 1881", "Dishonour of cheque: cheque presented within validity; demand notice within 30 days of receiving the bank's information of dishonour; drawer has 15 days from receipt of notice to pay"),
            S("Section 142, Negotiable Instruments Act 1881", "Complaint within one month of the date on which the cause of action arises (after the 15-day period); territorial jurisdiction by reference to the payee's bank branch where the cheque was delivered for collection"),
            S("Sections 143A and 148, Negotiable Instruments Act 1881", "Interim compensation up to 20% of the cheque amount; appellate deposit of at least 20% of the fine or compensation")],
  limitation="Complaint within one month from the date the cause of action arises, i.e. after expiry of the 15-day period given to the drawer (s.142(1)(b)); delay can be condoned on sufficient cause.",
  pre=["Cheque presented within its validity (three months from the date on it) and dishonour memo received.",
       "Demand notice sent within 30 days of receiving the dishonour information; drawer's 15 days must expire before filing.",
       "Prepare the affidavit in lieu of evidence and the documentary proof of the debt."],
  facts=[F("cheque_no", "Cheque No."), F("cheque_date", "Cheque date", "", "date"), F("cheque_amount", "Cheque amount (Rs.)"),
         F("drawee_bank", "Drawee bank and branch"), F("payee_bank", "Complainant's bank and branch (where presented)"),
         F("dishonour_date", "Date of dishonour memo", "", "date"), F("dishonour_reason", "Reason for dishonour"),
         F("notice_date", "Date of demand notice", "", "date"), F("notice_received", "Date notice was served / deemed served", "", "date"),
         F("debt_nature", "Nature of the legally enforceable debt or liability", "", "textarea")],
  outline=["The parties and the underlying transaction / legally enforceable debt", "Issue of the cheque and its presentation",
           "Dishonour and the bank's memo", "Statutory demand notice and its service", "Failure to pay within 15 days; cause of action; filing within one month"],
  grounds=["The cheque was issued in discharge, wholly or in part, of a legally enforceable debt or liability.",
           "The cheque was presented within its period of validity and dishonoured; the demand notice was issued within 30 days of information of dishonour.",
           "The accused failed to make payment within 15 days of receipt of the notice, and this complaint is filed within one month thereafter.",
           "The Court has territorial jurisdiction under Section 142(2) because [the cheque was presented for collection at the complainant's bank branch at ___]."],
  prayers=["Take cognizance, issue summons to the accused, and convict and sentence the accused under Section 138 of the Negotiable Instruments Act, 1881.",
           "Award compensation to the complainant up to twice the cheque amount and interim compensation under Section 143A.",
           "Award costs of the complaint."],
  annex=["Original cheque and bank's return memo", "Copy of demand notice with postal receipt / tracking proof", "Proof of service or the reply, if any",
         "Documents evidencing the debt (invoice, agreement, ledger, loan record)", "Affidavit in lieu of evidence"],
  cautions=["Time limits are strictly enforced — compute each period with actual dates before filing.",
            "The demand notice must state the exact cheque amount; a notice demanding more or less can be challenged."],
  verification="verification", keywords="cheque bounce dishonour 138 negotiable instruments insufficient funds check")

D("complaint-defamation-356", "criminal", "Criminal Defamation Complaint",
  "Private complaint for defamation under s.356 BNS.",
  doc="Complaint under Section 223 BNSS for the offence of Defamation under Section 356 of the Bharatiya Nyaya Sanhita, 2023",
  forum="Court of the Magistrate", parties="complainant",
  statutes=[S("Section 356, BNS 2023", "Defamation (earlier ss.499-500 IPC)"),
            S("Section 223, BNSS 2023", "Complaint and cognizance (earlier s.200 CrPC)")],
  limitation="Check the limitation period for the offence under the BNSS limitation provisions (depends on the punishment).",
  pre=["Preserve the defamatory material (screenshots, publication copies, URLs, witnesses who saw or heard it).",
       "Consider whether a prior legal notice and demand for retraction is useful."],
  facts=[F("statement", "The defamatory statement", "Exact words, medium, date", "textarea"),
         F("publication", "Where and how it was published / communicated", "", "textarea"),
         F("harm", "Harm to reputation", "Who saw it; consequences", "textarea")],
  outline=["The complainant and standing in society", "The imputation — words, medium and date", "Publication to third parties", "Resulting harm to reputation"],
  grounds=["The statement imputes [particulars] concerning the complainant, made with the intention of, or knowing or having reason to believe, that it would harm the complainant's reputation.",
           "The imputation was published to third persons: [particulars].",
           "None of the exceptions to defamation applies: [explain briefly]."],
  prayers=["Take cognizance, issue process and punish the accused under Section 356 BNS."],
  annex=["Copy of / evidence of the defamatory publication", "Proof of publication and witnesses", "Legal notice and reply, if any"],
  cautions=["Truth for the public good and good-faith statements are recognised exceptions — anticipate them."],
  verification="verification", keywords="defamation criminal 499 500 356 reputation libel slander")

# ═════════════════════════════════════════════════════════════════════
#  2. FAMILY & MATRIMONIAL
# ═════════════════════════════════════════════════════════════════════
MARRIAGE_FACTS = [
    F("marriage_date", "Date of marriage", "", "date"),
    F("marriage_place", "Place and form of marriage", "Rites / registration details", "text"),
    F("separation_date", "Date since when the parties live separately", "", "date"),
    F("children", "Children of the marriage (name, age, with whom residing)", "Write 'None' if none", "textarea"),
    F("last_residence", "Place where the parties last resided together", "", "text"),
]
FAMILY_ANNEX = ["Marriage certificate / wedding card / photographs", "Identity and address proof of the parties",
                "Birth certificate(s) of the child(ren), if any"]

D("divorce-mutual-hma", "family", "Divorce by Mutual Consent — Hindu Marriage Act",
  "Joint petition under s.13B HMA (first motion).",
  doc="Joint Petition for Divorce by Mutual Consent under Section 13B(1) of the Hindu Marriage Act, 1955",
  forum="Family Court / District Court", parties="petitioner",
  statutes=[S("Section 13B, Hindu Marriage Act 1955", "Divorce by mutual consent: parties living separately for one year or more, unable to live together, agreed the marriage should be dissolved; second motion not earlier than six months and not later than eighteen months after the first"),
            S("Section 14, Hindu Marriage Act 1955", "No petition within one year of marriage without leave of the Court"),
            S("Section 19, Hindu Marriage Act 1955", "Forum: where the marriage was solemnised, the parties last resided together, or the respondent / (for a wife) the petitioner resides")],
  limitation="No limitation; but the parties must have lived separately for at least one year before the petition.",
  pre=["Settle alimony, streedhan, custody and visitation terms in a written settlement before filing.",
       "Check the one-year separation and one-year-of-marriage conditions.",
       "Both spouses must sign the petition and appear for the motions."],
  facts=MARRIAGE_FACTS + [F("settlement", "Settlement terms (alimony / streedhan / custody / property)", "", "textarea")],
  outline=["The parties and the marriage", "Children, if any", "Living separately for one year or more and inability to live together",
           "Mutual agreement that the marriage be dissolved", "Terms of settlement — maintenance, streedhan, custody, property"],
  grounds=["The parties have been living separately since [date], i.e. for one year or more immediately preceding the presentation of this petition.",
           "They have not been able to live together and have mutually agreed that the marriage be dissolved.",
           "The consent of both parties is free, without force, fraud or undue influence.",
           "The settlement terms in Annexure [__] resolve maintenance, streedhan, custody and all claims between the parties."],
  prayers=["Pass a decree of divorce by mutual consent dissolving the marriage solemnised on {{marriage_date}} at {{marriage_place}}.",
           "Direct that the settlement terms be incorporated in and form part of the decree."],
  annex=FAMILY_ANNEX + ["Settlement agreement / memorandum of understanding", "Proof of separate residence"],
  cautions=["The six-month interval in s.13B(2) is not automatic to waive: the Supreme Court (Shilpa Sailesh v Varun Sreenivasan, 2023) allows waiver under Article 142 in irretrievable-breakdown cases, and lower courts follow the Amardeep Singh v Harveen Kaur (2017) guidelines for waiver on application — check what the Family Court in your district accepts.",
            "If the parties are not Hindus, this is the wrong statute — see the SMA, Christian, Parsi and Muslim entries."],
  verification="verification", keywords="divorce mutual consent 13B hindu marriage act talaq separation husband wife")

D("divorce-contested-hma", "family", "Divorce — Contested (Hindu Marriage Act)",
  "Petition for divorce on a fault ground under s.13 HMA.",
  doc="Petition for Dissolution of Marriage by a Decree of Divorce under Section 13(1) of the Hindu Marriage Act, 1955",
  forum="Family Court / District Court", parties="petitioner",
  statutes=[S("Section 13(1), Hindu Marriage Act 1955", "Grounds: adultery, cruelty, desertion for at least two years, conversion, unsoundness of mind, virulent and incurable venereal disease, renunciation of the world, presumption of death (seven years)"),
            S("Section 13(2), Hindu Marriage Act 1955", "Additional grounds available to the wife"),
            S("Section 14, Hindu Marriage Act 1955", "No petition within one year of marriage without leave"),
            S("Section 19, Hindu Marriage Act 1955", "Forum")],
  limitation="No general limitation; desertion requires two years' continuous desertion immediately before the petition.",
  pre=["Pick the specific ground(s) under s.13(1) and gather evidence for each — courts decide on the pleaded ground.",
       "Consider interim maintenance (s.24) and custody applications at the same time."],
  facts=MARRIAGE_FACTS + [F("ground", "Ground(s) relied on", "e.g. cruelty s.13(1)(ia); desertion s.13(1)(ib)", "text"),
                          F("incidents", "Principal incidents (date, place, what happened)", "", "textarea")],
  outline=["The parties and the marriage", "Children, if any", "The specific ground(s) under s.13 relied on", "Chronology of incidents with dates and evidence",
           "Attempts at reconciliation, if any", "Maintenance and custody position"],
  grounds=["The respondent has treated the petitioner with cruelty within the meaning of Section 13(1)(ia): [particulars, dates].",
           "The respondent has deserted the petitioner for a continuous period of not less than two years immediately preceding this petition: [particulars]. [Delete if not relied on.]",
           "There is no collusion between the parties, and there has been no unnecessary or improper delay in presenting this petition.",
           "No ground exists on which relief should be refused under Section 23."],
  prayers=["Dissolve the marriage solemnised on {{marriage_date}} at {{marriage_place}} by a decree of divorce.",
           "Grant such ancillary relief regarding custody, maintenance and property as the Court deems fit.",
           "Award costs."],
  annex=FAMILY_ANNEX + ["Evidence of the incidents relied on (messages, medical records, complaints, witnesses)"],
  cautions=["'Irretrievable breakdown' is not by itself a statutory ground under the HMA; it is a factor the Supreme Court can apply under Article 142 (Shilpa Sailesh, 2023).",
            "Plead facts, not conclusions: vague allegations of cruelty fail."],
  verification="verification", keywords="divorce contested cruelty desertion adultery 13 hindu marriage act husband wife")

D("rcr-hma-9", "family", "Restitution of Conjugal Rights",
  "Petition under s.9 HMA where a spouse has withdrawn from the society of the other without reasonable excuse.",
  doc="Petition for Restitution of Conjugal Rights under Section 9 of the Hindu Marriage Act, 1955",
  forum="Family Court / District Court", parties="petitioner",
  statutes=[S("Section 9, Hindu Marriage Act 1955", "Restitution of conjugal rights; the burden of proving reasonable excuse is on the person who has withdrawn")],
  limitation="No limitation.",
  pre=["Show a genuine attempt at reconciliation — courts look at bona fides.", "Be aware of any pending counter-proceedings."],
  facts=MARRIAGE_FACTS + [F("withdrawal", "When and how the respondent withdrew from the petitioner's society", "", "textarea")],
  outline=["The marriage and cohabitation", "Withdrawal by the respondent — when and how", "Efforts to bring the respondent back", "Absence of reasonable excuse"],
  grounds=["The respondent has, without reasonable excuse, withdrawn from the society of the petitioner.",
           "The petitioner is ready and willing to cohabit with the respondent and has made sincere efforts to restore cohabitation.",
           "No legal ground exists for refusing the relief."],
  prayers=["Pass a decree for restitution of conjugal rights directing the respondent to resume cohabitation with the petitioner."],
  annex=FAMILY_ANNEX + ["Correspondence showing attempts at reconciliation"],
  cautions=["RCR decrees are sometimes used as a stepping stone to divorce; consider whether that is the real objective."],
  verification="verification", keywords="restitution conjugal rights section 9 husband wife return cohabit")

D("judicial-separation-hma-10", "family", "Judicial Separation",
  "Petition for judicial separation on any ground on which divorce could be sought.",
  doc="Petition for Judicial Separation under Section 10 of the Hindu Marriage Act, 1955",
  forum="Family Court / District Court", parties="petitioner",
  statutes=[S("Section 10, Hindu Marriage Act 1955", "Judicial separation on any ground on which divorce may be sought under s.13(1) (and s.13(2) for a wife)")],
  limitation="No limitation.",
  pre=["Choose the ground(s) as for a contested divorce."],
  facts=MARRIAGE_FACTS + [F("ground", "Ground(s) relied on"), F("incidents", "Principal incidents", "", "textarea")],
  outline=["The parties and marriage", "Ground(s) relied on", "Chronology of incidents", "Ancillary reliefs"],
  grounds=["The respondent has [cruelty / desertion / other ground under Section 13]: [particulars].",
           "There is no collusion and no bar to the relief."],
  prayers=["Grant a decree of judicial separation between the parties.", "Grant ancillary relief regarding custody and maintenance."],
  annex=FAMILY_ANNEX, cautions=["Judicial separation does not dissolve the marriage."],
  verification="verification", keywords="judicial separation section 10 hindu marriage act")

D("nullity-hma-11-12", "family", "Nullity / Annulment of Marriage",
  "Petition to declare a marriage void (s.11) or annul it as voidable (s.12).",
  doc="Petition for Declaration of Nullity / Annulment of Marriage under Sections 11 and 12 of the Hindu Marriage Act, 1955",
  forum="Family Court / District Court", parties="petitioner",
  statutes=[S("Section 11, Hindu Marriage Act 1955", "Void marriages (bigamy, prohibited degrees, sapinda relationship)"),
            S("Section 12, Hindu Marriage Act 1955", "Voidable marriages (non-consummation due to impotence, unsoundness of mind, consent by force or fraud, pregnancy by another at the time of marriage)")],
  limitation="Time limits apply to some s.12 grounds (e.g. petitions based on consent obtained by force or fraud must be filed within one year of discovery) — check the specific clause.",
  pre=["Identify whether the marriage is void or voidable — the ground and relief differ."],
  facts=MARRIAGE_FACTS + [F("ground", "Ground for nullity / annulment", "", "textarea")],
  outline=["The parties and the ceremony", "The ground and the supporting facts", "Discovery of the ground and date"],
  grounds=["The marriage is void / voidable under [s.11(i)/(ii)/(iii) or s.12(1)(a)-(d)]: [particulars].",
           "The petition is filed within the time allowed and without condonation of the defect by the petitioner. [Delete if not applicable.]"],
  prayers=["Declare the marriage between the parties null and void / annul it by a decree of nullity."],
  annex=FAMILY_ANNEX + ["Medical or documentary evidence supporting the ground"],
  cautions=["Section 12 grounds are narrow and fact-specific — check the limitation for the exact clause invoked."],
  verification="verification", keywords="nullity annulment void voidable marriage section 11 12 bigamy impotence")

D("maintenance-pendente-lite-24", "family", "Interim Maintenance & Litigation Expenses — HMA s.24",
  "Application for maintenance pendente lite and expenses of the proceeding.",
  doc="Application for Maintenance Pendente Lite and Expenses of Proceedings under Section 24 of the Hindu Marriage Act, 1955",
  forum="Court hearing the main matrimonial petition", parties="applicant",
  statutes=[S("Section 24, Hindu Marriage Act 1955", "Maintenance pendente lite and expenses of proceedings for the spouse without independent income sufficient for support")],
  limitation="Filed while the main petition is pending.",
  pre=["File the affidavit of assets, income and liabilities in the format the Supreme Court prescribed in Rajnesh v Neha (2020) — courts now require it in maintenance matters."],
  facts=[F("main_case", "Main petition — case number and forum"), F("applicant_income", "Applicant's income and sources", "", "textarea"),
         F("respondent_income", "Respondent's known income and assets", "", "textarea"), F("expenses", "Monthly expenses claimed", "", "textarea"),
         F("amount", "Interim maintenance sought (Rs. per month)")],
  outline=["The main petition and its status", "The applicant's lack of independent income sufficient for support",
           "The respondent's income and assets", "Monthly needs including children and rent, and litigation expenses"],
  grounds=["The applicant has no independent income sufficient for support and for the necessary expenses of the proceeding.",
           "The respondent has the means to pay: [income, business, assets].",
           "The amount claimed is reasonable having regard to the parties' standard of living."],
  prayers=["Direct the respondent to pay Rs. {{amount}} per month as maintenance pendente lite from the date of the application.",
           "Direct payment of litigation expenses of Rs. [amount]."],
  annex=["Affidavit of assets and liabilities (Rajnesh v Neha format)", "Income proof of both parties, if available", "Bank statements"],
  cautions=["Incomplete or evasive disclosure of assets can lead to adverse inference — disclose fully."],
  verification="affidavit", keywords="interim maintenance pendente lite section 24 hindu marriage act alimony litigation expenses")

D("alimony-permanent-25", "family", "Permanent Alimony & Maintenance — HMA s.25",
  "Application for permanent alimony at or after the decree.",
  doc="Application for Permanent Alimony and Maintenance under Section 25 of the Hindu Marriage Act, 1955",
  forum="Court that passed the decree / hearing the petition", parties="applicant",
  statutes=[S("Section 25, Hindu Marriage Act 1955", "Permanent alimony and maintenance, having regard to the parties' income and property, conduct and other circumstances")],
  limitation="On or after the decree; may be modified on change of circumstances.",
  pre=["Use the Rajnesh v Neha (2020) disclosure affidavit; prepare a one-time versus monthly proposal."],
  facts=[F("decree_date", "Date of decree / status of main petition", "", "text"), F("amount", "Alimony sought (lump sum / monthly)"),
         F("assets", "Assets and income of both parties", "", "textarea")],
  outline=["The decree and the marriage", "Financial position of both parties", "Standard of living during the marriage", "Amount claimed and basis"],
  grounds=["The applicant has no independent means sufficient for support; the respondent has the means to pay.",
           "The amount sought is reasonable having regard to the length of the marriage, the parties' standard of living and needs."],
  prayers=["Direct the respondent to pay permanent alimony of Rs. {{amount}} (lump sum / monthly) to the applicant."],
  annex=["Affidavit of assets and liabilities", "Income and asset documents"],
  cautions=["Conduct of the parties is a statutory factor — anticipate it."],
  verification="affidavit", keywords="permanent alimony section 25 maintenance divorce settlement")

D("maintenance-bnss-144", "family", "Maintenance — Wife, Children, Parents (BNSS s.144)",
  "Application for monthly maintenance (including interim) by wife, children or parents.",
  doc="Application for Maintenance under Section 144 of the Bharatiya Nagarik Suraksha Sanhita, 2023",
  forum="Magistrate of the First Class / Family Court", parties="applicant",
  statutes=[S("Section 144, BNSS 2023", "Order for maintenance of wives, children and parents (earlier s.125 CrPC): monthly allowance where a person with sufficient means neglects or refuses to maintain; interim maintenance available")],
  limitation="No limitation.",
  pre=["Use the Supreme Court's Rajnesh v Neha (2020) affidavit of assets and liabilities.", "Collect proof of neglect or refusal and of the respondent's means."],
  facts=[F("relationship", "Relationship to the respondent (wife / minor child / adult child with disability / parent)"),
         F("neglect", "Neglect or refusal — since when", "", "textarea"), F("respondent_means", "Respondent's income and means", "", "textarea"),
         F("amount", "Monthly maintenance sought (Rs.)"), F("interim", "Interim maintenance sought (Rs.)")],
  outline=["The relationship and the applicant's circumstances", "Neglect or refusal to maintain", "The respondent's sufficient means", "The applicant's needs and the amount claimed"],
  grounds=["The applicant is unable to maintain [herself/himself] and the respondent, having sufficient means, has neglected or refused to maintain the applicant.",
           "The amount claimed is reasonable in light of the respondent's means and the applicant's needs."],
  prayers=["Direct the respondent to pay monthly maintenance of Rs. {{amount}} from the date of the application.",
           "Grant interim maintenance of Rs. {{interim}} per month during the pendency of the application."],
  annex=["Affidavit of assets and liabilities", "Proof of relationship", "Proof of the respondent's income / means"],
  cautions=["A wife living in adultery or refusing without sufficient reason to live with her husband is disqualified — be ready with the facts on separation."],
  verification="affidavit", keywords="maintenance 125 144 wife child parents monthly allowance interim crpc bnss")

D("dv-application-12", "family", "Domestic Violence — Application for Reliefs",
  "Application to the Magistrate under s.12 of the Protection of Women from Domestic Violence Act.",
  doc="Application under Section 12 of the Protection of Women from Domestic Violence Act, 2005",
  forum="Court of the Judicial Magistrate First Class / Metropolitan Magistrate", parties="applicant",
  statutes=[S("Section 12, Protection of Women from Domestic Violence Act 2005", "Application to the Magistrate for reliefs"),
            S("Sections 18 to 22, Protection of Women from Domestic Violence Act 2005", "Protection order (18), residence order (19), monetary relief (20), custody orders (21), compensation (22)")],
  limitation="No limitation for continuing violence.",
  pre=["Contact the Protection Officer / obtain a Domestic Incident Report where possible.", "Identify the shared household and relationship (domestic relationship)."],
  facts=[F("relationship", "Domestic relationship with the respondent(s)"), F("household", "Shared household — address", "", "textarea"),
         F("incidents", "Incidents of domestic violence (dates and details)", "", "textarea"),
         F("reliefs", "Reliefs sought", "Protection / residence / monetary / custody / compensation", "textarea")],
  outline=["The parties and the domestic relationship", "The shared household", "Incidents of domestic violence — physical, emotional, economic", "Complaints or police reports already made", "Reliefs required"],
  grounds=["The applicant is an aggrieved person and the respondent(s) are in a domestic relationship with her.",
           "The respondent(s) have committed acts of domestic violence as defined in Section 3: [particulars].",
           "The applicant needs protection from further violence, a right of residence in the shared household, and monetary relief."],
  prayers=["Pass a protection order under Section 18 prohibiting the respondent(s) from committing further acts of domestic violence.",
           "Pass a residence order under Section 19.", "Grant monetary relief under Section 20 and custody under Section 21, as sought.",
           "Grant compensation under Section 22."],
  annex=["Domestic Incident Report, if any", "Medical records, photographs, messages", "Complaints / FIR, if any", "Proof of shared household"],
  cautions=["Sensitive material: keep the file secure and consider the applicant's safety in service of notices."],
  verification="affidavit", keywords="domestic violence dv act protection residence order aggrieved woman husband in-laws")

D("cruelty-complaint-bns-85", "family", "Complaint — Cruelty by Husband or Relatives / Dowry",
  "Complaint to police (or Magistrate) for cruelty and dowry harassment.",
  doc="Complaint under Section 85 of the Bharatiya Nyaya Sanhita, 2023 and the Dowry Prohibition Act, 1961",
  forum="Station House Officer / Court of the Magistrate", parties="complainant",
  statutes=[S("Section 85, BNS 2023", "Husband or relative of husband subjecting a woman to cruelty (earlier s.498A IPC)"),
            S("Sections 3 and 4, Dowry Prohibition Act 1961", "Penalty for giving or taking dowry; demanding dowry"),
            S("Section 173, BNSS 2023", "FIR / information in cognizable cases")],
  limitation="Check limitation for the offence under the BNSS; continuing cruelty is treated as a continuing offence.",
  pre=["Gather dated particulars and evidence of each demand and act of cruelty.", "The Supreme Court's guidelines on arrest in matrimonial cases (Arnesh Kumar, 2014) are now reflected in the BNSS notice-of-appearance provision — the police may issue a notice instead of arresting."],
  facts=[F("marriage_date", "Date of marriage", "", "date"), F("demands", "Dowry demands — what, when, by whom", "", "textarea"),
         F("incidents", "Acts of cruelty — date, place, persons involved", "", "textarea"), F("streedhan", "Streedhan / articles retained by the accused", "", "textarea")],
  outline=["The marriage and the family", "Dowry demands and harassment — dated particulars", "Acts of physical or mental cruelty", "Streedhan and articles retained", "Complaints made earlier"],
  grounds=["The accused subjected the complainant to cruelty within the meaning of Section 86 BNS: [conduct likely to drive her to suicide / harassment to coerce unlawful demands].",
           "The accused demanded dowry in violation of the Dowry Prohibition Act, 1961.",
           "A cognizable offence is disclosed and the police are bound to register an FIR."],
  prayers=["Register an FIR under Section 85 BNS and the Dowry Prohibition Act and investigate.", "Recover the streedhan and articles belonging to the complainant."],
  annex=["Marriage proof", "Messages, recordings (with certificate under s.63 BSA), medical records", "Earlier complaints or panchayat / counselling records"],
  cautions=["Courts scrutinise vague, omnibus allegations against relatives — give specific dates and roles for each accused.",
            "Electronic evidence needs the certificate required under the Bharatiya Sakshya Adhiniyam (s.63)."],
  verification="verification", keywords="498a cruelty dowry harassment husband in-laws complaint 85 bns streedhan")

D("custody-guardianship", "family", "Child Custody / Guardianship",
  "Petition for custody or appointment as guardian of a minor.",
  doc="Petition for Custody and Guardianship of the Minor under the Guardians and Wards Act, 1890",
  forum="Family Court / District Court", parties="petitioner",
  statutes=[S("Sections 7 and 25, Guardians and Wards Act 1890", "Appointment of guardian; custody orders"),
            S("Section 17, Guardians and Wards Act 1890", "Welfare of the minor is the paramount consideration"),
            S("Sections 6 and 13, Hindu Minority and Guardianship Act 1956", "Natural guardians; welfare of the minor")],
  limitation="No limitation.",
  pre=["Prepare a welfare-based case: schooling, stability, health, the child's preference (if mature)."],
  facts=[F("child_details", "Child(ren) — name, date of birth, current residence and school", "", "textarea"),
         F("current_custody", "Present custody arrangement", "", "textarea"),
         F("welfare", "Why custody with the petitioner serves the child's welfare", "", "textarea"),
         F("visitation", "Visitation proposed for the other parent", "", "textarea")],
  outline=["The minor and the parties", "Present custody and how it arose", "Why the petitioner's custody serves the welfare of the child", "Proposed visitation / access"],
  grounds=["The welfare of the minor is the paramount consideration and is best served by custody with the petitioner: [stability, care, education, health].",
           "The respondent's conduct / circumstances make custody with the respondent contrary to the child's welfare: [particulars, only if relied on].",
           "The petitioner proposes reasonable visitation for the respondent to preserve the child's relationship with both parents."],
  prayers=["Appoint the petitioner as guardian / grant custody of the minor to the petitioner.", "Grant visitation rights to the respondent on terms the Court deems fit."],
  annex=["Birth certificate of the child", "School and medical records", "Proof of income and residence of the petitioner"],
  cautions=["Interim custody / visitation applications are often the practical battleground — consider filing one with the petition."],
  verification="verification", keywords="custody guardianship child minor visitation welfare guardians wards act")

D("divorce-sma-27-28", "family", "Divorce — Special Marriage Act",
  "Divorce petition (contested or mutual) where the marriage is under the SMA.",
  doc="Petition for Divorce under Sections 27 / 28 of the Special Marriage Act, 1954",
  forum="District Court / Family Court", parties="petitioner",
  statutes=[S("Section 27, Special Marriage Act 1954", "Divorce on fault grounds"),
            S("Section 28, Special Marriage Act 1954", "Divorce by mutual consent (living separately for one year or more)")],
  limitation="No general limitation.",
  pre=["Confirm the marriage was solemnised or registered under the SMA."],
  facts=MARRIAGE_FACTS + [F("ground", "Ground relied on (s.27 ground / s.28 mutual consent)")],
  outline=["The parties and the marriage under the SMA", "The ground under s.27 or the mutual consent under s.28", "Chronology and evidence", "Ancillary reliefs"],
  grounds=["The ground under [Section 27(1)(__) / Section 28] is made out: [particulars].", "There is no collusion and no bar to the relief."],
  prayers=["Pass a decree of divorce dissolving the marriage solemnised on {{marriage_date}} under the Special Marriage Act, 1954."],
  annex=FAMILY_ANNEX + ["Marriage certificate under the SMA"], cautions=[COMMON_CAUTION_VERIFY],
  verification="verification", keywords="special marriage act divorce inter-faith court marriage section 27 28")

D("divorce-christian-10", "family", "Divorce — Christian (Indian Divorce Act)",
  "Divorce petition by Christian spouses.",
  doc="Petition for Dissolution of Marriage under Section 10 / 10A of the Indian Divorce Act, 1869",
  forum="District Court", parties="petitioner",
  statutes=[S("Section 10, Indian Divorce Act 1869", "Grounds for dissolution (as amended in 2001)"),
            S("Section 10A, Indian Divorce Act 1869", "Divorce by mutual consent (living separately for two years or more)")],
  limitation="No general limitation.",
  pre=["Confirm both parties are Christians for the purposes of the Act."],
  facts=MARRIAGE_FACTS + [F("ground", "Ground relied on")],
  outline=["The parties and the marriage", "Ground(s) or mutual consent", "Chronology and evidence", "Ancillary reliefs"],
  grounds=["The ground under [Section 10(1)(__) / Section 10A] is made out: [particulars].", "There is no collusion and no bar to the relief."],
  prayers=["Pass a decree of dissolution of the marriage solemnised on {{marriage_date}}."],
  annex=FAMILY_ANNEX, cautions=[COMMON_CAUTION_VERIFY],
  verification="verification", keywords="christian divorce indian divorce act 1869 section 10 10A church marriage")

D("divorce-parsi-32", "family", "Divorce — Parsi (PMDA)",
  "Divorce petition under the Parsi Marriage and Divorce Act.",
  doc="Petition for Divorce under Section 32 / 32B of the Parsi Marriage and Divorce Act, 1936",
  forum="Parsi Matrimonial Court", parties="petitioner",
  statutes=[S("Section 32, Parsi Marriage and Divorce Act 1936", "Grounds for divorce"), S("Section 32B, Parsi Marriage and Divorce Act 1936", "Divorce by mutual consent")],
  limitation="No general limitation.", pre=["Confirm both parties are Parsi Zoroastrians."],
  facts=MARRIAGE_FACTS + [F("ground", "Ground relied on")],
  outline=["The parties and the marriage", "Ground(s) or mutual consent", "Chronology and evidence"],
  grounds=["The ground under [Section 32(_) / Section 32B] is made out: [particulars]."],
  prayers=["Pass a decree of divorce dissolving the marriage."], annex=FAMILY_ANNEX, cautions=[COMMON_CAUTION_VERIFY],
  verification="verification", keywords="parsi divorce pmda zoroastrian matrimonial court")

D("dissolution-muslim-marriage-1939", "family", "Dissolution of Muslim Marriage (wife's petition)",
  "Suit by a Muslim wife under the Dissolution of Muslim Marriages Act, 1939.",
  doc="Suit for Dissolution of Marriage under Section 2 of the Dissolution of Muslim Marriages Act, 1939",
  forum="Family Court / Civil Court", parties="plaintiff",
  statutes=[S("Section 2, Dissolution of Muslim Marriages Act 1939", "Grounds on which a Muslim wife may obtain a decree: husband's whereabouts unknown for four years, failure to maintain for two years, imprisonment of seven years or more, failure to perform marital obligations for three years, impotence, insanity, cruelty and others")],
  limitation="Grounds carry their own periods (e.g. four years, two years, three years) — plead the exact ground.",
  pre=["Choose the specific s.2 ground(s) and collect evidence."],
  facts=MARRIAGE_FACTS + [F("ground", "Ground relied on under s.2")],
  outline=["The parties and the marriage (nikah)", "The ground under s.2 and its duration", "Efforts at reconciliation", "Mahr and maintenance position"],
  grounds=["The ground under Section 2([_]) of the Act is made out: [particulars and duration]."],
  prayers=["Pass a decree dissolving the marriage.", "Direct return of mahr and other rights due to the plaintiff."],
  annex=FAMILY_ANNEX + ["Nikahnama"], cautions=[COMMON_CAUTION_VERIFY],
  verification="verification", keywords="muslim divorce khula dissolution 1939 wife nikah mahr")

D("muslim-women-1986-claim", "family", "Muslim Woman — Mahr / Fair Provision after Divorce",
  "Application under the Muslim Women (Protection of Rights on Divorce) Act, 1986.",
  doc="Application under Section 3 of the Muslim Women (Protection of Rights on Divorce) Act, 1986",
  forum="Magistrate of the First Class", parties="applicant",
  statutes=[S("Section 3, Muslim Women (Protection of Rights on Divorce) Act 1986", "Mahr, maintenance during iddat, a reasonable and fair provision, and return of property")],
  limitation="Check the time limit in the section for making the application after divorce.", pre=["Collect the nikahnama, proof of mahr and of the divorce."],
  facts=[F("divorce_date", "Date and manner of divorce", "", "text"), F("mahr", "Mahr agreed and paid / unpaid", "", "text"), F("claim", "Reliefs claimed", "", "textarea")],
  outline=["The marriage and divorce", "Mahr and property given", "Maintenance during iddat and provision for the future"],
  grounds=["The applicant is a divorced Muslim woman entitled to mahr, iddat maintenance and a fair and reasonable provision.",
           "The respondent has failed to pay: [particulars]."],
  prayers=["Direct payment of mahr, maintenance for the iddat period and a reasonable and fair provision.", "Direct return of the applicant's property."],
  annex=["Nikahnama", "Proof of divorce", "Proof of property given at marriage"], cautions=[COMMON_CAUTION_VERIFY],
  verification="affidavit", keywords="muslim women divorce 1986 mahr iddat fair provision shah bano")

D("senior-citizen-maintenance-2007", "family", "Maintenance of Parents / Senior Citizens",
  "Application to the Maintenance Tribunal under the 2007 Act.",
  doc="Application for Maintenance under Section 5 of the Maintenance and Welfare of Parents and Senior Citizens Act, 2007",
  forum="Maintenance Tribunal (Sub-Divisional Officer)", parties="applicant",
  statutes=[S("Section 4, Maintenance and Welfare of Parents and Senior Citizens Act 2007", "Obligation of children and relatives to maintain senior citizens"),
            S("Section 5, Maintenance and Welfare of Parents and Senior Citizens Act 2007", "Application for maintenance to the Tribunal")],
  limitation="No limitation.", pre=["Check state rules for the application form and the Tribunal designated."],
  facts=[F("relationship", "Relationship to the respondent(s)"), F("neglect", "Neglect / refusal to maintain", "", "textarea"),
         F("means", "Respondent's means", "", "textarea"), F("amount", "Monthly maintenance sought (Rs.)")],
  outline=["The applicant and the respondent(s)", "Neglect or refusal to maintain", "The respondent's means", "The applicant's needs"],
  grounds=["The applicant is a senior citizen / parent unable to maintain himself/herself from own earnings or property.",
           "The respondent(s), having sufficient means, have neglected or refused to maintain the applicant."],
  prayers=["Direct the respondent(s) to pay monthly maintenance of Rs. {{amount}} to the applicant."],
  annex=["Proof of age and relationship", "Proof of the respondent's means"], cautions=[COMMON_CAUTION_VERIFY],
  verification="affidavit", keywords="senior citizen parents maintenance tribunal 2007 old age children neglect")

# ═════════════════════════════════════════════════════════════════════
#  3. CONSUMER (Consumer Protection Act, 2019)
# ═════════════════════════════════════════════════════════════════════
CPA_JURIS = ("Pecuniary jurisdiction is measured on the value of the goods or services PAID AS CONSIDERATION: District Commission up to Rs. 50 lakh; "
             "State Commission above Rs. 50 lakh up to Rs. 2 crore; National Commission above Rs. 2 crore (Consumer Protection (Jurisdiction of the District Commission, "
             "the State Commission and the National Commission) Rules, 2021).")
CPA_LIMIT = "Two years from the date the cause of action arises (s.69); the Commission may condone delay for sufficient cause, recorded in writing."
CPA_FACTS = [F("txn_desc", "Goods / service purchased", "", "textarea"), F("txn_date", "Date of purchase / service", "", "date"),
             F("consideration", "Amount paid as consideration (Rs.)", "This decides the Commission", "text"),
             F("defect", "Defect / deficiency complained of", "", "textarea"), F("complaints_made", "Complaints made to the opposite party — dates and replies", "", "textarea"),
             F("notice_date", "Date of legal notice (if sent)", "", "date"), F("relief", "Relief sought (refund / replacement / repair / compensation)", "", "textarea")]
CPA_OUTLINE = ["The complainant is a 'consumer' — what was bought, when, and the consideration paid",
               "The defect or deficiency — what went wrong and when it was discovered",
               "Complaints made to the opposite party and their response",
               "Legal notice, if issued, and the reply",
               "Loss and harassment suffered", "Jurisdiction — pecuniary and territorial — and limitation"]
CPA_PRAYERS = ["Direct the opposite party to [refund Rs. {{consideration}} with interest / replace the goods / remove the defect / provide the service].",
               "Award compensation of Rs. [amount] for mental agony and harassment.",
               "Award costs of the complaint (Rs. [amount])."]
CPA_ANNEX = ["Invoice / bill / receipt / booking confirmation", "Warranty card / agreement / terms", "Correspondence and complaint tickets",
             "Legal notice and proof of service, if any", "Evidence of the defect (photos, job sheets, expert report)"]
CPA_STAT = [S("Section 35, Consumer Protection Act 2019", "Complaint to the District Commission; the Act's jurisdiction limits are then applied by value of consideration"),
            S("Section 34(2), Consumer Protection Act 2019", "Territorial jurisdiction — where the opposite party works for gain, or where the complainant resides or personally works for gain"),
            S("Section 39, Consumer Protection Act 2019", "Reliefs the Commission may grant")]
CPA_CAUTIONS = [CPA_JURIS + " Verify these thresholds are unchanged before filing.",
                "A legal notice is not mandatory but is good practice and useful evidence of demand.",
                "Online filing is available through the official consumer commission portal; check the current portal and fee schedule."]

D("consumer-deficiency-service", "consumer", "Consumer Complaint — Deficiency in Service",
  "Complaint against a service provider (telecom, airline, bank, hospital, builder, etc.).",
  doc="Consumer Complaint under Section 35 of the Consumer Protection Act, 2019 — Deficiency in Service",
  forum="District / State / National Consumer Disputes Redressal Commission (by value of consideration)", parties="consumer",
  statutes=CPA_STAT + [S("Section 2(11), Consumer Protection Act 2019", "'Deficiency' defined"), S("Section 2(42), Consumer Protection Act 2019", "'Service' defined")],
  limitation=CPA_LIMIT, pre=["Confirm the complainant is a 'consumer' (not buying for commercial purpose).", "Send a legal notice and keep proof."],
  facts=CPA_FACTS, outline=CPA_OUTLINE,
  grounds=["The opposite party rendered deficient service as defined in Section 2(11): [particulars].",
           "The complainant is a consumer and the services were availed for consideration.",
           "The opposite party failed to remedy the deficiency despite repeated requests.",
           "The complaint is within limitation and the Commission has pecuniary and territorial jurisdiction."],
  prayers=CPA_PRAYERS, annex=CPA_ANNEX, cautions=CPA_CAUTIONS, verification="affidavit",
  keywords="consumer complaint deficiency in service refund compensation commission cpa 2019 district forum")

D("consumer-defective-goods", "consumer", "Consumer Complaint — Defective Goods",
  "Complaint against a seller / manufacturer for defective goods.",
  doc="Consumer Complaint under Section 35 of the Consumer Protection Act, 2019 — Defective Goods",
  forum="District / State / National Consumer Disputes Redressal Commission (by value of consideration)", parties="consumer",
  statutes=CPA_STAT + [S("Section 2(10), Consumer Protection Act 2019", "'Defect' defined"), S("Chapter VI (ss.82-87), Consumer Protection Act 2019", "Product liability")],
  limitation=CPA_LIMIT, pre=["Keep the product and the purchase documents; get a technical inspection report where possible."],
  facts=CPA_FACTS + [F("product", "Product, model and serial no.")], outline=CPA_OUTLINE,
  grounds=["The goods suffer from a defect within Section 2(10): [particulars]; the defect is not attributable to the complainant.",
           "The seller / manufacturer failed to repair or replace within the warranty / reasonable time.",
           "The complaint is within limitation and the Commission has jurisdiction."],
  prayers=["Direct the opposite party to replace the goods / refund Rs. {{consideration}} with interest.", "Award compensation and costs."],
  annex=CPA_ANNEX, cautions=CPA_CAUTIONS, verification="affidavit",
  keywords="defective product goods consumer complaint replacement refund warranty manufacturer seller")

D("consumer-insurance-repudiation", "consumer", "Insurance Claim Repudiation — Consumer Complaint",
  "Complaint where an insurer wrongly repudiates or delays a claim.",
  doc="Consumer Complaint under Section 35 of the Consumer Protection Act, 2019 — Repudiation of Insurance Claim",
  forum="Consumer Commission / Insurance Ombudsman (alternative remedy)", parties="consumer",
  statutes=CPA_STAT + [S("Section 45, Insurance Act 1938", "A policy cannot be called into question on grounds of misstatement after three years from issue (subject to fraud proof)")],
  limitation=CPA_LIMIT + " If approaching the Insurance Ombudsman, the complaint must first go to the insurer and be within the period in the Insurance Ombudsman Rules, 2017 (verify).",
  pre=["Obtain the repudiation letter and the policy schedule / proposal form.", "Identify the ground of repudiation (non-disclosure, exclusion, lapse) and answer it specifically."],
  facts=[F("policy_no", "Policy No. and insurer"), F("sum_insured", "Sum insured (Rs.)"), F("claim_date", "Date of claim / loss", "", "date"),
         F("repudiation", "Date and reasons for repudiation", "", "textarea"), F("relief", "Relief sought", "", "textarea")] + CPA_FACTS[:4],
  outline=["The policy and premium paid", "The loss / claim and how it was lodged", "Repudiation and the reasons given", "Why the repudiation is wrong", "Loss and harassment"],
  grounds=["The claim falls within the policy cover; the reason for repudiation is [factually / legally] unsustainable: [specific answer].",
           "There was no material non-disclosure; alternatively, s.45 Insurance Act bars the plea after three years. [Delete if not applicable.]",
           "The repudiation is a deficiency in service and an unfair trade practice."],
  prayers=["Direct the insurer to pay Rs. {{sum_insured}} (or the claim amount) with interest.", "Award compensation and costs."],
  annex=["Policy document and proposal form", "Claim form and supporting documents", "Repudiation letter", "Correspondence with the insurer"],
  cautions=CPA_CAUTIONS, verification="affidavit", keywords="insurance claim repudiated rejected policy life health motor insurer ombudsman")

D("consumer-medical-negligence", "consumer", "Medical Negligence — Consumer Complaint",
  "Complaint for deficiency in medical services / negligence.",
  doc="Consumer Complaint under Section 35 of the Consumer Protection Act, 2019 — Medical Negligence",
  forum="Consumer Commission (by value of consideration and compensation claimed)", parties="consumer",
  statutes=CPA_STAT + [S("Section 2(42), Consumer Protection Act 2019", "'Service' — medical services rendered for consideration are covered")],
  limitation=CPA_LIMIT, pre=["Obtain complete medical records and, where possible, an independent expert opinion — negligence is difficult to prove without it."],
  facts=[F("hospital", "Hospital / doctor"), F("treatment", "Treatment / procedure and dates", "", "textarea"),
         F("negligence", "Negligent act or omission alleged", "", "textarea"), F("outcome", "Resulting injury or loss", "", "textarea")] + CPA_FACTS[2:3] + CPA_FACTS[5:],
  outline=["The patient and the treatment", "The standard of care expected", "The negligent act or omission", "Causation — resulting harm", "Medical records and expert opinion"],
  grounds=["The opposite parties failed to exercise the degree of skill and care expected of a reasonably competent practitioner: [particulars].",
           "The negligence directly caused [injury / death / additional treatment]: [particulars].",
           "The complaint is supported by [expert opinion / medical records]."],
  prayers=["Direct the opposite parties to pay compensation of Rs. [amount] for medical negligence.", "Award costs."],
  annex=["Complete medical records", "Bills and receipts", "Expert opinion, if any", "Legal notice and reply"],
  cautions=CPA_CAUTIONS + ["Courts decline liability for an unfortunate outcome absent proof of lack of due care — plead breach of the standard of care, not merely the result."],
  verification="affidavit", keywords="medical negligence doctor hospital patient death surgery treatment compensation")

D("consumer-real-estate-delay", "consumer", "Delayed Possession / Builder — Consumer Complaint",
  "Complaint by a flat buyer against a builder for delay or defects.",
  doc="Consumer Complaint under Section 35 of the Consumer Protection Act, 2019 — Delayed Possession",
  forum="Consumer Commission (by consideration paid)", parties="consumer",
  statutes=CPA_STAT,
  limitation=CPA_LIMIT + " Non-delivery of possession is generally treated as a continuing wrong — check the current case law.",
  pre=["The consumer remedy is available in addition to RERA; check strategy and avoid contradictory pleadings (Supreme Court, Imperia Structures v Anil Patni, 2020)."],
  facts=[F("project", "Project / unit"), F("agreement_date", "Date of builder-buyer agreement", "", "date"), F("promised_possession", "Promised possession date", "", "date"),
         F("amount_paid", "Total amount paid (Rs.)"), F("status", "Present status of the project", "", "textarea")] + CPA_FACTS[4:],
  outline=["The project, the unit and the agreement", "Payments made", "Promised possession date and actual position", "Requests, notices and builder's response", "Loss suffered — rent, EMI, mental agony"],
  grounds=["The builder failed to deliver possession by the promised date; this is a deficiency in service and an unfair trade practice.",
           "The complainant is entitled to refund with interest / delay compensation."],
  prayers=["Direct the opposite party to refund Rs. {{amount_paid}} with interest from the dates of payment / hand over possession with delay compensation.", "Award compensation and costs."],
  annex=["Builder-buyer agreement", "Payment receipts", "Demand letters and correspondence", "Legal notice"],
  cautions=CPA_CAUTIONS, verification="affidavit", keywords="builder flat possession delay real estate refund apartment buyer project")

D("consumer-ecommerce-utp", "consumer", "E-commerce / Unfair Trade Practice Complaint",
  "Complaint against an online seller or platform.",
  doc="Consumer Complaint under Section 35 of the Consumer Protection Act, 2019 — E-commerce / Unfair Trade Practice",
  forum="Consumer Commission (by consideration paid)", parties="consumer",
  statutes=CPA_STAT + [S("Section 2(47), Consumer Protection Act 2019", "'Unfair trade practice' defined"),
                       S("Consumer Protection (E-Commerce) Rules 2020", "Duties of e-commerce entities and sellers, grievance officer and refund obligations")],
  limitation=CPA_LIMIT, pre=["Preserve screenshots, order IDs, chat transcripts and payment proof.", "Use the National Consumer Helpline (1915) and the platform's grievance officer first."],
  facts=CPA_FACTS + [F("platform", "Platform / seller and order ID")], outline=CPA_OUTLINE,
  grounds=["The opposite party engaged in an unfair trade practice / deficient service: [particulars: non-delivery, counterfeit, refusal to refund].",
           "The opposite party failed to resolve the grievance within the time required by the E-Commerce Rules."],
  prayers=CPA_PRAYERS, annex=CPA_ANNEX + ["Screenshots, order confirmation and chat transcripts"], cautions=CPA_CAUTIONS,
  verification="affidavit", keywords="ecommerce online shopping amazon flipkart refund not delivered fake product unfair trade practice")

D("consumer-banking-service", "consumer", "Banking / Financial Service Deficiency",
  "Complaint about bank charges, wrongful debits, card or loan servicing.",
  doc="Consumer Complaint under Section 35 of the Consumer Protection Act, 2019 — Banking Service Deficiency",
  forum="Consumer Commission / RBI Ombudsman (alternative remedy)", parties="consumer",
  statutes=CPA_STAT + [S("RBI Integrated Ombudsman Scheme, 2021", "Complaint first to the regulated entity; escalation to the RBI Ombudsman if unresolved (verify current time limits)")],
  limitation=CPA_LIMIT, pre=["Complain to the bank in writing first and keep the reference number."],
  facts=CPA_FACTS + [F("account", "Account / card / loan no. (last four digits)")], outline=CPA_OUTLINE,
  grounds=["The bank's acts (wrongful debit / non-credit / unauthorised charges / delay) amount to deficiency in service.", "The bank failed to resolve the complaint within its own grievance timelines."],
  prayers=CPA_PRAYERS, annex=CPA_ANNEX + ["Account statements", "Bank's grievance correspondence"], cautions=CPA_CAUTIONS,
  verification="affidavit", keywords="bank wrongful debit card fraud loan charges ombudsman rbi complaint")

D("consumer-appeal-state-41", "consumer", "Appeal to State Commission (s.41)",
  "Appeal against an order of the District Commission.",
  doc="Appeal under Section 41 of the Consumer Protection Act, 2019",
  forum="State Consumer Disputes Redressal Commission", parties="appellant",
  statutes=[S("Section 41, Consumer Protection Act 2019", "Appeal from the District Commission to the State Commission within 45 days; the appellant must deposit 50% of the amount ordered")],
  limitation="45 days from the date of the order (s.41); delay may be condoned for sufficient cause. Confirm the current pre-deposit requirement.",
  pre=["Arrange the 50% deposit (of the amount awarded) before or with the appeal.", "Obtain a certified copy of the order."],
  facts=[F("order_no", "Case No. and order date"), F("order_summary", "Substance of the order appealed against", "", "textarea"), F("deposit", "Deposit made (Rs.) and proof", "")],
  outline=["The complaint and the order appealed against", "Errors of fact and law in the order", "Deposit made"],
  grounds=["The District Commission erred in [appreciating the evidence / applying the law]: [specific errors].",
           "The order overlooks [documents / defences] placed on record."],
  prayers=["Set aside the impugned order dated {{order_no}} and dismiss the complaint / modify the relief.", "Stay recovery pending appeal."],
  annex=["Certified copy of the order", "Proof of statutory deposit", "Memorandum of appeal with grounds"], cautions=[COMMON_CAUTION_VERIFY],
  verification="affidavit", keywords="consumer appeal state commission 41 district commission order")

D("consumer-execution-71", "consumer", "Execution of Consumer Commission Order",
  "Application to enforce an order and penalise non-compliance.",
  doc="Execution Application under Sections 71 and 72 of the Consumer Protection Act, 2019",
  forum="The Commission that passed the order", parties="applicant",
  statutes=[S("Section 71, Consumer Protection Act 2019", "Enforcement of orders as a decree (Order XXI CPC)"),
            S("Section 72, Consumer Protection Act 2019", "Penalty for non-compliance — imprisonment of one month to three years and/or fine")],
  limitation="Execution follows the order; delay should be explained.",
  pre=["Confirm the order is final (no stay) and the compliance period has expired."],
  facts=[F("order_details", "Order — case no., date, relief awarded", "", "textarea"), F("noncompliance", "Non-compliance so far", "", "textarea"), F("amount_due", "Amount due with interest (Rs.)")],
  outline=["The order and the relief awarded", "Non-compliance by the judgment debtor", "Particulars of assets / means for attachment"],
  grounds=["The judgment debtor has wilfully failed to comply with the order dated [date] within the time allowed."],
  prayers=["Enforce the order under Section 71 by attachment and sale of the judgment debtor's property.", "Punish the judgment debtor under Section 72 for non-compliance."],
  annex=["Certified copy of the order", "Notice demanding compliance and proof of service"], cautions=[COMMON_CAUTION_VERIFY],
  verification="affidavit", keywords="execution consumer order not complied section 71 72 penalty attach")

D("consumer-reply-written-version", "consumer", "Written Version (Opposite Party's Reply)",
  "Reply on behalf of the opposite party to a consumer complaint.",
  doc="Written Version on behalf of the Opposite Party under Section 38 of the Consumer Protection Act, 2019",
  forum="Consumer Commission", parties="defendant",
  statutes=[S("Section 38(2)(a), Consumer Protection Act 2019", "Opposite party to give its version within 30 days, extendable by up to 15 days; the Supreme Court has held the period cannot be extended further (New India Assurance v Hilli Multipurpose Cold Storage, 2020)")],
  limitation="30 days from receipt of the notice, plus a maximum 15-day extension — do not miss it.",
  pre=["Diary the 30 + 15 days from actual receipt of notice; file with a copy to the complainant."],
  facts=[F("complaint_no", "Complaint No."), F("service_date", "Date of receipt of notice", "", "date"), F("defence", "Principal defences", "", "textarea")],
  outline=["Preliminary objections — jurisdiction, limitation, not a consumer, no deficiency", "Para-wise reply to the complaint", "Submissions on merits", "Documents relied on"],
  grounds=["The complaint is not maintainable: [jurisdiction / limitation / complainant is not a consumer / commercial purpose].",
           "There was no deficiency in service / defect: [particulars].", "The claim for compensation is exaggerated and unsupported."],
  prayers=["Dismiss the complaint with costs."], annex=["Documents relied on", "Authority letter / vakalatnama"], cautions=[COMMON_CAUTION_VERIFY],
  verification="affidavit", keywords="written version reply consumer complaint opposite party defence 38")

# ═════════════════════════════════════════════════════════════════════
#  4. PROPERTY & TENANCY
# ═════════════════════════════════════════════════════════════════════
COURT_FEE_SEC = ("VALUATION AND COURT FEE", "The suit is valued at Rs. [value] for the purposes of jurisdiction and Rs. [value] for court fee, on which the court fee of Rs. [amount] has been paid as required by the [State] Court Fees Act. [Do not assume the rate — check the State court-fee schedule for this relief.]")
JURIS_SEC = ("JURISDICTION", "This Hon'ble Court has territorial jurisdiction because [the property is situated / the defendant resides or works for gain / the cause of action arose] within its limits, and pecuniary jurisdiction because the suit is valued at Rs. [value].")
COA_SEC = ("CAUSE OF ACTION", "The cause of action arose on [date] when [event], and continues to subsist.")
SUIT_STAT_NOTE = "Court fee and pecuniary jurisdiction are State-specific — verify both before filing."

D("suit-specific-performance", "property", "Suit for Specific Performance of Agreement to Sell",
  "Suit to compel execution of a sale deed under a valid agreement.",
  doc="Suit for Specific Performance of Contract and Permanent Injunction",
  forum="Civil Court / District Court / High Court (original side) of competent pecuniary jurisdiction", parties="plaintiff",
  statutes=[S("Section 10, Specific Relief Act 1963", "Specific performance of contracts enforceable (as amended in 2018)"),
            S("Section 16(c), Specific Relief Act 1963", "The plaintiff must aver and prove continuous readiness and willingness to perform"),
            S("Section 21, Specific Relief Act 1963", "Compensation in addition to or in substitution of specific performance"),
            S("Article 54, Limitation Act 1963", "Three years from the date fixed for performance or, if none, from when the plaintiff has notice that performance is refused")],
  limitation="Three years from the date fixed for performance, or if no date is fixed, from when the plaintiff has notice of refusal (Article 54).",
  pre=["Confirm the agreement is valid and the plaintiff has always been ready and willing — keep proof of funds.", "Send a legal notice calling on the defendant to execute the sale deed."],
  facts=[F("agreement_date", "Date of agreement to sell", "", "date"), F("property_desc", "Schedule of property", "Survey no., boundaries, extent", "textarea"),
         F("sale_price", "Sale price (Rs.)"), F("advance", "Advance paid (Rs.) and dates"), F("performance_date", "Date fixed for completion", "", "date"),
         F("refusal", "How and when the defendant refused / failed to perform", "", "textarea"), F("readiness", "Evidence of readiness and willingness (funds, correspondence)", "", "textarea")],
  outline=["The parties and the property", "The agreement to sell — date, price, advance, terms", "Plaintiff's continuous readiness and willingness (Section 16(c))",
           "The defendant's default or refusal", "Legal notice and reply", "Why damages are not an adequate remedy"],
  grounds=["The plaintiff has always been ready and willing to perform his part of the contract and has expressed it in writing: [particulars].",
           "The defendant has no valid reason for refusing performance.",
           "The suit is within limitation under Article 54 of the Limitation Act."],
  prayers=["Direct the defendant to execute and register the sale deed in favour of the plaintiff in respect of the suit property on payment of the balance of Rs. [balance].",
           "In the alternative, direct refund of the advance with interest and award compensation under Section 21 of the Specific Relief Act.",
           "Restrain the defendant by permanent injunction from alienating or encumbering the suit property.", "Award costs."],
  annex=["Agreement to sell", "Proof of advance payment", "Correspondence showing readiness and willingness", "Legal notice and postal proof", "Title documents / encumbrance certificate"],
  cautions=["Failure to plead and prove readiness and willingness is fatal — plead it specifically and keep the money available.", SUIT_STAT_NOTE],
  sections=[JURIS_SEC, ("READINESS AND WILLINGNESS", "The plaintiff has at all times been, and is, ready and willing to perform the plaintiff's part of the agreement dated {{agreement_date}} and to pay the balance consideration."), COA_SEC, COURT_FEE_SEC],
  verification="verification", keywords="specific performance agreement to sell sale deed property buyer seller refuses execute registration")

D("suit-declaration-injunction", "property", "Suit for Declaration of Title and Permanent Injunction",
  "Suit to declare title and restrain interference.",
  doc="Suit for Declaration of Title and Permanent Injunction",
  forum="Civil Court of competent pecuniary jurisdiction", parties="plaintiff",
  statutes=[S("Section 34, Specific Relief Act 1963", "Declaration of status or right — the plaintiff must ask for consequential relief if able to"),
            S("Section 38, Specific Relief Act 1963", "Perpetual injunction"),
            S("Article 58, Limitation Act 1963", "Suit for declaration — three years from when the right to sue first accrues")],
  limitation="Three years from when the right to sue first accrues (Article 58); a suit for possession based on title has a longer period — see the possession entry.",
  pre=["Collect title documents and revenue records; identify the cloud on title and who created it."],
  facts=[F("property_desc", "Schedule of property", "", "textarea"), F("title_source", "Source of the plaintiff's title", "Sale deed / gift / will / inheritance", "textarea"),
         F("cloud", "Cloud on title or act of interference", "", "textarea"), F("interference_date", "Date of first interference", "", "date")],
  outline=["The property and the plaintiff's title", "Possession of the plaintiff", "The defendant's adverse claim or interference", "Cause of action and limitation"],
  grounds=["The plaintiff is the lawful owner in possession of the suit property by virtue of [title].",
           "The defendant's claim [particulars] is without any legal basis and creates a cloud on the plaintiff's title.",
           "The plaintiff is entitled to a declaration and to protection of possession by injunction."],
  prayers=["Declare that the plaintiff is the lawful owner of the suit property described in the schedule.", "Restrain the defendant, permanently, from interfering with the plaintiff's peaceful possession and enjoyment.", "Award costs."],
  annex=["Title deeds", "Revenue / mutation records, tax receipts", "Encumbrance certificate", "Documents showing the defendant's interference"],
  cautions=["If the plaintiff is not in possession, a bare declaration suit may be barred by the proviso to s.34 — seek possession as well.", SUIT_STAT_NOTE],
  sections=[JURIS_SEC, COA_SEC, COURT_FEE_SEC], verification="verification",
  keywords="declaration title injunction property ownership cloud interference land trespass")

D("suit-partition", "property", "Suit for Partition and Separate Possession",
  "Partition suit among co-owners / coparceners.",
  doc="Suit for Partition and Separate Possession",
  forum="Civil Court / District Court", parties="plaintiff",
  statutes=[S("Section 6, Hindu Succession Act 1956 (as substituted in 2005)", "Daughters are coparceners by birth with the same rights as sons (Vineeta Sharma v Rakesh Sharma, 2020)"),
            S("Order XX Rule 18, CPC", "Preliminary decree declaring shares, then final decree by division")],
  limitation="Generally no fixed limitation while the parties remain in joint possession; an ouster starts the clock — verify for the facts.",
  pre=["Prepare a family tree and a schedule of every joint family / joint property.", "Check for any earlier partition, release deed or will."],
  facts=[F("family_tree", "Family tree — coparceners / co-owners and relationship", "", "textarea"), F("schedule", "Schedule of properties for partition", "", "textarea"),
         F("shares", "Share claimed by the plaintiff", "", "text"), F("demand", "Prior demand for partition and response", "", "textarea")],
  outline=["The family and the source of the properties", "Joint possession and enjoyment", "The plaintiff's share and the shares of others", "Refusal of partition", "Properties to be partitioned (schedule)"],
  grounds=["The plaintiff is a coparcener / co-owner entitled to a [share] in the suit properties.", "The defendants have refused to effect a partition despite requests: [particulars].",
           "The properties are available for partition and are joint family / co-owned properties."],
  prayers=["Declare the plaintiff's share in the suit properties and pass a preliminary decree.", "Divide the properties by metes and bounds and allot separate possession to the plaintiff by a final decree.", "Direct account of income from the properties.", "Award costs."],
  annex=["Family tree", "Title documents", "Revenue records", "Documents evidencing the demand for partition"],
  cautions=[SUIT_STAT_NOTE, "Include all coparceners and co-owners as parties; a partition suit without them is defective."],
  sections=[JURIS_SEC, COA_SEC, COURT_FEE_SEC], verification="verification", keywords="partition joint family coparcener share ancestral property division daughter hindu succession")

D("suit-possession-title", "property", "Suit for Recovery of Possession (based on title)",
  "Suit to recover possession from a trespasser or person in wrongful occupation.",
  doc="Suit for Recovery of Possession, Mesne Profits and Injunction",
  forum="Civil Court of competent pecuniary jurisdiction", parties="plaintiff",
  statutes=[S("Article 65, Limitation Act 1963", "Suit for possession based on title — twelve years from when the defendant's possession becomes adverse"),
            S("Section 2(12) and Order XX Rule 12, CPC", "Mesne profits and enquiry into them")],
  limitation="Twelve years from when the defendant's possession becomes adverse to the plaintiff (Article 65).",
  pre=["Establish title, the date and manner of dispossession, and the value for court fee."],
  facts=[F("property_desc", "Schedule of property", "", "textarea"), F("title_source", "Plaintiff's title", "", "textarea"),
         F("dispossession", "How and when the defendant entered / took possession", "", "textarea"), F("mesne", "Basis for mesne profits (rent / user value per month)", "", "text")],
  outline=["The property and the plaintiff's title", "The defendant's entry and wrongful occupation", "Demand to vacate and response", "Mesne profits claimed"],
  grounds=["The plaintiff is the owner of the suit property; the defendant is in wrongful occupation without any right.", "The suit is within the twelve-year limitation period under Article 65.",
           "The plaintiff is entitled to mesne profits from the date of wrongful occupation."],
  prayers=["Direct the defendant to deliver vacant possession of the suit property to the plaintiff.", "Direct enquiry into and payment of mesne profits.", "Award costs."],
  annex=["Title documents", "Proof of the plaintiff's earlier possession", "Notice to vacate and postal proof", "Revenue records"],
  cautions=[SUIT_STAT_NOTE, "If the defendant claims adverse possession, be ready with proof of the plaintiff's possession within twelve years."],
  sections=[JURIS_SEC, COA_SEC, COURT_FEE_SEC], verification="verification", keywords="recovery of possession trespass encroach occupy land house title mesne profits")

D("eviction-landlord", "property", "Eviction Petition (Landlord)",
  "Petition under the applicable State Rent Act for eviction of a tenant.",
  doc="Petition for Eviction of Tenant under the applicable Rent Control / Rent Act",
  forum="Rent Controller / Rent Court / Civil Court (as the State Act provides)", parties="petitioner",
  statutes=[S("[Applicable State Rent Control / Rent Act]", "Eviction grounds and forum are State-specific — e.g. the Tamil Nadu Regulation of Rights and Responsibilities of Landlords and Tenants Act, 2017; verify the Act in force for the premises"),
            S("Section 106, Transfer of Property Act 1882", "Notice to terminate a lease where the State Act does not apply")],
  limitation="Depends on the State Act and the ground; check before filing.",
  pre=["Identify the ground (arrears, bona fide personal need, subletting, damage, nuisance) and the State Act's procedure.", "Serve the notice the Act requires and keep proof."],
  facts=[F("rent_act", "State Rent Act relied on"), F("premises", "Description of the premises", "", "textarea"), F("tenancy_start", "Tenancy start date", "", "date"),
         F("rent", "Monthly rent (Rs.) and arrears (Rs.)", "", "text"), F("ground", "Ground(s) for eviction", "", "textarea"), F("notice_details", "Notice served — date and mode", "", "text")],
  outline=["The landlord, the tenant and the premises", "Terms of tenancy and rent", "The ground(s) for eviction with facts", "Notice served and the tenant's response"],
  grounds=["The tenant is liable to be evicted under {{rent_act}} on the ground(s): [ground].", "The landlord has served the requisite notice and the tenant has failed to comply.",
           "The requirement is bona fide and no reasonable alternative accommodation is available to the landlord. [Delete if not relied on.]"],
  prayers=["Direct eviction of the tenant and delivery of vacant possession of the premises.", "Direct payment of arrears of rent and mesne profits / damages for use and occupation.", "Award costs."],
  annex=["Rental agreement", "Rent receipts / bank entries", "Notice to the tenant and postal proof", "Ownership documents"],
  cautions=["State rent laws differ sharply — check the Act, forum and any exemption for high-rent or new premises before filing."],
  verification="verification", keywords="eviction tenant landlord rent control vacate premises arrears bona fide need")

D("notice-terminate-tenancy", "property", "Notice to Terminate Tenancy (Landlord)",
  "Legal notice terminating a tenancy and calling on the tenant to vacate.",
  doc="Legal Notice for Termination of Tenancy and Delivery of Vacant Possession", kind="notice",
  forum="Tenant (notice stage)", parties="notice",
  statutes=[S("Section 106, Transfer of Property Act 1882", "Notice of not less than 15 days for a month-to-month tenancy, expiring with the end of a month of the tenancy; written and signed"),
            S("[Applicable State Rent Act]", "Where a State Act applies it may prescribe its own grounds and procedure — check first")],
  limitation="Not applicable (notice stage).", pre=["Confirm a State Rent Act does not displace s.106 for these premises.", "Count 15 days from delivery and make the notice expire at the end of a month of the tenancy."],
  facts=[F("premises", "Description of the premises", "", "textarea"), F("tenancy_start", "Tenancy start date", "", "date"), F("rent", "Monthly rent (Rs.)"),
         F("vacate_date", "Date by which the tenant must vacate", "End of a month of the tenancy", "date"), F("reason", "Reason for termination (if any)", "", "textarea")],
  outline=["The tenancy — premises, date, rent", "Termination of the tenancy by this notice", "Direction to vacate and handover possession", "Arrears / dues, if any"],
  grounds=["Your tenancy is a month-to-month tenancy which stands terminated on the expiry of the notice period under Section 106 of the Transfer of Property Act, 1882."],
  prayers=["Vacate the premises and hand over vacant peaceful possession on or before {{vacate_date}}.", "Pay arrears of rent, if any, and utility dues up to the date of vacating."],
  annex=[], cautions=["Serve by a mode that gives proof of delivery (registered post AD plus email)."],
  ai=True, keywords="notice tenant terminate tenancy vacate section 106 transfer of property act landlord")

D("suit-injunction-ia", "property", "Application for Temporary Injunction (Order XXXIX)",
  "Interlocutory application for interim injunction in a suit.",
  doc="Application under Order XXXIX Rules 1 and 2 and Section 151 of the Code of Civil Procedure, 1908 for Temporary Injunction",
  forum="Court hearing the suit", parties="applicant",
  statutes=[S("Order XXXIX Rules 1 and 2, CPC", "Temporary injunction to restrain waste, alienation or breach of contract"),
            S("Order XXXIX Rule 3, CPC", "Notice to the opposite party before ex parte injunction, unless delay would defeat the object — reasons must be recorded"),
            S("Section 151, CPC", "Inherent powers of the court")],
  limitation="Filed with or after the suit.",
  pre=["Show the three-fold test: prima facie case, balance of convenience, irreparable injury.", "Seek ad-interim ex parte relief only where urgency is real and explained."],
  facts=[F("suit_no", "Suit No. and title"), F("relief", "Injunction sought", "", "textarea"), F("urgency", "Why urgent — threatened act and date", "", "textarea")],
  outline=["The suit and the plaintiff's case in brief", "The threatened act", "Prima facie case", "Balance of convenience", "Irreparable injury"],
  grounds=["The applicant has a strong prima facie case: [reasons].", "The balance of convenience is in favour of the applicant: [reasons].", "Irreparable loss that cannot be compensated in money will be caused unless the injunction is granted: [particulars]."],
  prayers=["Restrain the respondent from [act] pending disposal of the suit.", "Grant ad-interim ex parte relief until the next date of hearing."],
  annex=["Copy of the plaint", "Documents supporting prima facie case", "Affidavit in support"], cautions=["Full disclosure of adverse facts is required for ex parte relief."],
  verification="affidavit", keywords="temporary injunction stay order 39 interim relief restrain suit application")

D("suit-cancellation-instrument", "property", "Suit for Cancellation of Sale Deed / Instrument",
  "Suit to cancel a voidable document (fraud, coercion, misrepresentation).",
  doc="Suit for Cancellation of Instrument and Consequential Relief",
  forum="Civil Court of competent pecuniary jurisdiction", parties="plaintiff",
  statutes=[S("Section 31, Specific Relief Act 1963", "Cancellation of written instruments that are void or voidable"),
            S("Section 33, Specific Relief Act 1963", "Restitution on cancellation"),
            S("Article 59, Limitation Act 1963", "Three years from when the facts entitling the plaintiff to cancel first become known")],
  limitation="Three years from when the facts entitling the plaintiff to have the instrument cancelled first become known (Article 59).",
  pre=["Obtain a certified copy of the impugned document and plead the fraud / coercion with particulars."],
  facts=[F("instrument", "Instrument — type, date, registration details", "", "textarea"), F("ground", "Ground — fraud / coercion / misrepresentation / forgery", "", "textarea"),
         F("discovery", "Date and manner of discovery", "", "text"), F("property_desc", "Schedule of property", "", "textarea")],
  outline=["The parties and the property", "The impugned instrument", "How the instrument was obtained — particulars of fraud or coercion", "Discovery of the facts", "Prejudice caused"],
  grounds=["The instrument is void / voidable because [particulars of fraud, coercion, misrepresentation or forgery].", "The plaintiff discovered the facts on [date]; the suit is within three years of that date."],
  prayers=["Declare the instrument dated [date] void and cancel it.", "Direct the Sub-Registrar to make necessary entries.", "Restrain the defendant from dealing with the property.", "Award costs."],
  annex=["Certified copy of the impugned instrument", "Documents showing the plaintiff's title", "Evidence of fraud / coercion"],
  cautions=["Fraud must be pleaded with specific particulars; a general allegation will not do.", SUIT_STAT_NOTE],
  sections=[JURIS_SEC, COA_SEC, COURT_FEE_SEC], verification="verification", keywords="cancel sale deed gift deed fraud forged document instrument cancellation")

D("suit-easement-injunction", "property", "Injunction Against Obstruction of Easement / Encroachment",
  "Suit to restrain obstruction of a right of way, light, air or water, or an encroachment.",
  doc="Suit for Permanent Injunction and Removal of Encroachment / Obstruction",
  forum="Civil Court", parties="plaintiff",
  statutes=[S("Indian Easements Act 1882", "Easements: acquisition by grant, necessity or prescription (twenty years' uninterrupted enjoyment)"),
            S("Section 38, Specific Relief Act 1963", "Perpetual injunction"), S("Section 39, Specific Relief Act 1963", "Mandatory injunction")],
  limitation="Depends on the wrong: obstruction is often treated as continuing — check.",
  pre=["Identify the easement, how it arose, and the obstruction with measurements."],
  facts=[F("easement", "Easement claimed and how acquired", "", "textarea"), F("obstruction", "Obstruction / encroachment — what, since when", "", "textarea"),
         F("property_desc", "Dominant and servient properties", "", "textarea")],
  outline=["The properties", "The easement and how it arose", "The obstruction or encroachment", "Loss caused"],
  grounds=["The plaintiff has an easement over the servient property by [grant / necessity / prescription].", "The defendant's obstruction infringes the plaintiff's right and causes injury."],
  prayers=["Restrain the defendant from obstructing the plaintiff's right of [way / light / air / water].", "Direct removal of the obstruction / encroachment.", "Award costs."],
  annex=["Site plan / survey sketch", "Title documents of both properties", "Photographs"], cautions=[SUIT_STAT_NOTE],
  sections=[JURIS_SEC, COA_SEC, COURT_FEE_SEC], verification="verification", keywords="easement right of way encroachment obstruction neighbour boundary wall light air")

D("suit-redemption-mortgage", "property", "Suit for Redemption of Mortgage",
  "Suit by a mortgagor to redeem mortgaged property.",
  doc="Suit for Redemption of Mortgage",
  forum="Civil Court", parties="plaintiff",
  statutes=[S("Section 60, Transfer of Property Act 1882", "Right of redemption"), S("Order XXXIV, CPC", "Suits relating to mortgages"),
            S("Article 61, Limitation Act 1963", "Suit to redeem — thirty years from when the right to redeem accrues")],
  limitation="Thirty years from when the right to redeem accrues (Article 61).",
  pre=["Obtain the mortgage deed and compute the amount due."],
  facts=[F("mortgage", "Mortgage deed — date, parties, amount", "", "textarea"), F("amount_due", "Amount due on the mortgage (Rs.)"), F("property_desc", "Mortgaged property", "", "textarea")],
  outline=["The mortgage and the property", "Payment or tender of the mortgage money", "Refusal to allow redemption"],
  grounds=["The plaintiff is entitled to redeem on payment of the mortgage money.", "The defendant has refused to accept the amount and restore the property."],
  prayers=["Pass a decree for redemption on payment of Rs. {{amount_due}} and direct the defendant to deliver possession and the mortgage documents.", "Award costs."],
  annex=["Mortgage deed", "Proof of payments"], cautions=[SUIT_STAT_NOTE],
  sections=[JURIS_SEC, COA_SEC, COURT_FEE_SEC], verification="verification", keywords="mortgage redemption redeem property deed release")

D("rera-complaint-31", "property", "RERA Complaint (Refund / Delayed Possession)",
  "Complaint to the State RERA Authority against a promoter.",
  doc="Complaint under Section 31 of the Real Estate (Regulation and Development) Act, 2016",
  forum="State Real Estate Regulatory Authority / Adjudicating Officer", parties="claimant",
  statutes=[S("Section 31, RERA 2016", "Complaint to the Authority for violations by promoters, allottees or agents"),
            S("Section 18, RERA 2016", "Return of amount and compensation / interest for delayed possession"),
            S("Section 71, RERA 2016", "Adjudicating Officer — compensation under certain sections"),
            S("Section 43, RERA 2016", "Appeal to the Appellate Tribunal within 60 days (promoter must pre-deposit on refund/interest orders)")],
  limitation="RERA does not itself prescribe a limitation for s.31 complaints; treat any delay cautiously and file promptly — verify current case law.",
  pre=["Check the project is RERA-registered and note its registration number.", "Forms and fees differ by State — use the State RERA portal's prescribed form."],
  facts=[F("project", "Project name and RERA registration no."), F("unit", "Unit and agreement date"), F("promised", "Promised possession date per agreement", "", "date"),
         F("paid", "Amount paid (Rs.)"), F("relief_choice", "Relief chosen — refund with interest / possession with delay interest", "", "text"), F("default", "Promoter's default", "", "textarea")],
  outline=["The project, the promoter and the allottee's unit", "The agreement and payments", "Promised and actual possession position", "Promoter's default", "Relief under s.18"],
  grounds=["The promoter has failed to complete and hand over possession by the agreed date, entitling the allottee to relief under Section 18.",
           "The allottee opts for [refund with interest / continuing with the project and delay interest]."],
  prayers=["Direct the promoter to refund Rs. {{paid}} with interest at the prescribed rate / hand over possession with interest for the period of delay.", "Direct compensation before the Adjudicating Officer as applicable.", "Award costs."],
  annex=["Agreement for sale / allotment letter", "Payment receipts", "Project RERA registration details", "Correspondence with the promoter"],
  cautions=["The interest rate and forms come from the State RERA Rules — do not assume a rate; check the State Rules."],
  verification="affidavit", keywords="rera builder delay possession refund interest real estate regulatory authority promoter allottee")

D("notice-builder-delay", "property", "Legal Notice to Builder — Delay / Refund",
  "Notice demanding possession or refund with interest.",
  doc="Legal Notice to Builder / Promoter for Delayed Possession or Refund", kind="notice", forum="Builder / promoter (notice stage)", parties="notice",
  statutes=[S("Section 18, RERA 2016", "Return of amount and compensation / interest for delayed possession"), S("Section 35, Consumer Protection Act 2019", "Consumer remedy")],
  limitation="Not applicable (notice stage).", pre=["Assemble the agreement, payment receipts and correspondence."],
  facts=[F("project", "Project and unit"), F("agreement_date", "Date of agreement", "", "date"), F("promised", "Promised possession date", "", "date"), F("paid", "Amount paid (Rs.)")],
  outline=["The agreement and payments", "Promised possession date and delay", "Requests made and the promoter's failure", "Demand for possession or refund with interest"],
  grounds=["You have failed to hand over possession by the promised date, contrary to the agreement and to Section 18 of the RERA Act, 2016."],
  prayers=["Hand over possession of the unit with delay interest, or refund Rs. {{paid}} with interest at the prescribed rate.", "Compensate the client for the loss suffered."],
  annex=[], cautions=[COMMON_CAUTION_VERIFY], ai=True, keywords="notice builder possession delay refund rera legal notice flat")


# ═════════════════════════════════════════════════════════════════════
#  5. MONEY & COMMERCIAL  (+ two criminal-side money entries)
# ═════════════════════════════════════════════════════════════════════
MONEY_FACTS = [
    F("contract", "Contract / transaction — date, parties, terms", "Loan, supply, services, agreement number", "textarea"),
    F("amount", "Principal amount claimed (Rs.)"),
    F("due_date", "Date payment fell due", "", "date"),
    F("demand", "Demands made and the defendant's response", "Dates and modes of reminders / notices", "textarea"),
    F("interest", "Interest claimed", "Contractual rate and period, or the rate claimed as damages", "text"),
]
MONEY_OUTLINE = ["The parties and the transaction", "Performance by the plaintiff", "The amount due and the due date",
                 "Demands and default", "Computation of the claim including interest"]
COMM_NOTE = ("If the dispute is a 'commercial dispute' of 'specified value' (Rs. 3 lakh or more), the Commercial Courts Act 2015 applies, "
             "including pre-institution mediation under s.12A unless urgent interim relief is sought — verify before choosing the forum.")

D("suit-money-recovery", "commercial", "Suit for Recovery of Money",
  "Ordinary civil suit for recovery of a debt or amount due.",
  doc="Plaint for Recovery of Money", forum="Civil Court", parties="plaintiff",
  statutes=[S("Section 9 and Order VII, CPC 1908", "Institution of civil suits and contents of a plaint"),
            S("Section 34, CPC 1908", "Interest on decretal amount"),
            S("Limitation Act 1963", "Generally three years (e.g. Article 19 for money lent; Article 113 residuary) — check which article fits")],
  limitation="Generally three years from when the amount fell due; acknowledgment in writing can extend it (s.18, Limitation Act). Identify the right Article.",
  pre=["Collect the written contract, ledger / account statement and all demand correspondence.", "Check whether a summary suit under Order XXXVII fits (see separate entry) and whether the Commercial Courts Act applies."],
  facts=MONEY_FACTS, outline=MONEY_OUTLINE,
  grounds=["The defendant is liable to pay the sum claimed under the transaction described above.", "The defendant has failed to pay despite repeated demands, and the plaintiff is entitled to interest."],
  prayers=["Pass a decree against the defendant for Rs. {{amount}} together with interest at {{interest}} till realisation.", "Award costs of the suit."],
  annex=["Contract / agreement / invoices", "Statement of account or ledger", "Demand notice with postal proof", "Documents evidencing part payments or acknowledgment"],
  cautions=[SUIT_STAT_NOTE, COMM_NOTE], sections=[JURIS_SEC, COA_SEC, COURT_FEE_SEC], verification="verification",
  keywords="recovery money debt loan dues unpaid invoice suit civil payment amount")

D("suit-summary-order37", "commercial", "Summary Suit (Order XXXVII CPC)",
  "Fast-track suit on a bill of exchange, hundi, promissory note or a written contract for a liquidated demand.",
  doc="Summary Suit under Order XXXVII of the Code of Civil Procedure, 1908", forum="Civil Court / Commercial Court", parties="plaintiff",
  statutes=[S("Order XXXVII, CPC 1908", "Summary procedure for suits on negotiable instruments and written contracts for a debt or liquidated demand"),
            S("Order XXXVII Rule 3, CPC 1908", "Defendant must obtain leave to defend by an affidavit disclosing facts entitling him to defend")],
  limitation="Same as the underlying claim — generally three years from the due date; check the Article.",
  pre=["Confirm the claim is on the kinds of instruments or written contracts Order XXXVII covers and is for a liquidated sum.", "The plaint must state that the suit is filed under Order XXXVII and contain the prescribed inscription and statements."],
  facts=MONEY_FACTS, outline=MONEY_OUTLINE,
  grounds=["The claim is founded on a written instrument / contract and is for a liquidated sum, so the suit lies under Order XXXVII.", "The defendant has no bona fide defence and the plaintiff is entitled to a summary decree."],
  prayers=["Pass a decree for Rs. {{amount}} with interest at {{interest}} and costs.", "Refuse leave to defend unless the defendant discloses a triable defence."],
  annex=["Original instrument / written contract", "Dishonoured cheque / return memo, if any", "Statement of account", "Demand notice and proof of service"],
  cautions=[SUIT_STAT_NOTE, "Place the Order XXXVII inscription under the title of the plaint as the Rule requires — check the current form in your High Court."],
  sections=[JURIS_SEC, COA_SEC, COURT_FEE_SEC], verification="verification",
  keywords="summary suit order 37 xxxvii bill of exchange promissory note liquidated demand cheque loan")

D("suit-breach-contract", "commercial", "Suit for Damages for Breach of Contract",
  "Compensation for loss caused by breach of a contract.",
  doc="Plaint for Damages for Breach of Contract", forum="Civil Court / Commercial Court", parties="plaintiff",
  statutes=[S("Section 73, Indian Contract Act 1872", "Compensation for loss or damage caused by breach of contract"),
            S("Section 74, Indian Contract Act 1872", "Compensation where a sum is named as liquidated damages or penalty"),
            S("Section 75, Indian Contract Act 1872", "Party rightfully rescinding is entitled to compensation")],
  limitation="Generally three years from the date of breach (Article 55, Limitation Act) — verify the Article applicable to the facts.",
  pre=["Identify the clause breached, the date of breach and the loss with evidence of quantification.", "Check for an arbitration clause — the suit may be barred by s.8 of the Arbitration and Conciliation Act."],
  facts=[F("contract", "Contract — date, parties, key terms", "", "textarea"), F("breach", "The breach — clause and date", "", "textarea"),
         F("loss", "Loss suffered and how it is computed", "", "textarea"), F("amount", "Damages claimed (Rs.)"), F("adr_clause", "Arbitration / jurisdiction clause, if any", "Write 'None' if none", "text")],
  outline=["The contract and its terms", "The plaintiff's performance", "The defendant's breach", "The loss caused and its quantification"],
  grounds=["The defendant breached the contract by [act / omission].", "The loss was the natural consequence of the breach (or in the contemplation of the parties at the time of contract), entitling the plaintiff to compensation under Section 73.", "The plaintiff took reasonable steps to mitigate the loss."],
  prayers=["Pass a decree for Rs. {{amount}} as damages / compensation with interest and costs."],
  annex=["The contract", "Proof of performance", "Correspondence evidencing breach", "Documents quantifying loss"],
  cautions=[SUIT_STAT_NOTE, COMM_NOTE], sections=[JURIS_SEC, COA_SEC, COURT_FEE_SEC], verification="verification",
  keywords="breach contract damages compensation loss agreement default supplier vendor")

D("commercial-suit-12a", "commercial", "Commercial Suit with s.12A Pre-Institution Mediation",
  "Plaint in a commercial dispute of specified value under the Commercial Courts Act 2015.",
  doc="Plaint under the Commercial Courts Act, 2015", forum="Commercial Court / Commercial Division of the High Court", parties="plaintiff",
  statutes=[S("Commercial Courts Act 2015", "Special procedure and forum for commercial disputes"),
            S("Section 12A, Commercial Courts Act 2015", "Pre-institution mediation is mandatory unless urgent interim relief is contemplated"),
            S("Order XI, CPC as amended for commercial disputes", "Disclosure, discovery and inspection"),
            S("Order VIII Rule 1, CPC as amended for commercial disputes", "Time for filing the written statement")],
  limitation="Same as the underlying cause of action; time spent in s.12A mediation is dealt with in the Act — verify how it applies to your dates.",
  pre=["Confirm the dispute is a 'commercial dispute' as defined and meets the specified value (Rs. 3 lakh) — check the current text of the Act.", "Complete pre-institution mediation and annex the non-starter / settlement report, or plead urgent interim relief.", "The plaint must be accompanied by a statement of truth and the documents relied on."],
  facts=[F("dispute_type", "Nature of the commercial dispute", "Supply, services, agency, IP licence, joint venture etc.", "text"),
         F("value", "Specified value of the dispute (Rs.)"), F("contract", "Contract and key terms", "", "textarea"),
         F("breach", "The default / wrong complained of", "", "textarea"), F("mediation", "Pre-institution mediation — date and outcome, or ground for exemption", "", "textarea"), F("relief", "Main relief sought", "", "textarea")],
  outline=["The parties and the nature of the commercial dispute", "The contract and the transactions", "The default and the loss", "Pre-institution mediation under s.12A", "Valuation and jurisdiction"],
  grounds=["The dispute is a commercial dispute of specified value within the Commercial Courts Act 2015.", "The plaintiff complied with the mandatory pre-institution mediation requirement (or seeks urgent interim relief).", "The defendant's default entitles the plaintiff to the relief prayed for."],
  prayers=["Pass a decree for {{relief}}.", "Award interest and costs."],
  annex=["Statement of truth", "Contract and transaction documents", "s.12A mediation report", "List of documents"],
  cautions=[COMM_NOTE, SUIT_STAT_NOTE], sections=[JURIS_SEC, COA_SEC, COURT_FEE_SEC], verification="verification",
  keywords="commercial court suit 12a mediation specified value commercial dispute pre-institution")

D("msme-facilitation-council", "commercial", "MSME Delayed Payment Reference (Facilitation Council)",
  "Claim by a micro or small enterprise for delayed payment before the MSME Facilitation Council.",
  doc="Reference under Section 18 of the Micro, Small and Medium Enterprises Development Act, 2006", forum="Micro and Small Enterprises Facilitation Council", parties="claimant",
  statutes=[S("Section 15, MSMED Act 2006", "Liability of the buyer to make payment within the agreed period, not exceeding forty-five days from acceptance"),
            S("Section 16, MSMED Act 2006", "Compound interest with monthly rests at three times the bank rate notified by the Reserve Bank of India"),
            S("Section 18, MSMED Act 2006", "Reference to the Facilitation Council, conciliation and arbitration"),
            S("Section 19, MSMED Act 2006", "Pre-deposit of seventy-five per cent to apply for setting aside an award")],
  limitation="The Act does not set a special period for s.18 references — treat the general Limitation Act as applicable and verify.",
  pre=["The supplier must be registered under the Act (Udyam registration) — check that the registration covers the date of supply.", "Assemble invoices, delivery proof and the buyer's acknowledgment of goods / services."],
  facts=[F("udyam", "Udyam registration no. and date"), F("supply", "Goods / services supplied", "", "textarea"), F("invoices", "Invoice numbers, dates and amounts", "", "textarea"),
         F("amount", "Principal unpaid (Rs.)"), F("agreed_days", "Agreed credit period (days)", "", "number"), F("demand", "Demands made and the buyer's response", "", "textarea")],
  outline=["The supplier's status and Udyam registration", "Supplies made and invoices raised", "Agreed credit period and acceptance", "Default and demands", "Interest under Section 16"],
  grounds=["The claimant is a micro / small enterprise supplier and the respondent is a buyer within the meaning of the Act.", "Payment has not been made within the agreed period or forty-five days from acceptance, whichever is earlier, as Section 15 requires.", "The claimant is entitled to interest under Section 16."],
  prayers=["Direct the respondent to pay Rs. {{amount}} with compound interest under Section 16 of the MSMED Act 2006.", "Award costs."],
  annex=["Udyam registration certificate", "Invoices and proof of delivery", "Ledger / statement of account", "Demand correspondence"],
  cautions=["Interest is fixed by statute at three times the RBI bank rate with monthly rests — compute from the RBI-notified rate for each period; the tool does not compute it.", COMMON_CAUTION_VERIFY],
  verification="affidavit", keywords="msme udyam delayed payment facilitation council small enterprise supplier interest 45 days")

D("arbitration-s9", "commercial", "Arbitration Interim Relief — Section 9",
  "Petition for interim measures before, during or after arbitral proceedings.",
  doc="Petition under Section 9 of the Arbitration and Conciliation Act, 1996", forum="Court (as defined in the Act) / Commercial Court", parties="petitioner",
  statutes=[S("Section 9, Arbitration and Conciliation Act 1996", "Interim measures by the court"),
            S("Section 9(2)", "Where interim relief is granted before arbitration, arbitral proceedings must commence within ninety days")],
  limitation="Not fixed for the petition itself, but s.9(2) requires arbitration to commence within 90 days of the interim order (or such further time as the Court allows) — verify.",
  pre=["Check the arbitration clause, the seat and the 'Court' with supervisory jurisdiction.", "Show urgency and a prima facie case; plan to invoke arbitration promptly to satisfy s.9(2)."],
  facts=[F("clause", "Arbitration clause — text or clause no. and seat", "", "textarea"), F("dispute", "Dispute in brief", "", "textarea"),
         F("interim", "Interim relief needed and why", "Preserve asset, deposit amount, restrain act", "textarea"), F("invocation", "Status of invocation of arbitration", "", "textarea")],
  outline=["The agreement and the arbitration clause", "The dispute", "Why interim protection is needed", "Status of arbitration"],
  grounds=["There is a valid arbitration agreement and a dispute arising out of it.", "The petitioner has a prima facie case and the balance of convenience lies in its favour; irreparable harm will result without interim protection.", "The petitioner will commence arbitration within the period prescribed by Section 9(2)."],
  prayers=["Grant interim relief of {{interim}} pending arbitration.", "Award costs."],
  annex=["Agreement with arbitration clause", "Notice invoking arbitration, if issued", "Documents showing risk to the subject-matter"], cautions=[COMMON_CAUTION_VERIFY],
  verification="affidavit", keywords="arbitration section 9 interim measures injunction deposit asset arbitral")

D("arbitration-s11", "commercial", "Appointment of Arbitrator — Section 11",
  "Application to the High Court / Supreme Court for appointment of an arbitrator.",
  doc="Application under Section 11 of the Arbitration and Conciliation Act, 1996", forum="High Court / Supreme Court (international commercial arbitration)", parties="applicant",
  statutes=[S("Section 11, Arbitration and Conciliation Act 1996", "Appointment of arbitrators"),
            S("Section 21, Arbitration and Conciliation Act 1996", "Commencement of arbitral proceedings on receipt of the request to refer the dispute")],
  limitation="Generally treated as three years from failure of the other side to appoint or respond, read with the claim's own limitation (Supreme Court decisions applying Article 137) — verify before filing.",
  pre=["Send a notice invoking arbitration and naming your nominee or proposing names; wait for the contractual/statutory period to lapse.", "Check the seat, number of arbitrators and appointment procedure in the clause."],
  facts=[F("clause", "Arbitration clause — text or clause no.", "", "textarea"), F("invocation", "Notice invoking arbitration — date and service", "", "textarea"),
         F("nonresponse", "Respondent's failure or refusal to appoint", "", "textarea"), F("seat", "Seat / venue of arbitration"), F("claim", "Nature and value of the claims", "", "textarea")],
  outline=["The agreement and the arbitration clause", "The dispute and the claims", "Invocation and the respondent's failure to act", "Request for appointment"],
  grounds=["A valid arbitration agreement exists and disputes have arisen under it.", "The respondent failed to appoint / concur in the appointment of an arbitrator within the time provided.", "The court's role at this stage is confined to a prima facie examination of the existence of the agreement — verify current Supreme Court position."],
  prayers=["Appoint a sole arbitrator / constitute an arbitral tribunal to adjudicate the disputes between the parties.", "Award costs."],
  annex=["Agreement with arbitration clause", "Notice invoking arbitration and proof of service", "Reply, if any"], cautions=[COMMON_CAUTION_VERIFY],
  verification="affidavit", keywords="arbitration appoint arbitrator section 11 high court sole arbitrator clause")

D("arbitration-s34", "commercial", "Setting Aside an Arbitral Award — Section 34",
  "Application to set aside a domestic arbitral award.",
  doc="Application under Section 34 of the Arbitration and Conciliation Act, 1996", forum="Court as defined in s.2(1)(e) of the Act", parties="applicant",
  statutes=[S("Section 34, Arbitration and Conciliation Act 1996", "Application for setting aside an arbitral award"),
            S("Section 34(3)", "Three months from receipt of the award, extendable by a further thirty days on sufficient cause, but not thereafter")],
  limitation="Three months from receipt of the award (or disposal of a s.33 request); the court may condone up to thirty days more — no further condonation.",
  pre=["Calendar the three-month and thirty-day outer limits from the date the signed award was received.", "Map each ground to the statutory grounds in s.34(2) / (2A) — the court does not re-appreciate the merits."],
  facts=[F("award", "Award — date, tribunal, operative direction", "", "textarea"), F("received", "Date the award was received", "", "date"),
         F("grounds_detail", "Specific grounds under s.34(2)/(2A) relied on", "", "textarea"), F("amount", "Amount awarded against the applicant (Rs.)")],
  outline=["The agreement, the proceedings and the award", "Date of receipt of the award and limitation", "The specific grounds for setting aside"],
  grounds=["The application is within the period in Section 34(3).", "The award is liable to be set aside on the grounds available under Section 34(2) / 34(2A): [state each ground with the corresponding part of the award]."],
  prayers=["Set aside the arbitral award dated [date].", "Stay the operation of the award pending disposal, subject to conditions the Court may impose.", "Award costs."],
  annex=["Arbitration agreement", "Award", "Proof of date of receipt", "Pleadings before the tribunal"], cautions=[COMMON_CAUTION_VERIFY, "Do not argue errors of fact — confine grounds to those the Act allows."],
  verification="affidavit", keywords="arbitration award set aside section 34 challenge arbitral tribunal")

D("dissolution-partnership-44", "commercial", "Dissolution of Partnership Firm by Court",
  "Suit for dissolution of a partnership and accounts.",
  doc="Suit for Dissolution of Partnership and Rendition of Accounts", forum="Civil Court / Commercial Court", parties="plaintiff",
  statutes=[S("Section 44, Indian Partnership Act 1932", "Dissolution by the court on the grounds listed there, including just and equitable grounds"),
            S("Section 69, Indian Partnership Act 1932", "Bar on suits by or on behalf of an unregistered firm or its partners"),
            S("Section 48, Indian Partnership Act 1932", "Mode of settling accounts on dissolution")],
  limitation="Check the claim's Article; accounts claims run from specific triggers — verify.",
  pre=["Check whether the firm is registered — s.69 restricts suits in respect of unregistered firms.", "Gather the partnership deed, capital contributions and books of account."],
  facts=[F("firm", "Firm name, date of partnership deed and registration status"), F("partners", "Partners and profit-sharing ratio", "", "textarea"),
         F("ground", "Ground for dissolution under s.44", "Misconduct, breach, deadlock, loss, just and equitable", "textarea"), F("accounts", "Accounts / amounts claimed", "", "textarea")],
  outline=["The firm and the partnership deed", "The parties and their contributions", "The conduct / circumstances warranting dissolution", "Accounts and assets"],
  grounds=["The circumstances fall within Section 44: [state the specific clause of s.44].", "It is just and equitable that the firm be dissolved and accounts taken.", "The suit is maintainable notwithstanding s.69 because [the firm is registered / the relief sought is within the exceptions in s.69(3)]."],
  prayers=["Dissolve the firm {{firm}} with effect from the date of the decree.", "Direct the taking of accounts and distribution of assets after settling liabilities.", "Appoint a receiver pending the suit, if needed.", "Award costs."],
  annex=["Partnership deed", "Registration certificate (if any)", "Books of account / statements"], cautions=[SUIT_STAT_NOTE],
  sections=[JURIS_SEC, COA_SEC, COURT_FEE_SEC], verification="verification", keywords="partnership dissolution firm accounts partner deed dispute business")

D("company-oppression-241", "commercial", "Oppression & Mismanagement (NCLT)",
  "Petition by shareholders before the NCLT against oppression or mismanagement.",
  doc="Petition under Sections 241–242 of the Companies Act, 2013", forum="National Company Law Tribunal", parties="petitioner",
  statutes=[S("Section 241, Companies Act 2013", "Application to the Tribunal for relief in cases of oppression and mismanagement"),
            S("Section 242, Companies Act 2013", "Powers of the Tribunal"),
            S("Section 244, Companies Act 2013", "Right to apply (company with share capital) — not less than one hundred members or one-tenth of the total number of members, whichever is less, or members holding at least one-tenth of the issued share capital; the Tribunal may waive the requirement")],
  limitation="The Act does not prescribe a period for s.241; delay and continuing wrong are examined case by case — verify.",
  pre=["Check that the petitioners meet the eligibility thresholds in s.244 or seek a waiver.", "Gather statutory registers, annual returns, board minutes and evidence of the acts complained of."],
  facts=[F("company", "Company name and CIN"), F("holding", "Petitioner's shareholding and total capital", "", "textarea"),
         F("acts", "Acts of oppression / mismanagement complained of", "", "textarea"), F("relief", "Relief sought", "", "textarea")],
  outline=["The company, its capital and its management", "The petitioner's shareholding and eligibility", "The acts of oppression / mismanagement, with dates", "Prejudice to the petitioner and the company"],
  grounds=["The affairs of the company are being conducted in a manner prejudicial to the interests of the company / oppressive to the members.", "The facts would justify a winding-up order on just and equitable grounds, but such an order would unfairly prejudice the members — [state basis].", "The petitioner satisfies the eligibility requirement of Section 244."],
  prayers=["Grant relief under Section 242 including {{relief}}.", "Award costs."],
  annex=["Share certificates / register extracts", "Board and general meeting minutes", "MCA records / balance sheets"], cautions=[COMMON_CAUTION_VERIFY],
  verification="affidavit", keywords="company oppression mismanagement nclt shareholder minority director companies act")

D("notice-recovery-demand", "commercial", "Legal Notice — Recovery of Money",
  "Demand notice before a recovery suit or complaint.",
  doc="Legal Notice for Recovery of Rs. [amount]", kind="notice", forum="Debtor (notice stage)", parties="notice",
  statutes=[S("Section 34, CPC 1908", "Interest on decretal amounts"), S("Indian Contract Act 1872", "Sections 73-74 on damages for breach")],
  limitation="Not applicable (notice stage). Note the notice does not itself extend limitation — check the claim's period.", pre=["Compute the principal and interest with dates and enclose the account."],
  facts=[F("contract", "Transaction and date", "", "textarea"), F("amount", "Principal due (Rs.)"), F("due_date", "Due date", "", "date"), F("interest", "Interest claimed", "", "text")],
  outline=["The transaction and the amount", "Demands and default", "Demand to pay within the compliance period"],
  grounds=["The amount is admittedly due and payable and you have failed to pay it despite reminders."],
  prayers=["Pay Rs. {{amount}} with interest at {{interest}} within {{notice_days}} days of receipt, failing which legal proceedings will be initiated at your risk as to cost and consequences."],
  annex=[], cautions=[COMMON_CAUTION_VERIFY], keywords="notice recovery money demand debt payment legal notice dues")

D("notice-cheque-138", "criminal", "Legal Notice — Dishonoured Cheque (s.138 NI Act)",
  "Statutory demand notice after a cheque is returned unpaid.",
  doc="Statutory Notice under Section 138 (proviso (b)) of the Negotiable Instruments Act, 1881", kind="notice", forum="Drawer of the cheque (notice stage)", parties="notice",
  statutes=[S("Section 138 proviso (b), NI Act 1881", "Notice to the drawer must be given within thirty days of receiving information from the bank of the dishonour"),
            S("Section 138 proviso (c), NI Act 1881", "The drawer has fifteen days from receipt of the notice to make payment"),
            S("Section 142(1)(b), NI Act 1881", "The complaint must be filed within one month of the date on which the cause of action arises (i.e. after the fifteen days lapse)")],
  limitation="Notice: within 30 days of the bank's dishonour intimation. Payment window: 15 days from receipt. Complaint: within one month after that window ends (condonable on sufficient cause under s.142(1) proviso).",
  pre=["Confirm the cheque was presented within its validity period (three months, per the RBI norm) and returned unpaid.", "Calendar the 30-day notice deadline from the date of the return memo intimation, not from the cheque date."],
  facts=[F("cheque", "Cheque no., date, bank and amount"), F("return_date", "Date of dishonour / return memo", "", "date"), F("return_reason", "Reason for return", "Funds insufficient / account closed / payment stopped", "text"),
         F("liability", "Debt or liability the cheque was issued for", "", "textarea")],
  outline=["The debt or liability and the cheque issued", "Presentation and dishonour", "Statutory demand for payment within fifteen days"],
  grounds=["The cheque was issued in discharge of a legally enforceable debt or liability and has been dishonoured.", "This notice is given within thirty days of the client receiving information of the dishonour."],
  prayers=["Pay the cheque amount (Rs.) within fifteen days of receipt of this notice, failing which the client will initiate prosecution under Section 138 of the Negotiable Instruments Act, 1881 and civil proceedings."],
  annex=[], cautions=["Serve the notice by a mode that gives proof of delivery; the fifteen days run from receipt.", "Quote the cheque details and the return memo exactly; errors weaken the complaint.", COMMON_CAUTION_VERIFY],
  keywords="notice cheque bounce dishonour 138 negotiable instruments demand")

D("complaint-police-cheating", "criminal", "Police Complaint — Cheating / Criminal Breach of Trust",
  "Written complaint to the police for cheating, fraud or breach of trust.",
  doc="Complaint to the Station House Officer for Registration of FIR (BNS — Cheating / Criminal Breach of Trust)", forum="Station House Officer / Superintendent of Police", parties="complainant",
  statutes=[S("Section 173, BNSS 2023", "Information in cognizable cases — FIR, including electronic information and the remedy of approaching the Superintendent of Police if the officer refuses (earlier ss.154, 154(3) CrPC)"),
            S("Bharatiya Nyaya Sanhita 2023", "Offences of cheating and criminal breach of trust — identify the exact BNS sections against the corresponding IPC ones before citing")],
  limitation="Offences such as cheating attract limitation for taking cognizance under the BNSS limitation provisions (earlier CrPC ss.467-473) — verify.",
  pre=["Check whether the dispute is purely civil (contractual) — police may decline a purely civil dispute; plead the criminal element (dishonest intention at inception).", "Attach documents proving the representation, the payment and the deception."],
  facts=[F("incident", "What happened — dates, amounts, persons", "", "textarea"), F("amount", "Amount lost (Rs.)"), F("evidence", "Documents and witnesses", "", "textarea"), F("accused_details", "Details of the persons complained against", "", "textarea")],
  outline=["The complainant and the accused", "The representation made and the inducement", "Payment / entrustment and the dishonest conduct", "The loss caused"],
  grounds=["The facts disclose cognizable offences and an FIR must be registered.", "The accused had a dishonest intention from the beginning [or misappropriated property entrusted to them]."],
  prayers=["Register an FIR under the appropriate provisions of the Bharatiya Nyaya Sanhita, 2023.", "Investigate and take action in accordance with law."],
  annex=["Payment proofs", "Messages / emails / agreement", "Identity proof of complainant"], cautions=[COMMON_CAUTION_VERIFY],
  verification="verification", keywords="cheating fraud fir police complaint breach of trust bns 318 316 misappropriation")


# ═════════════════════════════════════════════════════════════════════
#  6. BANKING & INSOLVENCY
# ═════════════════════════════════════════════════════════════════════
IBC_NOTE = ("Section 10A bars applications for defaults arising on or after 25 March 2020 for one year (until 25 March 2021) — check the date of default. "
            "The default threshold is Rs. 1 crore (raised from Rs. 1 lakh in March 2020) — verify it is unchanged.")

D("ibc-operational-creditor-s9", "banking", "IBC — Operational Creditor's Application (s.9)",
  "Insolvency application by an operational creditor after a demand notice goes unpaid.",
  doc="Application under Section 9 of the Insolvency and Bankruptcy Code, 2016", forum="National Company Law Tribunal", parties="applicant",
  statutes=[S("Section 8, IBC 2016", "Demand notice by an operational creditor; the corporate debtor has ten days to pay or show a pre-existing dispute"),
            S("Section 9, IBC 2016", "Application to initiate CIRP after the ten-day period lapses"),
            S("Section 4, IBC 2016", "Minimum default of Rs. 1 crore for the Code to apply")],
  limitation="Three years from the date of default (Article 137, Limitation Act as applied to IBC applications); s.18 Limitation Act acknowledgments may extend — verify.",
  pre=["Serve the demand notice (Form 3 or 4 of the Adjudicating Authority Rules) and wait ten days.", "Check for a pre-existing dispute — a genuine dispute defeats the application.", "Obtain the certificate from the operational creditor's bank (or an affidavit) on non-receipt of payment."],
  facts=[F("debtor", "Corporate debtor — name and CIN"), F("debt", "Operational debt — nature, invoices, amount and date of default", "", "textarea"),
         F("demand_notice", "Demand notice — date, mode, proof of service", "", "textarea"), F("dispute_status", "Any reply / dispute raised by the corporate debtor", "", "textarea")],
  outline=["The corporate debtor and the operational creditor", "The operational debt and the date of default", "The s.8 demand notice and the response", "Absence of a pre-existing dispute", "Limitation and the threshold"],
  grounds=["The applicant is an operational creditor and the debt is an operational debt exceeding Rs. 1 crore.", "The debtor did not pay within ten days of the demand notice nor raised a pre-existing dispute.", "The application is within limitation."],
  prayers=["Admit the application and initiate the corporate insolvency resolution process against the corporate debtor.", "Appoint an interim resolution professional."],
  annex=["Invoices / contract", "s.8 demand notice and proof of delivery", "Bank certificate / affidavit under s.9(3)(c)", "Record of default"],
  cautions=[IBC_NOTE, "IBC is not a recovery mechanism — expect scrutiny of any genuine dispute."], verification="affidavit",
  keywords="ibc insolvency operational creditor section 9 nclt corporate debtor demand notice")

D("ibc-financial-creditor-s7", "banking", "IBC — Financial Creditor's Application (s.7)",
  "Insolvency application by a financial creditor upon default.",
  doc="Application under Section 7 of the Insolvency and Bankruptcy Code, 2016", forum="National Company Law Tribunal", parties="applicant",
  statutes=[S("Section 7, IBC 2016", "Initiation of CIRP by a financial creditor"),
            S("Section 3(11), IBC 2016", "Definition of 'default'"), S("Section 4, IBC 2016", "Minimum default threshold")],
  limitation="Three years from the date of default (Article 137, Limitation Act); acknowledgment under s.18 may extend — verify.",
  pre=["Obtain records of default from an information utility or other evidence in the prescribed form.", "Note the special thresholds for real-estate allottees and other class applicants — verify Section 7(1) provisos."],
  facts=[F("debtor", "Corporate debtor — name and CIN"), F("facility", "Financial debt — facility, sanction, disbursal", "", "textarea"), F("default_date", "Date of default", "", "date"),
         F("amount", "Amount of default (Rs.)"), F("security", "Security held", "", "text")],
  outline=["The corporate debtor and the financial creditor", "The facility and disbursal", "The default and its date", "Limitation and threshold"],
  grounds=["A financial debt exists and default has occurred for an amount above the threshold.", "The application is within limitation and complete."],
  prayers=["Admit the application and initiate CIRP; appoint an interim resolution professional."],
  annex=["Loan agreement and sanction letter", "Statement of account", "Record of default (information utility)", "Recall / demand notice"], cautions=[IBC_NOTE],
  verification="affidavit", keywords="ibc insolvency financial creditor section 7 bank default nclt cirp")

D("ibc-reply-demand-notice", "banking", "Reply to IBC Demand Notice (Pre-Existing Dispute)",
  "Reply by a corporate debtor to a s.8 demand notice.",
  doc="Reply to Demand Notice under Section 8 of the Insolvency and Bankruptcy Code, 2016", kind="reply", forum="Operational Creditor (reply within ten days)", parties="notice",
  statutes=[S("Section 8(2), IBC 2016", "The corporate debtor must, within ten days, bring to the creditor's notice the existence of a dispute or the repayment of the debt")],
  limitation="Ten days from receipt of the demand notice.", pre=["Reply within ten days and attach proof of the dispute existing before the demand notice was served."],
  facts=[F("dispute", "Nature of the dispute and dates", "", "textarea"), F("proof", "Proof of the pre-existing dispute", "Emails, suits, arbitration notice, complaints", "textarea")],
  outline=["Acknowledgment of the notice", "Existence of the dispute before the notice", "Denial of liability and reasons"],
  grounds=["A dispute existed between the parties prior to the receipt of the demand notice, as evidenced by [documents]."],
  prayers=["Withdraw the demand notice."], annex=[], cautions=[IBC_NOTE], keywords="ibc reply demand notice dispute section 8 corporate debtor")

D("drt-oa-19", "banking", "DRT — Original Application by Bank (s.19)",
  "Bank / financial institution's recovery application before the Debts Recovery Tribunal.",
  doc="Original Application under Section 19 of the Recovery of Debts and Bankruptcy Act, 1993", forum="Debts Recovery Tribunal", parties="applicant",
  statutes=[S("Section 19, RDB Act 1993", "Application to the Tribunal by a bank or financial institution for recovery of debts due"),
            S("Section 17, RDB Act 1993", "Jurisdiction of the Tribunals"),
            S("Section 20 and s.21, RDB Act 1993", "Appeal to the DRAT within thirty days; pre-deposit of fifty per cent, reducible by the DRAT to twenty-five per cent")],
  limitation="Governed by the Limitation Act — check the article (e.g. from default / recall of the facility); verify.",
  pre=["Check that the debt meets the minimum amount notified under the Act (currently notified as Rs. 20 lakh — verify).", "Assemble the loan documents, security documents and the bank's statement with a certificate under the Bankers' Books Evidence Act."],
  facts=[F("borrower", "Borrower(s) and guarantor(s)", "", "textarea"), F("facility", "Facility — sanction, limits, security", "", "textarea"), F("amount", "Amount due (Rs.) with computation", ""),
         F("npa_date", "Date of NPA classification / recall", "", "date")],
  outline=["The bank and the borrowers", "The facilities and security", "The default and NPA classification", "Computation of the amount due", "Interest claimed"],
  grounds=["The defendants availed the facility and defaulted; the account was classified as NPA on [date].", "The applicant is entitled to recover the debt with interest and to enforce the security."],
  prayers=["Issue a recovery certificate for Rs. {{amount}} with interest till realisation.", "Declare the applicant's charge over the securities and allow their sale.", "Award costs."],
  annex=["Sanction letters and loan agreement", "Security documents", "Statement of account with certificate", "Recall notice"], cautions=[COMMON_CAUTION_VERIFY],
  verification="affidavit", keywords="drt debts recovery tribunal bank recovery application loan default npa section 19")

D("sarfaesi-s17", "banking", "SARFAESI — Securitisation Application (s.17)",
  "Borrower's challenge to a bank's enforcement measures before the DRT.",
  doc="Securitisation Application under Section 17 of the SARFAESI Act, 2002", forum="Debts Recovery Tribunal", parties="applicant",
  statutes=[S("Section 13(2), SARFAESI Act 2002", "Demand notice giving sixty days to discharge liability"),
            S("Section 13(3A), SARFAESI Act 2002", "The secured creditor must consider the borrower's representation and communicate its reasons for non-acceptance"),
            S("Section 13(4), SARFAESI Act 2002", "Enforcement measures on non-payment"),
            S("Section 17, SARFAESI Act 2002", "Application to the DRT against measures taken under s.13(4), within forty-five days"),
            S("Section 18, SARFAESI Act 2002", "Appeal to the DRAT, subject to pre-deposit")],
  limitation="Forty-five days from the date of the s.13(4) measure (Supreme Court decisions treat the period as strict, subject to condonation as the Act allows) — verify.",
  pre=["Identify which s.13(4) measure has been taken and its date (possession notice, symbolic possession, sale notice).", "Check the s.13(2) notice: sixty days given, contents complete, and the borrower's representation answered as s.13(3A) requires."],
  facts=[F("bank", "Secured creditor (bank) and branch"), F("notice_2", "s.13(2) demand notice — date and amount claimed", "", "text"),
         F("measure", "s.13(4) measure taken and date", "Symbolic / physical possession, auction date", "textarea"), F("defects", "Illegality alleged in the bank's action", "", "textarea"), F("security", "Secured asset", "", "textarea")],
  outline=["The borrower, the facility and the security", "The s.13(2) demand notice and the borrower's representation", "The s.13(4) measure taken", "Illegality / irregularity in the process"],
  grounds=["The measures are contrary to the procedure in Section 13 and the SARFAESI Rules 2002.", "The application is filed within forty-five days of the s.13(4) measure.", "[Specific defects: e.g. notice not given, wrong amount, representation not answered, sale notice defects.]"],
  prayers=["Set aside the measures under Section 13(4) and restore possession.", "Stay the auction / sale pending disposal.", "Award costs."],
  annex=["Loan sanction and security documents", "s.13(2) notice and reply", "Possession / auction notice", "Statement of account"], cautions=[COMMON_CAUTION_VERIFY, "The DRT's power to stay depends on facts — be ready to show a prima facie case and, where required, deposit."],
  verification="affidavit", keywords="sarfaesi section 17 section 13(4) possession auction bank drt securitisation borrower")

D("sarfaesi-13-2-reply", "banking", "Reply to SARFAESI Demand Notice (s.13(2))",
  "Borrower's representation to a bank's s.13(2) notice.",
  doc="Reply / Representation to Notice under Section 13(2) of the SARFAESI Act, 2002", kind="reply", forum="Secured creditor (bank)", parties="notice",
  statutes=[S("Section 13(2), SARFAESI Act 2002", "Sixty-day demand notice"), S("Section 13(3A), SARFAESI Act 2002", "Bank must consider the objections and give reasons if it does not accept them")],
  limitation="Within the sixty-day period of the notice.", pre=["Reply before the sixty days lapse; the bank must answer with reasons under s.13(3A)."],
  facts=[F("objection", "Objections to the amount and the account", "", "textarea"), F("proposal", "Repayment proposal or request for restructuring, if any", "", "textarea")],
  outline=["Acknowledgment of the notice", "Objections to the amount claimed / classification", "Repayment proposal"], grounds=["The amount claimed is incorrect because [reasons]."],
  prayers=["Reconsider the notice, communicate reasons for non-acceptance of these objections under s.13(3A), and refrain from enforcement while the representation is considered."], annex=[], cautions=[COMMON_CAUTION_VERIFY],
  keywords="sarfaesi reply demand notice 13(2) representation bank loan npa")

# ═════════════════════════════════════════════════════════════════════
#  7. EMPLOYMENT & LABOUR
# ═════════════════════════════════════════════════════════════════════
LABOUR_CODE_NOTE = ("The four Labour Codes (Code on Wages 2019, Industrial Relations Code 2020, Code on Social Security 2020, OSH Code 2020) came into force on 21 November 2025, "
                    "replacing the earlier statutes. Section numbers, forums and rules are still settling — check the current text and the State rules before citing any section.")

D("labour-dues-claim", "employment", "Claim for Unpaid Wages / Gratuity / Dues",
  "Claim by an employee for wages, bonus, gratuity, notice pay or other dues.",
  doc="Application / Claim for Recovery of Employment Dues", forum="Competent authority under the labour codes / Labour Court", parties="claimant",
  statutes=[S("Code on Wages 2019", "Payment of wages, minimum wages, bonus and equal remuneration — check current sections"),
            S("Code on Social Security 2020", "Gratuity and other social security benefits — check current sections"),
            S("Industrial Relations Code 2020", "Dispute resolution machinery — check current sections")],
  limitation="Codes prescribe specific periods for wage and gratuity claims — check the current text.", pre=["Collect appointment letter, payslips, bank statements, relieving/termination letter and the employer's response."],
  facts=[F("employer", "Employer and establishment details", "", "textarea"), F("service", "Designation, date of joining, date of leaving", "", "textarea"), F("dues", "Dues claimed — head and amount", "Wages, bonus, notice pay, gratuity, leave encashment", "textarea"), F("efforts", "Demands made to the employer", "", "textarea")],
  outline=["Employment details", "Terms of pay and payslips", "The dues and their computation", "Demands and the employer's default"],
  grounds=["The claimant was an employee of the respondent and is entitled to the dues listed above.", "The respondent has failed to pay despite demands."], prayers=["Direct the respondent to pay the dues of Rs. [amount] with interest / compensation as provided by law.", "Award costs."],
  annex=["Appointment letter", "Payslips / bank statements", "Termination / resignation documents", "Demand correspondence"], cautions=[LABOUR_CODE_NOTE], verification="affidavit",
  keywords="salary wages unpaid gratuity bonus dues employee employer labour termination notice pay")

D("industrial-dispute-termination", "employment", "Wrongful Termination / Retrenchment Dispute",
  "Employee's reference or claim against dismissal or retrenchment.",
  doc="Statement of Claim — Wrongful Termination / Retrenchment", forum="Industrial Tribunal / Labour Court (through conciliation as the Code requires)", parties="claimant",
  statutes=[S("Industrial Relations Code 2020", "Retrenchment, lay-off, dismissal, conciliation and adjudication — check current sections for procedure and limits"),
            S("Article 14 and 21, Constitution of India", "Fair procedure — for public-sector employers")],
  limitation="The Code prescribes time limits for raising disputes — check the current text.", pre=["Check whether the person is a 'worker' under the Code and whether the establishment meets thresholds for retrenchment procedure.", "Gather the termination letter, enquiry records and last-drawn pay."],
  facts=[F("employer", "Employer and establishment"), F("service", "Designation, date of joining, last-drawn salary", "", "textarea"), F("termination", "Termination — date, reason and procedure followed", "", "textarea"), F("relief", "Relief sought", "Reinstatement with back wages / compensation", "text")],
  outline=["The workman and the establishment", "Terms of service and record", "The termination and the procedure followed", "Breach of the statutory conditions"],
  grounds=["The termination is illegal and unjustified as [no enquiry / no notice or compensation / victimisation / violation of the statutory conditions].", "The claimant was not gainfully employed after termination."],
  prayers=["Set aside the termination and direct reinstatement with continuity of service and back wages.", "In the alternative, direct compensation as the law provides."], annex=["Appointment and termination letters", "Payslips", "Enquiry records"],
  cautions=[LABOUR_CODE_NOTE], verification="affidavit", keywords="termination dismissal retrenchment wrongful reinstatement back wages industrial dispute labour court")

D("notice-employer-dues", "employment", "Legal Notice to Employer — Dues / Termination",
  "Notice demanding unpaid salary, dues or reinstatement.",
  doc="Legal Notice to Employer", kind="notice", forum="Employer (notice stage)", parties="notice",
  statutes=[S("Code on Wages 2019", "Payment of wages — check current sections"), S("Industrial Relations Code 2020", "Termination and dispute resolution — check current sections")],
  limitation="Not applicable (notice stage).", pre=["Attach the salary computation and the termination letter."],
  facts=[F("service", "Designation, date of joining, last salary", "", "textarea"), F("dues", "Dues claimed (heads and amounts)", "", "textarea"), F("termination", "Termination details, if any", "", "textarea")],
  outline=["Employment particulars", "The dues and termination", "Demand"], grounds=["The client is entitled to the dues claimed and the termination was [illegal / without notice]."],
  prayers=["Pay the dues within {{notice_days}} days, failing which the client will initiate proceedings before the competent forum."], annex=[], cautions=[LABOUR_CODE_NOTE],
  keywords="notice employer salary dues termination unpaid legal notice employee")

D("reply-show-cause-charge-sheet", "employment", "Reply to Show-Cause Notice / Charge-Sheet",
  "Employee's reply in a disciplinary matter.",
  doc="Reply to Show-Cause Notice / Charge-Sheet", kind="reply", forum="Disciplinary authority / employer", parties="notice",
  statutes=[S("Principles of natural justice", "Notice, opportunity to explain, access to documents, unbiased enquiry"),
            S("Standing Orders / service rules applicable to the employer", "Identify the exact rule the charge is framed under")],
  limitation="Within the time allowed by the notice.", pre=["Ask for copies of documents relied on if not supplied and reserve the right to supplement the reply."],
  facts=[F("charge", "Allegations in the notice", "", "textarea"), F("defence", "Defence and explanation", "", "textarea"), F("documents", "Documents requested / relied on", "", "textarea")],
  outline=["Acknowledgment", "Reply to each allegation", "Request for documents and a fair enquiry"], grounds=["The allegations are denied for the reasons stated.", "The procedure does not meet the standards of natural justice: [state defects]."],
  prayers=["Drop the proceedings / exonerate the employee.", "Alternatively, supply documents and hold a fair domestic enquiry."], annex=[], cautions=[COMMON_CAUTION_VERIFY], keywords="show cause notice charge sheet reply disciplinary domestic enquiry employee")

D("posh-complaint", "employment", "Sexual Harassment at Workplace — Complaint (POSH Act)",
  "Written complaint to the Internal Committee / Local Committee.",
  doc="Complaint under the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013", forum="Internal Committee / Local Committee", parties="complainant",
  statutes=[S("Section 4, POSH Act 2013", "Constitution of the Internal Committee"), S("Section 9, POSH Act 2013", "Complaint in writing within three months of the incident (or last incident), extendable by a further three months for reasons recorded"),
            S("Section 12, POSH Act 2013", "Interim relief during the inquiry"), S("Section 18, POSH Act 2013", "Appeal within ninety days")],
  limitation="Three months from the incident (or last incident in a series); the committee may extend by another three months for recorded reasons.",
  pre=["Draft the complaint factually: dates, places, words and acts, witnesses; avoid characterisation.", "Check that the employer has constituted the ICC; if not, approach the Local Committee."],
  facts=[F("respondent", "Respondent — name, designation, department"), F("incidents", "Incidents — dates, places, what happened", "", "textarea"), F("witnesses", "Witnesses / evidence", "", "textarea"), F("interim", "Interim relief requested", "Change of reporting, transfer, leave", "text")],
  outline=["The complainant and the respondent", "Chronology of incidents", "Evidence and witnesses", "Impact and interim relief"],
  grounds=["The conduct described constitutes sexual harassment within the meaning of the Act.", "The complaint is within the three-month period of Section 9 (or a delay is explained)."],
  prayers=["Inquire into the complaint and recommend action under the Act.", "Grant interim relief during the inquiry."], annex=["Messages / emails / documents", "Witness particulars"],
  cautions=["The Act protects confidentiality — do not circulate the complaint publicly.", COMMON_CAUTION_VERIFY], verification="verification", keywords="posh sexual harassment workplace internal committee complaint women icc")

D("service-matter-cat", "employment", "Service Matter — Tribunal / High Court",
  "Government-employee grievances: promotion, seniority, pay, pension, punishment.",
  doc="Original Application under Section 19 of the Administrative Tribunals Act, 1985 (or writ petition)", forum="Central/State Administrative Tribunal / High Court", parties="applicant",
  statutes=[S("Section 19, Administrative Tribunals Act 1985", "Application to the Tribunal by a person aggrieved by any order pertaining to a grievance"),
            S("Section 20, Administrative Tribunals Act 1985", "Exhaustion of departmental remedies"),
            S("Section 21, Administrative Tribunals Act 1985", "Limitation — one year from the final order, or six months after the period for a representation lapses")],
  limitation="One year from the final order; where a representation has not been decided, six months after six months from the representation (s.21) — verify.",
  pre=["Check whether the matter falls within the Tribunal's jurisdiction or is a State matter for the High Court.", "File a departmental representation first and record its date."],
  facts=[F("post", "Post, department, date of joining", "", "text"), F("order", "Impugned order / action — date and effect", "", "textarea"), F("representation", "Representations made and outcome", "", "textarea"), F("relief", "Relief sought", "", "textarea")],
  outline=["The applicant's service record", "The impugned order / action", "Representations made", "Illegality / arbitrariness"],
  grounds=["The impugned action violates the applicable service rules and Articles 14 and 16 of the Constitution.", "The application is within limitation under Section 21."],
  prayers=["Quash the impugned order and direct consequential benefits.", "Award costs."], annex=["Appointment order and service book extracts", "Impugned order", "Representation"], cautions=[COMMON_CAUTION_VERIFY],
  verification="affidavit", keywords="service matter promotion seniority pension pay government employee tribunal cat writ")


# ═════════════════════════════════════════════════════════════════════
#  8. IP, CYBER & TECHNOLOGY
# ═════════════════════════════════════════════════════════════════════
IP_SUIT_NOTE = ("Suits on IP rights are usually 'commercial disputes' — the Commercial Courts Act, including s.12A pre-institution mediation unless urgent interim relief is sought, may apply; verify.")

D("trademark-infringement-suit", "ip_cyber", "Trademark Infringement & Passing Off Suit",
  "Suit for injunction, damages and rendition of accounts against infringement or passing off.",
  doc="Plaint for Permanent Injunction, Damages and Rendition of Accounts — Trademark Infringement and Passing Off", forum="District Court / Commercial Court / High Court (original side)", parties="plaintiff",
  statutes=[S("Section 29, Trade Marks Act 1999", "Infringement of registered trademarks"), S("Section 134, Trade Marks Act 1999", "Jurisdiction — the court where the plaintiff resides or carries on business, in addition to the general rule"),
            S("Section 135, Trade Marks Act 1999", "Reliefs in infringement and passing-off suits"), S("Order XXXIX Rules 1 and 2, CPC", "Interim injunctions")],
  limitation="Continuing infringement gives a recurring cause of action; delay and acquiescence still affect interim relief — verify.",
  pre=["Collect registration certificates, proof of use since adoption, sales figures and evidence of the defendant's use.", "Check whether the defendant has a registration or prior use."],
  facts=[F("mark", "Plaintiff's mark(s) — registration no., class, date of first use", "", "textarea"), F("defendant_use", "Defendant's mark and use", "", "textarea"), F("similarity", "Similarity — visual, phonetic, trade channels", "", "textarea"),
         F("confusion", "Evidence of confusion or deception", "", "textarea"), F("goodwill", "Goodwill and turnover of the plaintiff", "", "textarea")],
  outline=["The plaintiff and its mark", "Adoption, use and goodwill", "The defendant's impugned use", "Similarity and likelihood of confusion", "Loss and injury"],
  grounds=["The defendant's mark is deceptively similar to the plaintiff's registered mark for identical / similar goods, amounting to infringement.", "The defendant's use passes off the defendant's goods as the plaintiff's.", "Irreparable injury and balance of convenience favour interim injunction."],
  prayers=["Restrain the defendant from using the impugned mark or any deceptively similar mark.", "Direct rendition of accounts and payment of profits / damages.", "Direct delivery up of infringing material.", "Award costs."],
  annex=["Registration certificates", "Proof of use and sales", "Evidence of the defendant's use", "Legal notice, if issued"], cautions=[IP_SUIT_NOTE, SUIT_STAT_NOTE],
  sections=[JURIS_SEC, COA_SEC, COURT_FEE_SEC], verification="verification", keywords="trademark infringement passing off brand name logo deceptively similar injunction")

D("trademark-opposition", "ip_cyber", "Trademark Opposition",
  "Notice of opposition to a trademark advertised in the Trade Marks Journal.",
  doc="Notice of Opposition under Section 21 of the Trade Marks Act, 1999", forum="Registrar of Trade Marks", parties="applicant",
  statutes=[S("Section 21, Trade Marks Act 1999", "Notice of opposition within three months of the advertisement, extendable by up to one month"),
            S("Section 9 and Section 11, Trade Marks Act 1999", "Absolute and relative grounds for refusal")],
  limitation="Three months from advertisement in the Journal, extendable by one month on application (s.21(1)).",
  pre=["Note the Journal number and date of advertisement; the deadline runs from that date.", "Gather evidence of your prior use and registrations."],
  facts=[F("impugned", "Impugned application — no., class, mark, applicant"), F("opponent_mark", "Opponent's mark and rights", "", "textarea"), F("grounds_detail", "Grounds — s.9 / s.11 clauses", "", "textarea"), F("journal", "Journal no. and date of advertisement")],
  outline=["The opponent and its rights", "The impugned application", "Grounds of opposition"], grounds=["The impugned mark is liable to be refused under Section [9 / 11] because [reasons]."],
  prayers=["Refuse registration of the impugned application.", "Award costs."], annex=["Journal extract", "Registration certificates", "Proof of use"], cautions=[COMMON_CAUTION_VERIFY],
  verification="affidavit", keywords="trademark opposition registrar journal application brand tm")

D("copyright-infringement-suit", "ip_cyber", "Copyright Infringement Suit",
  "Suit for injunction and damages for infringement of a literary, artistic, musical or software work.",
  doc="Plaint for Permanent Injunction and Damages — Copyright Infringement", forum="District Court / Commercial Court / High Court", parties="plaintiff",
  statutes=[S("Section 51, Copyright Act 1957", "When copyright is infringed"), S("Section 55, Copyright Act 1957", "Civil remedies — injunction, damages, accounts"),
            S("Section 62, Copyright Act 1957", "Jurisdiction — where the plaintiff resides or carries on business")],
  limitation="Generally three years from the infringement; each infringing act may found a fresh cause — verify.",
  pre=["Establish ownership (author, assignment or work-for-hire) and originality; gather the work with date of creation and publication.", "Preserve evidence of the copying with dates."],
  facts=[F("work", "Work in which copyright subsists", "", "textarea"), F("ownership", "Ownership — author / assignment / registration", "", "textarea"), F("infringement", "Infringing acts by the defendant", "", "textarea"), F("loss", "Loss suffered", "", "textarea")],
  outline=["The plaintiff and the work", "Ownership and originality", "The infringing acts", "Loss and injury"],
  grounds=["Copyright subsists in the work and vests in the plaintiff.", "The defendant's acts are within Section 51 and are not covered by any exception in Section 52."],
  prayers=["Restrain the defendant from infringing the plaintiff's copyright.", "Direct damages / accounts of profits.", "Direct delivery up and destruction of infringing copies.", "Award costs."], annex=["Copy of the work and proof of creation", "Assignment deed / registration", "Evidence of infringement"],
  cautions=[IP_SUIT_NOTE, SUIT_STAT_NOTE], sections=[JURIS_SEC, COA_SEC, COURT_FEE_SEC], verification="verification", keywords="copyright infringement piracy work software content music plagiarism suit")

D("patent-infringement-suit", "ip_cyber", "Patent Infringement Suit",
  "Suit for infringement of a granted patent.",
  doc="Plaint for Permanent Injunction and Damages — Patent Infringement", forum="District Court not lower than the specified level / High Court", parties="plaintiff",
  statutes=[S("Section 48, Patents Act 1970", "Rights of patentees"), S("Section 104, Patents Act 1970", "Jurisdiction — no suit below the District Court; counter-claim for revocation goes to the High Court"),
            S("Section 108, Patents Act 1970", "Reliefs in a suit for infringement")],
  limitation="Check the Article of the Limitation Act; continuing infringement may give a recurring cause — verify.",
  pre=["Map each claim of the patent to the defendant's product or process; expect a revocation counter-claim.", "Check patent status (in force, renewal fees paid)."],
  facts=[F("patent", "Patent no., title, grant date and claims relied on", "", "textarea"), F("product", "Defendant's product / process", "", "textarea"), F("mapping", "Claim-by-claim mapping", "", "textarea")],
  outline=["The patent and its claims", "The defendant's product / process", "Infringement — claim-by-claim", "Loss and injury"], grounds=["The defendant's product / process falls within the claims of the plaintiff's patent."],
  prayers=["Restrain the defendant from making, using, selling or importing the infringing product / process.", "Direct damages or account of profits.", "Award costs."], annex=["Patent specification", "Evidence of the defendant's product", "Renewal fee receipts"],
  cautions=[IP_SUIT_NOTE, SUIT_STAT_NOTE], sections=[JURIS_SEC, COA_SEC, COURT_FEE_SEC], verification="verification", keywords="patent infringement suit invention claims product process")

D("notice-ip-cease-desist", "ip_cyber", "Cease & Desist Notice — IP Infringement",
  "Notice to stop trademark / copyright infringement.",
  doc="Cease and Desist Notice", kind="notice", forum="Infringer (notice stage)", parties="notice",
  statutes=[S("Trade Marks Act 1999", "Sections 29 and 135"), S("Copyright Act 1957", "Sections 51 and 55")], limitation="Not applicable (notice stage).",
  pre=["Attach registration details and evidence of the infringing use."], facts=[F("right", "IP right — registration no. / work", "", "textarea"), F("infringement", "Infringing use — what, where, since when", "", "textarea"), F("demands", "Specific demands", "Stop use, take down, account, undertaking", "textarea")],
  outline=["Client's rights", "The infringing use", "Demands and deadline"], grounds=["Your use infringes the client's rights and is likely to cause confusion / dilution."],
  prayers=["Immediately cease the infringing use and give a written undertaking within {{notice_days}} days, failing which the client will seek injunction and damages."], annex=[], cautions=[COMMON_CAUTION_VERIFY],
  keywords="notice cease desist trademark copyright infringement stop use legal notice ip")

D("cyber-fraud-complaint", "ip_cyber", "Cyber Fraud / Online Financial Fraud Complaint",
  "Complaint and bank-dispute letter for UPI, phishing, card, or social-engineering fraud.",
  doc="Complaint regarding Cyber Financial Fraud", forum="Cyber Crime Police / SHO / Bank", parties="complainant",
  statutes=[S("Section 66C, IT Act 2000", "Identity theft"), S("Section 66D, IT Act 2000", "Cheating by personation using a computer resource"),
            S("Bharatiya Nyaya Sanhita 2023", "Cheating and related offences — confirm the BNS section numbers before citing"),
            S("National Cyber Crime Reporting Portal", "Report at cybercrime.gov.in or helpline 1930 — the earlier the report, the better the chance of freezing funds")],
  limitation="Report immediately; banks' liability policies depend on how quickly the customer reports — check the RBI framework and the bank's policy.",
  pre=["Report on the National Cyber Crime Reporting Portal / call 1930 immediately and note the acknowledgment number.", "Inform the bank in writing at once, block the card / UPI / account, and keep screenshots, SMS and transaction IDs."],
  facts=[F("txn", "Transactions — date, time, amount, reference no.", "", "textarea"), F("mode", "How the fraud occurred", "Phishing link, OTP, remote-access app, fake customer care", "textarea"), F("bank", "Bank, account / card no. (last four digits)"), F("ack", "Portal acknowledgment no. / 1930 ticket", "", "text"), F("suspect", "Suspect details — numbers, accounts, links", "", "textarea")],
  outline=["The complainant and the account", "How the fraud occurred", "Transactions and amounts", "Reports made and steps taken"],
  grounds=["The transactions were unauthorised and induced by deception.", "The bank / platform was informed promptly [state timing]."], prayers=["Register an FIR and investigate.", "Freeze the beneficiary accounts and restore the funds.", "Direct the bank to reverse the unauthorised transactions as the applicable framework provides."],
  annex=["Transaction statements / SMS", "Screenshots of links and chats", "Portal acknowledgment", "Copy of the bank complaint"], cautions=["Do not publish identifiers such as card numbers; give last four digits only.", COMMON_CAUTION_VERIFY],
  verification="verification", keywords="cyber fraud upi phishing otp online scam bank account hacked 1930 cybercrime")

D("notice-online-defamation", "ip_cyber", "Legal Notice — Online Defamation / Takedown",
  "Notice demanding removal of defamatory online content and apology.",
  doc="Legal Notice — Defamatory Online Content", kind="notice", forum="Publisher / platform grievance officer", parties="notice",
  statutes=[S("Section 356, BNS 2023", "Defamation (earlier IPC s.499)"), S("Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules 2021", "Grievance redressal by intermediaries — check current rules")],
  limitation="Not applicable (notice stage). Civil and criminal remedies have their own limitation — verify.", pre=["Preserve URLs, screenshots and the date and time of publication; note the reach."],
  facts=[F("content", "Defamatory content — URLs and text", "", "textarea"), F("harm", "Harm to reputation", "", "textarea"), F("demands", "Demands", "Takedown, apology, damages", "textarea")],
  outline=["The client and their reputation", "The impugned publication", "Harm caused", "Demands"], grounds=["The statements are false, defamatory and published without lawful justification."],
  prayers=["Remove the content within {{notice_days}} days and publish an apology, failing which the client will initiate civil and criminal proceedings."], annex=[], cautions=[COMMON_CAUTION_VERIFY],
  keywords="defamation online social media post review takedown notice reputation")

# ═════════════════════════════════════════════════════════════════════
#  9. WRITS, RTI & PUBLIC LAW
# ═════════════════════════════════════════════════════════════════════
D("writ-226", "public", "Writ Petition (Article 226)",
  "Writ of mandamus, certiorari, prohibition, habeas corpus or quo warranto before the High Court.",
  doc="Writ Petition under Article 226 of the Constitution of India", forum="High Court", parties="petitioner",
  statutes=[S("Article 226, Constitution of India", "High Courts' power to issue writs for enforcement of fundamental rights and for any other purpose"),
            S("Article 14 and Article 21, Constitution of India", "Equality before law and protection of life and personal liberty")],
  limitation="No statutory period, but delay and laches can defeat relief — explain any delay; check whether an alternative remedy exists.",
  pre=["Identify the State authority, the impugned order and the fundamental / statutory right infringed.", "Check the alternative remedy and the High Court rules on filing, caveats and affidavits."],
  facts=[F("authority", "Respondent authority and its action", "", "textarea"), F("order", "Impugned order / action — date, effect", "", "textarea"), F("right", "Right infringed", "", "textarea"), F("representation", "Representations made and outcome", "", "textarea"), F("writ_type", "Writ sought", "Mandamus / certiorari / prohibition / habeas corpus", "text")],
  outline=["The parties", "The facts leading to the petition", "The impugned action", "Representations and the absence of an alternative remedy"],
  grounds=["The impugned action is arbitrary, unreasonable and violates Article 14.", "The authority has acted without jurisdiction / contrary to law / in breach of natural justice.", "There is no efficacious alternative remedy, or the case falls within an exception to the rule of alternative remedy."],
  prayers=["Issue a writ of {{writ_type}} quashing / setting aside the impugned action.", "Direct the respondents to [specific direction].", "Grant interim relief pending disposal.", "Award costs."],
  annex=["Impugned order", "Representations and replies", "Relevant documents"], cautions=["Check the High Court's writ rules for the affidavit format and mandatory annexures.", COMMON_CAUTION_VERIFY],
  verification="affidavit", keywords="writ petition article 226 high court mandamus certiorari habeas corpus arbitrary state authority")

D("pil-226-32", "public", "Public Interest Litigation",
  "Petition in public interest under Article 226 / 32.",
  doc="Public Interest Litigation under Article 226 (or Article 32) of the Constitution of India", forum="High Court / Supreme Court", parties="petitioner",
  statutes=[S("Article 226, Constitution of India", "High Court writ jurisdiction"), S("Article 32, Constitution of India", "Supreme Court writ jurisdiction for enforcing fundamental rights")],
  limitation="No period, but courts scrutinise delay and the petitioner's bona fides.", pre=["Check the High Court's PIL rules: the petitioner's credentials, disclosures on prior representations, and the absence of personal interest are examined.", "Attach evidence: reports, RTI replies, photographs."],
  facts=[F("issue", "Public issue and who is affected", "", "textarea"), F("authority", "Authorities responsible and their failure", "", "textarea"), F("efforts", "Representations / RTI / complaints made", "", "textarea"), F("interest", "Petitioner's credentials and absence of personal interest", "", "textarea")],
  outline=["The petitioner and public-spirited credentials", "The public issue", "Statutory / constitutional duty and its breach", "Efforts made before approaching the Court"], grounds=["The issue affects fundamental rights of a large class of persons who cannot approach the Court.", "The respondents have failed to discharge their statutory / constitutional duty."],
  prayers=["Direct the respondents to [specific directions].", "Constitute an expert committee / call for a status report if appropriate.", "Pass further orders as the Court thinks fit."], annex=["Documents and reports", "Representations and replies"], cautions=[COMMON_CAUTION_VERIFY],
  verification="affidavit", keywords="pil public interest litigation article 32 226 public issue environment civic")

D("rti-application", "public", "RTI Application",
  "Request for information from a public authority.",
  doc="Application for Information under Section 6(1) of the Right to Information Act, 2005", kind="rti", forum="Public Information Officer", parties="rti",
  statutes=[S("Section 6(1), RTI Act 2005", "Request for information in writing or electronically"), S("Section 7, RTI Act 2005", "Disposal within thirty days; within forty-eight hours where the information concerns life or liberty"),
            S("Section 8, RTI Act 2005", "Exemptions from disclosure"), S("Section 6(3), RTI Act 2005", "Transfer to the correct public authority within five days")],
  limitation="Not applicable. The PIO must respond within thirty days.", pre=["Frame specific, answerable questions on records held by the authority; the Act gives access to information, not to opinions.", "Check the fee (Central Rules: Rs. 10, waived for BPL applicants) and State rules for State authorities."],
  facts=[F("information", "Information sought — numbered questions", "Ask for copies of records, file notings, orders, dates", "textarea"), F("period", "Period covered", "", "text")],
  outline=["Numbered request for information"], grounds=[], prayers=["Provide the information sought within the period prescribed by Section 7 of the Act."], annex=["Proof of fee payment", "BPL certificate (if claiming exemption)"], cautions=["State RTI rules on fee and mode may differ — verify.", COMMON_CAUTION_VERIFY],
  verification="none", keywords="rti right to information application pio public authority government records")

D("rti-first-appeal", "public", "RTI First Appeal (s.19(1))",
  "Appeal against non-supply, part-supply or rejection of information.",
  doc="First Appeal under Section 19(1) of the Right to Information Act, 2005", forum="First Appellate Authority", parties="appellant",
  statutes=[S("Section 19(1), RTI Act 2005", "First appeal within thirty days from the expiry of the period for reply or the receipt of the decision"), S("Section 19(6), RTI Act 2005", "Disposal within thirty days, extendable to forty-five days")],
  limitation="Thirty days from the decision or from the date on which the reply was due; the appellate authority may admit a late appeal for sufficient cause.", pre=["Attach the RTI application, proof of posting and the PIO's reply (or a statement that none was received)."],
  facts=[F("rti_ref", "RTI application — date and registration no."), F("pio_reply", "PIO's reply and date, or deemed refusal", "", "textarea"), F("grounds_detail", "Why the information should be given", "", "textarea")],
  outline=["The RTI application and the PIO's response", "The information withheld", "Grounds for the appeal"], grounds=["The information sought is not exempt under Section 8 and the refusal is unjustified.", "The PIO did not reply within the time allowed."],
  prayers=["Direct the PIO to furnish the information.", "Recommend appropriate action against the PIO for delay."], annex=["RTI application and postal receipt", "PIO's reply"], cautions=[COMMON_CAUTION_VERIFY], verification="none",
  keywords="rti first appeal 19(1) appellate authority denied information pio")

D("rti-second-appeal", "public", "RTI Second Appeal / Complaint (Information Commission)",
  "Second appeal to the CIC / State Information Commission.",
  doc="Second Appeal under Section 19(3) of the Right to Information Act, 2005", forum="Central / State Information Commission", parties="appellant",
  statutes=[S("Section 19(3), RTI Act 2005", "Second appeal within ninety days of the first appellate decision or the date it should have been made"),
            S("Section 18, RTI Act 2005", "Complaint to the Commission for refusal to accept an application, non-response or other grievances"), S("Section 20, RTI Act 2005", "Penalties for defaulting PIOs")],
  limitation="Ninety days from the first-appeal decision or the date it was due; the Commission may condone delay for sufficient cause.", pre=["Attach the RTI application, first appeal and decisions, with proof of dates."],
  facts=[F("rti_ref", "RTI application and first appeal — dates and numbers", "", "textarea"), F("faa_order", "First Appellate Authority's decision, or date due", "", "textarea"), F("grounds_detail", "Grounds", "", "textarea")],
  outline=["The RTI request and first appeal", "The decision and the grievance", "Grounds of appeal"], grounds=["The denial of the information is contrary to the Act."],
  prayers=["Direct disclosure of the information.", "Impose penalty under Section 20 where applicable.", "Award compensation under Section 19(8)(b) where warranted."], annex=["RTI application", "First appeal and order"], cautions=[COMMON_CAUTION_VERIFY], verification="none",
  keywords="rti second appeal cic information commission complaint section 18 19(3) penalty")

D("contempt-civil", "public", "Civil Contempt Petition",
  "Petition for wilful disobedience of a court order.",
  doc="Petition for Civil Contempt under the Contempt of Courts Act, 1971", forum="High Court / court whose order is disobeyed", parties="petitioner",
  statutes=[S("Section 2(b), Contempt of Courts Act 1971", "Civil contempt — wilful disobedience of judgment, decree, direction, order or undertaking"),
            S("Section 12, Contempt of Courts Act 1971", "Punishment for contempt"), S("Section 20, Contempt of Courts Act 1971", "Action must be initiated within one year from the date of the alleged contempt"),
            S("Article 215, Constitution of India", "High Court as a court of record with the power to punish for contempt")],
  limitation="One year from the date of the alleged contempt (s.20); courts treat continuing disobedience carefully — verify.", pre=["Serve a certified copy of the order on the contemnor and give reasonable time to comply.", "Show wilfulness — mere non-compliance without intent may not suffice."],
  facts=[F("order", "Order disobeyed — court, case no., date and the specific direction", "", "textarea"), F("service", "Service of the order / knowledge of the contemnor", "", "textarea"), F("disobedience", "Nature and date of the disobedience", "", "textarea"), F("efforts", "Steps taken to secure compliance", "", "textarea")],
  outline=["The order and the direction", "Knowledge of the order", "Disobedience and its wilfulness", "Steps taken to obtain compliance"], grounds=["The respondent had knowledge of the order and wilfully disobeyed it.", "The petition is within one year as Section 20 requires."],
  prayers=["Initiate contempt proceedings and punish the respondent under Section 12.", "Direct compliance with the order within a fixed period."], annex=["Certified copy of the order", "Proof of service / knowledge", "Correspondence"], cautions=[COMMON_CAUTION_VERIFY],
  verification="affidavit", keywords="contempt disobedience court order wilful violation high court petition")

D("notice-govt-s80", "public", "Notice to Government — Section 80 CPC",
  "Mandatory two-month notice before suing the Government or a public officer.",
  doc="Notice under Section 80 of the Code of Civil Procedure, 1908", kind="notice", forum="Government / public officer (notice stage)", parties="notice",
  statutes=[S("Section 80(1), CPC 1908", "Notice in writing stating the cause of action, name, description and residence of the plaintiff and relief claimed; suit only after two months"),
            S("Section 80(2), CPC 1908", "The court may permit a suit for urgent or immediate relief without prior notice")],
  limitation="Not applicable (notice stage). The suit may be filed after two months from delivery of the notice.", pre=["Address the notice to the right officer / department as Section 80(2) lists — check for state-specific rules."],
  facts=[F("cause", "Cause of action and dates", "", "textarea"), F("relief", "Relief claimed", "", "textarea"), F("authority", "Department / officer to be noticed", "", "textarea")],
  outline=["The plaintiff's particulars", "The cause of action", "Relief claimed"], grounds=["The cause of action arose on [date] when [event]."],
  prayers=["Grant the relief claimed within two months of receipt of this notice, failing which the client will institute a suit."], annex=[], cautions=[COMMON_CAUTION_VERIFY], keywords="section 80 notice government suit against state public officer two months")

D("gst-appeal-107", "public", "GST Appeal (First Appeal, s.107)",
  "Appeal to the Appellate Authority against an adjudication order under the GST laws.",
  doc="Appeal under Section 107 of the Central Goods and Services Tax Act, 2017", forum="First Appellate Authority under GST", parties="appellant",
  statutes=[S("Section 107, CGST Act 2017", "Appeal to the Appellate Authority within three months of communication of the order; a further one month may be condoned"),
            S("Section 107(6), CGST Act 2017", "Pre-deposit of the admitted tax and a percentage of the disputed tax (ten per cent, subject to a cap) — verify current figures")],
  limitation="Three months from communication, plus one month condonable; pre-deposit conditions apply — verify.", pre=["Compute the pre-deposit (admitted amount plus the statutory percentage of disputed tax) and file the appeal in the prescribed form on the GST portal.", "Confirm the date of communication of the order."],
  facts=[F("order", "Impugned order — no., date, authority, demand"), F("period", "Tax period and nature of demand", "", "text"), F("grounds_detail", "Grounds on facts and law", "", "textarea"), F("predeposit", "Pre-deposit paid (Rs.) and reference", "", "text")],
  outline=["The taxpayer and the proceedings", "The impugned order", "Grounds of appeal", "Pre-deposit"], grounds=["The impugned order is contrary to law and facts: [state grounds]."],
  prayers=["Set aside the impugned order.", "Grant consequential relief."], annex=["Impugned order", "Show-cause notice and replies", "Proof of pre-deposit"], cautions=["The second appeal forum (GST Appellate Tribunal) and its functioning have changed recently — check the current position.", COMMON_CAUTION_VERIFY],
  verification="verification", keywords="gst appeal 107 tax demand order appellate authority input tax credit")

D("gst-reply-show-cause", "public", "Reply to GST Show-Cause Notice",
  "Taxpayer's reply to a GST show-cause notice.",
  doc="Reply to Show-Cause Notice under the CGST Act, 2017", kind="reply", forum="Proper officer under the GST law", parties="notice",
  statutes=[S("Sections 73 / 74 / 74A, CGST Act 2017", "Determination of tax — which section applies depends on the tax period and the allegation (fraud or otherwise); check the current text")],
  limitation="Within the time allowed in the notice (usually thirty days); request more time in writing if needed.", pre=["Compare the notice against returns filed and supporting records; request a personal hearing."],
  facts=[F("notice_detail", "Allegations and the amount demanded", "", "textarea"), F("defence", "Response and supporting documents", "", "textarea")], outline=["Acknowledgment", "Reply on each allegation", "Request for hearing"],
  grounds=["The demand is not sustainable for the reasons stated."], prayers=["Drop the proceedings.", "Alternatively grant a personal hearing before any order."], annex=[], cautions=[COMMON_CAUTION_VERIFY],
  keywords="gst show cause notice reply demand proper officer tax")


# ═════════════════════════════════════════════════════════════════════
#  10. ACCIDENT & INSURANCE
# ═════════════════════════════════════════════════════════════════════
D("mact-claim-166", "accident", "Motor Accident Compensation Claim (MACT)",
  "Claim for compensation for death or injury in a motor accident.",
  doc="Claim Petition under Section 166 of the Motor Vehicles Act, 1988", forum="Motor Accidents Claims Tribunal", parties="claimant",
  statutes=[S("Section 166, Motor Vehicles Act 1988", "Application for compensation by the injured person, the owner of damaged property, the legal representatives, or an agent"),
            S("Section 166(2), MV Act 1988", "Territorial jurisdiction — where the accident occurred, or the claimant resides or carries on business, or the defendant resides"),
            S("Section 166(3), MV Act 1988", "Six months from the accident — reintroduced by the 2019 amendment with effect from 1 April 2022; the Supreme Court has passed an interim order (Bhagirathi Dash v. Union of India, 7 November 2025) restraining dismissal on this ground — verify the current position"),
            S("Section 166(4), MV Act 1988", "The Claims Tribunal treats the police's detailed accident report under s.159 as an application for compensation")],
  limitation="Six months under s.166(3) as reintroduced from 1 April 2022, but the Supreme Court has passed an interim order restraining dismissal of claims merely for delay — verify the latest order before filing; do not rely on it without checking.",
  pre=["Obtain the FIR, the s.159 detailed accident report, the MACT documents (driving licence, RC, insurance, permit) and medical / death records.", "Check whether a pending police report under s.159 already stands as an application."],
  facts=[F("accident", "Accident — date, time, place, vehicles", "", "textarea"), F("fir", "FIR no. and police station"), F("victim", "Victim — name, age, income and dependants", "", "textarea"),
         F("vehicle", "Offending vehicle — registration no., owner, driver, insurer", "", "textarea"), F("injury", "Death / injuries and treatment", "", "textarea"), F("claim_amount", "Compensation claimed (Rs.)")],
  outline=["The claimants and the victim", "The accident and the negligence of the driver", "Death / injuries and treatment", "Income, age and dependency", "Vehicle, ownership and insurance", "Compensation claimed under the heads recognised by law"],
  grounds=["The accident was caused by the rash and negligent driving of the offending vehicle.", "The owner and driver are vicariously liable, and the insurer is liable to indemnify under the policy.", "The claimants are entitled to just compensation under the heads settled by law."],
  prayers=["Award just compensation of Rs. {{claim_amount}} with interest from the date of the petition until realisation.", "Direct the respondents, jointly and severally, to pay.", "Award costs."],
  annex=["FIR and s.159 report", "Post-mortem / medical records", "Income and age proof", "Vehicle documents and insurance particulars"], cautions=["Compensation heads and multipliers are settled by Supreme Court decisions and the Second Schedule — do not assume figures; verify.", COMMON_CAUTION_VERIFY],
  verification="affidavit", keywords="motor accident compensation mact death injury road vehicle insurance claim tribunal 166")

D("insurance-ombudsman", "accident", "Insurance Ombudsman Complaint",
  "Complaint against an insurer's rejection or delay of a claim.",
  doc="Complaint to the Insurance Ombudsman under the Insurance Ombudsman Rules, 2017", forum="Insurance Ombudsman", parties="claimant",
  statutes=[S("Insurance Ombudsman Rules 2017", "Complaints about claim settlement, premium, policy terms, non-issuance of policy; award limit per the Rules"),
            S("Consumer Protection Act 2019", "Alternative forum — consumer commission remedy (see the Consumer category)")],
  limitation="Complaint to the insurer first; the Ombudsman complaint is to be filed within one year of the insurer's rejection or final reply (or after the insurer's period for reply lapses) — verify against the Rules.", pre=["Write to the insurer's grievance officer first and wait for the period stated in the Rules.", "Check the monetary limit under the Rules (currently Rs. 30 lakh — verify)."],
  facts=[F("policy", "Policy no., insurer, type and period"), F("claim", "Claim — date, amount and basis", "", "textarea"), F("repudiation", "Insurer's rejection / delay — reasons and dates", "", "textarea"), F("grievance", "Grievance letter to the insurer — date and outcome", "", "textarea")],
  outline=["The policy and premium", "The claim and the loss", "The insurer's repudiation / delay", "Why the repudiation is wrong"], grounds=["The claim is covered by the policy and the reasons for repudiation are not supported by the policy terms.", "The complainant has complied with the policy conditions."],
  prayers=["Direct the insurer to pay Rs. [amount] with interest.", "Award compensation for mental agony and costs, within the Rules."], annex=["Policy document", "Claim form", "Repudiation letter", "Grievance letter"], cautions=[COMMON_CAUTION_VERIFY],
  verification="verification", keywords="insurance ombudsman claim rejected repudiation health policy life vehicle insurer complaint")

# ═════════════════════════════════════════════════════════════════════
#  11. SUCCESSION & GUARDIANSHIP
# ═════════════════════════════════════════════════════════════════════
SUCC_FACTS = [F("deceased", "Deceased — name, date of death, last residence", "", "textarea"), F("heirs", "Legal heirs / beneficiaries with relationships", "", "textarea"),
              F("estate", "Estate — description and approximate value", "", "textarea"), F("will_detail", "Will — date, witnesses, custody (if any)", "", "textarea")]

D("probate-petition", "succession", "Petition for Probate of a Will",
  "Grant of probate to the executor of a Will.",
  doc="Petition for Probate under Section 276 of the Indian Succession Act, 1925", forum="District Court / High Court (original side, where applicable)", parties="petitioner",
  statutes=[S("Section 276, Indian Succession Act 1925", "Petition for probate — contents"), S("Section 278, Indian Succession Act 1925", "Petition for letters of administration where there is no executor or the Will is not proved"),
            S("Section 213, Indian Succession Act 1925", "Right as executor or legatee cannot be established in a court unless probate has been granted (in the areas the section covers)")],
  limitation="Generally taken to be three years from the date the right to apply accrues (Article 137, Limitation Act) — verify.", pre=["Obtain the original Will, the death certificate and the names and addresses of all legal heirs for citation.", "Publish / issue citations as the court directs."],
  facts=SUCC_FACTS, outline=["The deceased and the death", "The Will and its execution", "The petitioner as executor", "Estate and legal heirs"], grounds=["The Will was executed by the testator in a sound disposing state of mind in accordance with the law.", "The petitioner is the executor named in the Will."],
  prayers=["Grant probate of the Will of the deceased to the petitioner.", "Pass such other orders as the Court thinks fit."], annex=["Original Will", "Death certificate", "List of heirs with addresses", "Valuation of the estate"], cautions=["Court fee is State-specific and is computed on the value of the estate — verify.", COMMON_CAUTION_VERIFY],
  sections=[COURT_FEE_SEC], verification="affidavit", keywords="probate will testament executor succession estate grant")

D("letters-of-administration", "succession", "Letters of Administration (intestate)",
  "Grant of administration where the deceased left no Will, or the Will names no executor.",
  doc="Petition for Letters of Administration under Section 278 of the Indian Succession Act, 1925", forum="District Court / High Court (original side, where applicable)", parties="petitioner",
  statutes=[S("Section 278, Indian Succession Act 1925", "Petition for letters of administration"), S("Section 218, Indian Succession Act 1925", "Persons to whom administration may be granted in case of intestacy — verify the section that fits the deceased's personal law")],
  limitation="Generally three years from the date the right to apply accrues (Article 137) — verify.", pre=["List all heirs and their shares under the applicable personal law."],
  facts=SUCC_FACTS, outline=["The deceased and the death", "The petitioner's right to administer", "Heirs and estate"], grounds=["The deceased died intestate and the petitioner is entitled to administration."],
  prayers=["Grant letters of administration of the estate of the deceased to the petitioner."], annex=["Death certificate", "List of heirs", "Valuation of estate"], cautions=[COMMON_CAUTION_VERIFY], sections=[COURT_FEE_SEC], verification="affidavit",
  keywords="letters of administration intestate no will estate heirs administrator")

D("succession-certificate", "succession", "Succession Certificate",
  "Certificate to collect debts and securities of a deceased person.",
  doc="Petition for Succession Certificate under Section 372 of the Indian Succession Act, 1925", forum="District Court", parties="petitioner",
  statutes=[S("Section 372, Indian Succession Act 1925", "Application for succession certificate — particulars to be stated"), S("Section 373, Indian Succession Act 1925", "Procedure of the District Judge in granting the certificate — verify")],
  limitation="No fixed period, but delay complicates proof of heirship — verify.", pre=["List the specific debts / securities (bank accounts, shares, FDs) and the institutions holding them."],
  facts=SUCC_FACTS + [F("debts", "Debts and securities to be collected", "Account numbers with last four digits only", "textarea")], outline=["The deceased and the heirs", "The debts and securities", "The petitioner's right"],
  grounds=["The petitioner is entitled to the debts and securities as a legal heir."], prayers=["Grant a succession certificate authorising the petitioner to collect the debts and securities listed."], annex=["Death certificate", "Heirship proof", "Statements of the debts and securities"],
  cautions=[COMMON_CAUTION_VERIFY], sections=[COURT_FEE_SEC], verification="affidavit", keywords="succession certificate bank account shares legal heir deceased securities")

# ═════════════════════════════════════════════════════════════════════
#  12. REPLIES & PROCEDURAL
# ═════════════════════════════════════════════════════════════════════
D("reply-legal-notice", "procedural", "Reply to Legal Notice (general)",
  "Advocate's reply to a legal notice — denial, counter-claims and reservation of rights.",
  doc="Reply to Legal Notice", kind="reply", forum="Sender / their advocate (reply stage)", parties="notice",
  statutes=[S("Applicable law identified from the notice", "Match the reply to the statutes the notice relies on")], limitation="Reply within the period stated in the notice, or as the statute demands.",
  pre=["Read the notice against the client's instructions and documents; reply para-by-para.", "Check whether a statutory period runs (e.g. NI Act s.138: fifteen days from receipt)."],
  facts=[F("allegations", "Allegations in the notice — summary", "", "textarea"), F("version", "Client's version of facts", "", "textarea"), F("counter", "Counter-claims / demands", "", "textarea")],
  outline=["Acknowledgment of the notice", "Para-wise denial", "The true facts", "Counter-claims and reservation of rights"], grounds=["The allegations are false / misconceived for the reasons stated."],
  prayers=["Withdraw the notice, failing which the client will take appropriate legal action at your risk as to cost and consequences."], annex=[], cautions=[COMMON_CAUTION_VERIFY], keywords="reply legal notice response denial advocate")

D("written-statement-civil", "procedural", "Written Statement (Civil Suit)",
  "Defendant's written statement under Order VIII CPC.",
  doc="Written Statement under Order VIII of the Code of Civil Procedure, 1908", forum="Civil Court", parties="defendant",
  statutes=[S("Order VIII Rule 1, CPC 1908", "Written statement within thirty days of service; may be extended, for reasons recorded, to ninety days from service; the outer limit for commercial suits is 120 days"),
            S("Order VIII Rules 3 to 5, CPC 1908", "Specific denial — denial must be specific or the allegation is deemed admitted"),
            S("Order VIII Rule 6A, CPC 1908", "Counter-claim")],
  limitation="Thirty days from service of summons, extendable up to ninety days (120 for commercial suits) — the Supreme Court has held the outer limit is mandatory; verify the current position.",
  pre=["Calendar the 30-day and outer-limit dates from the date of service.", "Consider a counter-claim (Order VIII Rule 6A) and any preliminary objection on jurisdiction, limitation or maintainability."],
  facts=[F("suit", "Suit — number, parties, relief"), F("preliminary", "Preliminary objections", "", "textarea"), F("version", "Defendant's version of facts", "", "textarea"), F("counter", "Counter-claim, if any", "", "textarea")],
  outline=["Preliminary objections", "Para-wise reply to the plaint", "Additional facts / defence", "Counter-claim (if any)"], grounds=["The suit is not maintainable for the following reasons: [preliminary objections].", "Each allegation not specifically admitted is denied."],
  prayers=["Dismiss the suit with costs.", "Decree the counter-claim, if any."], annex=["Documents relied on", "Vakalatnama"], cautions=["Specific denial is required; a general denial is not enough.", COMMON_CAUTION_VERIFY], verification="verification",
  keywords="written statement defendant order 8 reply plaint counter claim defence civil suit")

D("app-order7-rule11", "procedural", "Application for Rejection of Plaint (Order VII Rule 11)",
  "Defendant's application to reject the plaint.",
  doc="Application under Order VII Rule 11 of the Code of Civil Procedure, 1908", forum="Civil Court", parties="applicant",
  statutes=[S("Order VII Rule 11, CPC 1908", "Grounds for rejection: no cause of action, undervaluation, insufficient stamp, barred by law, etc.")],
  limitation="No limitation; can be raised at any stage before judgment — verify.", pre=["Read the plaint alone; the court examines the plaint and annexures, not the defence."],
  facts=[F("suit", "Suit — number and parties"), F("grounds_detail", "Ground under Rule 11 (a)-(f) and why it appears from the plaint", "", "textarea")], outline=["The suit and the plaint's averments", "The ground on which the plaint is liable to be rejected"],
  grounds=["On a plain reading, the plaint discloses no cause of action / is barred by [law].", "The court has power to reject the plaint at the threshold to prevent abuse."], prayers=["Reject the plaint under Order VII Rule 11.", "Award costs."], annex=["Copy of the plaint"], cautions=[COMMON_CAUTION_VERIFY],
  verification="affidavit", keywords="reject plaint order 7 rule 11 no cause of action barred by law civil application")

D("app-condonation-delay", "procedural", "Application for Condonation of Delay (s.5 Limitation Act)",
  "Application to condone delay in filing an appeal or application.",
  doc="Application under Section 5 of the Limitation Act, 1963", forum="Court / Tribunal where the appeal or application is filed", parties="applicant",
  statutes=[S("Section 5, Limitation Act 1963", "Extension of the prescribed period for appeals and applications if sufficient cause is shown; it does not apply to suits"),
            S("Section 14, Limitation Act 1963", "Exclusion of time spent bona fide before a court without jurisdiction")],
  limitation="Applies to appeals and applications (not suits); explain each day of delay.", pre=["Prepare a day-wise chronology of the delay with proof."],
  facts=[F("delay", "Length of delay and reason", "", "textarea"), F("chronology", "Chronology explaining the delay", "", "textarea")], outline=["The appeal / application and the delay", "Reasons for the delay", "Prejudice to the other side"],
  grounds=["The delay was caused by circumstances beyond the applicant's control, showing sufficient cause.", "No prejudice will be caused to the respondent."], prayers=["Condone the delay in filing the [appeal / application].", "Admit the [appeal / application] for hearing."], annex=["Proof of the reasons for the delay"],
  cautions=[COMMON_CAUTION_VERIFY], verification="affidavit", keywords="condonation delay limitation section 5 appeal late filing sufficient cause")

D("app-set-aside-exparte", "procedural", "Application to Set Aside an Ex-Parte Decree (Order IX Rule 13)",
  "Defendant's application to set aside an ex-parte decree.",
  doc="Application under Order IX Rule 13 of the Code of Civil Procedure, 1908", forum="Court that passed the decree", parties="applicant",
  statutes=[S("Order IX Rule 13, CPC 1908", "Setting aside ex-parte decree if summons were not duly served or sufficient cause prevented appearance"), S("Article 123, Limitation Act 1963", "Thirty days from the date of the decree, or from knowledge where summons were not duly served")],
  limitation="Thirty days from the decree (or from knowledge, if summons were not duly served) — verify.", pre=["Establish non-service or the specific reason for non-appearance, with documents."],
  facts=[F("suit", "Suit and the ex-parte decree — date"), F("service", "Service of summons and defendant's knowledge", "", "textarea"), F("cause", "Reason for non-appearance", "", "textarea"), F("defence", "Prima facie defence on merits", "", "textarea")],
  outline=["The suit and the ex-parte decree", "Service / non-service of summons", "Sufficient cause for non-appearance", "Defence on merits"], grounds=["Summons were not duly served / the applicant was prevented by sufficient cause.", "The application is within thirty days."],
  prayers=["Set aside the ex-parte decree dated [date].", "Restore the suit to file for trial on merits.", "Stay execution meanwhile."], annex=["Decree and order-sheet", "Proof of non-service / cause"], cautions=[COMMON_CAUTION_VERIFY], verification="affidavit",
  keywords="ex parte decree set aside order 9 rule 13 non appearance summons not served")

D("appeal-first-civil-96", "procedural", "First Appeal from a Civil Decree (s.96 CPC)",
  "Memorandum of appeal against a decree of a civil court.",
  doc="Memorandum of First Appeal under Section 96 of the Code of Civil Procedure, 1908", forum="District Court / High Court", parties="appellant",
  statutes=[S("Section 96, CPC 1908", "Appeal from original decrees"), S("Order XLI, CPC 1908", "Procedure in appeals from original decrees"),
            S("Article 116, Limitation Act 1963", "Ninety days for appeals to the High Court and thirty days for appeals to any other court")],
  limitation="Ninety days (appeal to the High Court) or thirty days (appeal to any other court) from the decree — verify.", pre=["Obtain certified copies of the judgment and decree (time taken to obtain them is excluded)."],
  facts=[F("suit", "Suit — number, court, decree date and effect", "", "textarea"), F("grounds_detail", "Errors in the judgment", "", "textarea"), F("stay", "Stay of execution required?", "", "text")],
  outline=["The suit and the impugned decree", "Grounds of appeal", "Limitation"], grounds=["The trial court erred in law and fact in [state errors].", "The findings are against the weight of evidence and perverse."], prayers=["Set aside the impugned judgment and decree.", "Stay execution pending appeal.", "Award costs."],
  annex=["Certified copy of judgment and decree", "Grounds of appeal"], cautions=[COMMON_CAUTION_VERIFY], verification="affidavit", keywords="appeal civil decree section 96 first appeal high court district court judgment")

D("appeal-criminal-415", "procedural", "Criminal Appeal Against Conviction",
  "Appeal from conviction and sentence.",
  doc="Criminal Appeal under the Bharatiya Nagarik Suraksha Sanhita, 2023", forum="Court of Session / High Court", parties="appellant",
  statutes=[S("Section 415, BNSS 2023", "Appeals from convictions (earlier s.374 CrPC)"), S("Section 430, BNSS 2023", "Suspension of sentence pending appeal and release on bail — verify the section against the Sanhita text"), S("Limitation Act 1963", "Appeal periods depend on the court and the order — check the relevant Articles")],
  limitation="Depends on the court appealed from and the nature of the order (Limitation Act, Articles for criminal appeals) — verify.", pre=["Obtain certified copies of the judgment and the order on sentence.", "Prepare an application for suspension of sentence and bail pending appeal."],
  facts=[F("case", "Trial case — number, court, offences"), F("judgment", "Conviction and sentence — date and terms", "", "textarea"), F("grounds_detail", "Grounds of appeal", "", "textarea")],
  outline=["The prosecution case and the trial", "The conviction and sentence", "Grounds of appeal"], grounds=["The prosecution failed to prove the charge beyond reasonable doubt.", "The trial court misappreciated the evidence."], prayers=["Set aside the conviction and sentence and acquit the appellant.", "Suspend the sentence and release the appellant on bail pending appeal."],
  annex=["Judgment and order on sentence", "Bail / custody status"], cautions=[COMMON_CAUTION_VERIFY], verification="affidavit", keywords="criminal appeal conviction sentence acquittal appeal bnss 415 374")

D("criminal-revision-438", "procedural", "Criminal Revision Petition",
  "Revision against an order of a criminal court.",
  doc="Criminal Revision Petition under the Bharatiya Nagarik Suraksha Sanhita, 2023", forum="Court of Session / High Court", parties="petitioner",
  statutes=[S("Section 438, BNSS 2023", "Calling for records to exercise revisional powers (earlier s.397 CrPC)"), S("Section 442, BNSS 2023", "High Court's powers of revision (earlier s.401 CrPC)")],
  limitation="No period is prescribed in the BNSS text for revision; check the High Court's practice and explain any delay — verify.", pre=["Confirm the order is not interlocutory in a way that bars revision (see the BNSS provisions on interlocutory orders)."],
  facts=[F("order", "Impugned order — court, case no., date and effect", "", "textarea"), F("grounds_detail", "Illegality, impropriety or irregularity alleged", "", "textarea")], outline=["The case and the impugned order", "Illegality / impropriety in the order"],
  grounds=["The impugned order suffers from illegality / impropriety / irregularity."], prayers=["Set aside the impugned order.", "Stay further proceedings pending the revision."], annex=["Impugned order and case record extracts"], cautions=[COMMON_CAUTION_VERIFY], verification="affidavit",
  keywords="criminal revision 438 397 revisional jurisdiction order criminal court")

D("app-discharge-250", "procedural", "Application for Discharge (Sessions Case)",
  "Accused's application for discharge before framing of charge.",
  doc="Application for Discharge under the Bharatiya Nagarik Suraksha Sanhita, 2023", forum="Court of Session", parties="accused",
  statutes=[S("Section 250, BNSS 2023", "Discharge in cases triable by the Court of Session (earlier s.227 CrPC) — verify the section number in the BNSS text"), S("Section 262, BNSS 2023", "Discharge in warrant cases on police report (earlier s.239 CrPC) — verify")],
  limitation="Time-bound by the BNSS after supply of documents — verify the period for filing a discharge application.", pre=["Compare the chargesheet material against each ingredient of the offence."],
  facts=[F("case", "Sessions case / CC number and offences"), F("gap", "Why the material does not make out the offence", "", "textarea")], outline=["The case and the charges", "Absence of sufficient ground to proceed"],
  grounds=["Taking the prosecution material at its face value, there is no sufficient ground for proceeding against the accused."], prayers=["Discharge the accused of the offences alleged."], annex=["Chargesheet extracts"], cautions=[COMMON_CAUTION_VERIFY], verification="affidavit",
  keywords="discharge application section 227 250 sessions case chargesheet no prima facie")

D("execution-order21", "procedural", "Execution Petition (Order XXI CPC)",
  "Petition to execute a civil decree.",
  doc="Execution Petition under Order XXI of the Code of Civil Procedure, 1908", forum="Court that passed the decree / court to which it is transferred", parties="applicant",
  statutes=[S("Section 36 to 74, CPC 1908", "Execution of decrees and orders"), S("Order XXI, CPC 1908", "Modes of execution — attachment, sale, arrest and detention"), S("Article 136, Limitation Act 1963", "Twelve years from the date the decree becomes enforceable")],
  limitation="Twelve years from when the decree becomes enforceable (Article 136) — verify the date.", pre=["Prepare the Order XXI Rule 11 particulars: the decree, payments made and the mode of execution sought."],
  facts=[F("decree", "Decree — case no., court, date and amount", "", "textarea"), F("payments", "Amount paid so far and balance due", "", "textarea"), F("mode", "Mode of execution sought", "Attachment of bank account / immovable property / salary / arrest", "text")],
  outline=["The decree and the balance", "Failure to satisfy the decree", "Mode of execution sought"], grounds=["The decree remains unsatisfied and the applicant is entitled to execute it."], prayers=["Execute the decree by [mode] for Rs. [balance] with interest and costs."],
  annex=["Certified copy of the decree", "Statement of payments"], cautions=[COMMON_CAUTION_VERIFY], verification="verification", keywords="execution decree order 21 attachment arrest sale enforce judgment")

D("caveat-148a", "procedural", "Caveat (s.148A CPC)",
  "Caveat to be heard before any interim order is passed against you.",
  doc="Caveat under Section 148A of the Code of Civil Procedure, 1908", forum="Civil Court / Appellate Court", parties="applicant",
  statutes=[S("Section 148A, CPC 1908", "Right to lodge a caveat; it remains in force for ninety days from the date it is lodged and can be renewed")],
  limitation="Valid for ninety days from lodging; renew before expiry.", pre=["Serve notice of the caveat on the person expected to apply, by registered post."],
  facts=[F("expected", "Expected applicant / litigation", "", "textarea"), F("interest", "Applicant's interest in the matter", "", "textarea")], outline=["The caveator and the anticipated proceeding"], grounds=["The caveator apprehends that an application will be made for an interim order."],
  prayers=["Notice be given to the caveator before any interim order is passed."], annex=[], cautions=[COMMON_CAUTION_VERIFY], verification="none", keywords="caveat 148a interim order apprehend application notice civil")

D("review-order47", "procedural", "Review Petition (Order XLVII CPC)",
  "Application for review of a judgment or order.",
  doc="Review Petition under Order XLVII of the Code of Civil Procedure, 1908", forum="Court that passed the judgment / order", parties="applicant",
  statutes=[S("Section 114, CPC 1908", "Power to review"), S("Order XLVII Rule 1, CPC 1908", "Grounds — discovery of new and important matter, mistake or error apparent on the face of the record, or any other sufficient reason"),
            S("Article 124, Limitation Act 1963", "Thirty days from the date of the decree or order")],
  limitation="Thirty days from the decree or order (Article 124) — verify.", pre=["Confine the grounds to the Order XLVII grounds; review is not an appeal."],
  facts=[F("order", "Judgment / order — court, date and effect", "", "textarea"), F("error", "Error apparent / new matter", "", "textarea")], outline=["The judgment and its effect", "The error apparent on the record / new matter"],
  grounds=["There is an error apparent on the face of the record / new and important matter that could not be produced earlier."], prayers=["Review and recall the judgment / order dated [date] and rehear the matter."], annex=["Certified copy of the judgment / order"], cautions=[COMMON_CAUTION_VERIFY],
  verification="affidavit", keywords="review petition order 47 error apparent judgment recall")

D("app-implead-order1-rule10", "procedural", "Application to Implead a Party (Order I Rule 10)",
  "Application to add a necessary or proper party to a suit.",
  doc="Application under Order I Rule 10(2) of the Code of Civil Procedure, 1908", forum="Civil Court", parties="applicant",
  statutes=[S("Order I Rule 10(2), CPC 1908", "The court may add a party whose presence is necessary to decide all questions involved")], limitation="No limitation; raise promptly.", pre=["Show the applicant's interest and why the presence is necessary."],
  facts=[F("suit", "Suit — number, parties, relief"), F("interest", "Applicant's interest in the subject matter", "", "textarea")], outline=["The suit and the applicant's interest", "Why the applicant is a necessary / proper party"],
  grounds=["The applicant has a direct interest in the subject matter and no effective decree can be passed in the applicant's absence."], prayers=["Implead the applicant as a party [defendant / plaintiff] in the suit."], annex=["Documents showing the applicant's interest"], cautions=[COMMON_CAUTION_VERIFY], verification="affidavit",
  keywords="implead party order 1 rule 10 necessary party add defendant intervene")

D("app-amend-pleadings-order6-17", "procedural", "Application to Amend Pleadings (Order VI Rule 17)",
  "Application to amend the plaint or written statement.",
  doc="Application under Order VI Rule 17 of the Code of Civil Procedure, 1908", forum="Civil Court", parties="applicant",
  statutes=[S("Order VI Rule 17, CPC 1908", "Amendment of pleadings; after commencement of trial, no amendment unless the party could not have raised the matter earlier despite due diligence")], limitation="No limitation; the trial stage matters.", pre=["State the proposed amendments verbatim and why they were not made earlier."],
  facts=[F("suit", "Suit — number, parties"), F("amendment", "Proposed amendment (exact text)", "", "textarea"), F("reason", "Why it is needed and why not earlier", "", "textarea")], outline=["The suit and its stage", "The proposed amendment", "Why it is necessary"],
  grounds=["The amendment is necessary for determining the real controversy and will not change the nature of the suit."], prayers=["Permit the amendment of the [plaint / written statement] as per the annexed draft."], annex=["Draft amendment"], cautions=[COMMON_CAUTION_VERIFY], verification="affidavit",
  keywords="amend pleadings plaint written statement order 6 rule 17 amendment")


# ═════════════════════════════════════════════════════════════════════
#  WRITE + VALIDATE
# ═════════════════════════════════════════════════════════════════════
def validate():
    errs = []
    cat_ids = {c[0] for c in CATEGORIES}
    seen = set()
    ph = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")
    REQUIRED = ["id", "cat", "title", "blurb", "kind", "doc", "forum", "parties", "statutes", "limitation",
                "outline", "prayers", "verification"]
    for d in CATALOG:
        i = d["id"]
        if i in seen:
            errs.append(f"duplicate id {i}")
        seen.add(i)
        if d["cat"] not in cat_ids:
            errs.append(f"{i}: unknown category {d['cat']}")
        if d["kind"] not in BASES:
            errs.append(f"{i}: unknown kind {d['kind']}")
        if d["verification"] not in ("affidavit", "verification", "none"):
            errs.append(f"{i}: bad verification {d['verification']}")
        for k in REQUIRED:
            if k not in d or d[k] in ("", None) or d[k] == []:
                if k in ("outline", "prayers") and d["kind"] == "rti" and k != "prayers":
                    continue
                errs.append(f"{i}: missing {k}")
        base_keys = {f["key"] for f in BASES[d["kind"]]}
        extra = [f["key"] for f in d["facts"]]
        if len(extra) != len(set(extra)):
            errs.append(f"{i}: duplicate fact keys")
        clash = base_keys & set(extra)
        if clash:
            errs.append(f"{i}: fact keys clash with base: {sorted(clash)}")
        allowed = base_keys | set(extra)
        blob = json.dumps([d["prayers"], d["grounds"], d["outline"], d["sections"], d["pre"], d["cautions"], d["doc"]])
        for m in ph.findall(blob):
            if m not in allowed:
                errs.append(f"{i}: placeholder {{{{{m}}}}} not defined")
        for s_ in d["statutes"]:
            if not s_["ref"].strip():
                errs.append(f"{i}: empty statute ref")
        for f in d["facts"]:
            if f["type"] not in ("text", "textarea", "date", "number"):
                errs.append(f"{i}: bad fact type {f['type']}")
    return errs


def main():
    errs = validate()
    if errs:
        print("VALIDATION FAILED")
        for e in errs:
            print(" -", e)
        sys.exit(1)
    counts = {}
    for d in CATALOG:
        counts[d["cat"]] = counts.get(d["cat"], 0) + 1
    out = {
        "meta": {
            "version": 1, "reviewed": REVIEWED, "count": len(CATALOG),
            "notice": "Drafting aid, not legal advice. Statutory references were checked in September 2026 or are marked 'verify'. "
                      "Confirm every reference against India Code and current amendments before filing.",
        },
        "categories": [{"id": c[0], "label": c[1], "blurb": c[2], "count": counts.get(c[0], 0)} for c in CATEGORIES],
        "bases": BASES,
        "disputes": CATALOG,
    }
    text = json.dumps(out, ensure_ascii=False, indent=1)
    for rel in ("data/dispute_catalog.json", "frontend/src/data/disputeCatalog.json"):
        path = ROOT / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        print("wrote", rel, len(text), "bytes")
    print(f"{len(CATALOG)} disputes in {len(CATEGORIES)} categories")
    for c in CATEGORIES:
        print(f"  {c[1]:32s} {counts.get(c[0], 0)}")


if __name__ == "__main__":
    main()
