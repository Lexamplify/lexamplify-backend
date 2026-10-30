"""
utils/dms_classify.py - deterministic document classification and metadata extraction.

No AI model is involved, on purpose: a language model asked "what is this document?" will
always answer something, and a confidently wrong filing label in a law office is worse than
"not sure". Instead:

  * each document type is a set of weighted phrases that actually appear in Indian court and
    legal papers (a court order says "ORDER SHEET" and "list on"; an affidavit says "solemnly
    affirm" and "deponent"),
  * the result carries a confidence and the exact phrases that triggered it, so a lawyer can
    see WHY and overrule it in one click,
  * below the confidence bar the document is left "Unclassified" and sent to the review queue
    instead of guessed,
  * extracted facts (case number, CNR, court, parties, dates) come from strict patterns and
    are only ever *suggestions*; nothing is filed to a matter without a human accepting it.

Limits (stated, not hidden): rules were written from the standard forms used across Indian
courts, not tuned on your firms' own files. Expect to correct some labels early on; every
correction is a one-click action in the review queue.
"""
import re
import unicodedata
from datetime import date

# ── classes ──────────────────────────────────────────────────────────────────────────
# (pattern, weight, zone) - zone "head" = first ~1,500 chars, "any" = first ~20,000 chars.
# A pattern scores once per document. Weights: 3 = near-certain signal, 2 = strong, 1 = supportive.
H, A = "head", "any"
CLASSES = {
    "Court Order": {
        "folder": "02 · Court Filings",
        "rules": [
            (r"\border\s+sheet\b", 3, H), (r"^\s*(?:common\s+|interim\s+|final\s+)?order\s*:?\s*$", 3, H),
            (r"\bproceedings\s+of\s+the\s+day\b", 3, H), (r"\bcoram\b", 2, H), (r"\bhon['’]?ble\b", 1, A),
            (r"\b(?:list|listed|posted|put\s+up|adjourned?)\s+(?:the\s+matter\s+)?(?:on|for|to)\b", 2, A),
            (r"\bnext\s+date\b", 2, A), (r"\bheard\s+(?:the\s+)?(?:learned\s+)?counsel\b", 2, A),
            (r"\b(?:i\.?a\.?|crl\.?m\.?p\.?)\s*no\.?\s*\d+.*\b(?:allowed|dismissed|disposed)\b", 1, A),
            (r"\bbail\s+is\s+(?:granted|rejected|refused)\b", 2, A), (r"\bnotice\s+(?:is\s+)?issued\b", 1, A),
            # Hindi
            (r"^\s*(?:अंतरिम\s+|अन्तरिम\s+)?आदेश(?:\s*पत्र(?:क)?)?\s*:?\s*$", 3, H), (r"अगली\s+(?:तारीख|सुनवाई|पेशी)|आगामी\s+तिथि", 2, A), (r"पेशी\s+(?:की\s+)?(?:तिथि|तारीख)", 2, A),
        ],
    },
    "Judgment": {
        "folder": "02 · Court Filings",
        "rules": [
            (r"^\s*(?:reportable\s*)?judg(?:e)?ment\s*:?\s*$", 3, H), (r"\bjudg(?:e)?ment\s+(?:delivered|pronounced|reserved)\b", 3, A),
            (r"\b(?:appeal|petition|writ\s+petition|suit)\s+(?:is\s+)?(?:hereby\s+)?(?:allowed|dismissed|decreed|partly\s+allowed)\b", 3, A),
            (r"\bin\s+the\s+result\b", 1, A), (r"\bequivalent\s+citation", 2, H), (r"\bheadnote\b", 2, H),
            (r"\bcivil\s+appeal\s+no", 1, H), (r"\bcriminal\s+appeal\s+no", 1, H), (r"\b(?:insc|scc|air\s+\d{4}\s+sc)\b", 1, A),
            (r"\bfor\s+the\s+(?:reasons|foregoing\s+reasons)\s+(?:stated|recorded)\s+above\b", 1, A),
            (r"^\s*(?:निर्णय|फैसला|निर्णय-पत्र)\s*:?\s*$", 3, H), (r"निर्णय\s+(?:सुनाया|पारित|घोषित)", 3, A), (r"(?:याचिका|अपील|वाद)\s+(?:स्वीकार|निरस्त|खारिज|डिक्री)", 3, A),
        ],
    },
    "Petition / Plaint": {
        "folder": "01 · Pleadings & Drafts",
        "rules": [
            (r"\bmost\s+respectfully\s+(?:showeth|submitted?|sheweth)\b", 3, A), (r"\bit\s+is\s+(?:therefore\s+)?(?:most\s+)?respectfully\s+prayed\b", 3, A),
            (r"\b(?:writ\s+petition|petition\s+under|plaint|memorandum\s+of\s+appeal|criminal\s+(?:original\s+)?petition|revision\s+petition|special\s+leave\s+petition|original\s+application)\b", 3, H),
            (r"\bprayer\b", 2, A), (r"\bcause\s+of\s+action\b", 2, A), (r"\bunder\s+article\s+2(?:26|27|32)\b", 2, A),
            (r"\bvalue\s+of\s+(?:the\s+)?suit\b", 2, A), (r"\bjurisdiction\b.*\bcourt\b", 1, A), (r"\bpetitioner\b", 1, H), (r"\bplaintiff\b", 1, H),
            (r"\bwhat\s+is\s+the\s+relief\b", 0, A), (r"\bsynopsis\s+and\s+list\s+of\s+dates\b", 2, H),
            (r"(?:रिट\s+)?याचिका(?!कर्ता)", 3, H), (r"वाद\s*पत्र|परिवाद\s*पत्र", 3, H), (r"सविनय\s+निवेदन|प्रार्थना\s+है\s+कि", 2, A), (r"वाद\s+का\s+कारण", 2, A),
        ],
    },
    "Bail Application": {
        "folder": "01 · Pleadings & Drafts",
        "rules": [
            (r"\b(?:regular\s+|anticipatory\s+)?bail\s+(?:application|petition)\b", 3, H), (r"\bsection\s+(?:43[89]|480|482|483|484)\b.*\b(?:cr\.?p\.?c|bnss)\b", 3, A),
            (r"\b(?:release|enlarged?)\s+(?:him|her|the\s+(?:applicant|petitioner|accused))\s+on\s+bail\b", 3, A),
            (r"\bbail\b", 1, A), (r"\bnon[- ]bailable\b", 1, A), (r"\bcustody\b", 1, A), (r"\bf\.?i\.?r\.?\b", 1, A),
            (r"जमानत\s+(?:प्रार्थना\s*पत्र|आवेदन|याचिका)|अग्रिम\s+जमानत", 3, H), (r"जमानत", 1, A), (r"न्यायिक\s+अभिरक्षा|हिरासत", 1, A),
        ],
    },
    "Written Statement / Reply": {
        "folder": "01 · Pleadings & Drafts",
        "rules": [
            (r"\bwritten\s+statement\b", 3, H), (r"\bcounter[- ]affidavit\b", 3, H), (r"\brejoinder\b", 3, H),
            (r"\breply\s+(?:affidavit|to\s+the\s+(?:petition|application|plaint))\b", 3, H), (r"\bpreliminary\s+objections?\b", 2, A),
            (r"\bdenied\s+(?:as\s+)?(?:false|incorrect)\b", 1, A), (r"\bparawise\s+reply\b", 3, A), (r"\bcounter\s+statement\b", 2, H),
            (r"लिखित\s+(?:कथन|जवाब)|जवाब\s*दावा|प्रतिशपथ\s*पत्र", 3, H),
        ],
    },
    "Application (I.A.)": {
        "folder": "01 · Pleadings & Drafts",
        "rules": [
            (r"\binterlocutory\s+application\b", 3, H), (r"\bi\.?a\.?\s*no\.?", 2, H), (r"\bapplication\s+(?:under|for)\b", 2, H),
            (r"\b(?:order\s+(?:vii|xxxix|xxxvii|i|xxi)\s+rule|section\s+151\s+c\.?p\.?c)\b", 2, A), (r"\bmiscellaneous\s+application\b", 2, H),
            (r"\bcondone\s+the\s+delay\b", 2, A), (r"\bstay\b.*\border\b", 1, A),
        ],
    },
    "Affidavit": {
        "folder": "01 · Pleadings & Drafts",
        "rules": [
            (r"^\s*affidavit\b", 3, H), (r"\bsolemnly\s+(?:affirm|declare|state)\b", 3, A), (r"\bdeponent\b", 3, A),
            (r"\bverification\b", 1, A), (r"\bsworn\s+(?:before|at)\b", 2, A), (r"\bnotary\b", 1, A), (r"\bmake\s+oath\b", 2, A),
            (r"^\s*(?:शपथ\s*[-\s]?पत्र|हलफ़?नामा|शपथपत्र)", 3, H), (r"शपथकर्ता|शपथ\s*पूर्वक|सत्यापन|बयान\s+करत[ाी]\s+हूँ", 2, A),
        ],
    },
    "Vakalatnama / Authorisation": {
        "folder": "02 · Court Filings",
        "rules": [
            (r"\bvakal(?:at)?nama\b", 3, H), (r"\bhereby\s+appoint\b.*\badvocate\b", 3, A), (r"\bto\s+appear,?\s+plead\s+and\s+act\b", 3, A),
            (r"\bwarrant\s+of\s+authori[sz]ation\b", 3, H), (r"\bauthority\s+letter\b", 2, H), (r"\bmemo\s+of\s+appearance\b", 3, H),
            (r"वकालत\s*नामा|वकालतनामा", 3, H),
        ],
    },
    "Legal Notice": {
        "folder": "04 · Correspondence",
        "rules": [
            (r"\blegal\s+notice\b", 3, H), (r"\bunder\s+(?:the\s+)?instructions?\s+(?:from|of)\s+(?:and\s+on\s+behalf\s+of\s+)?my\s+client", 3, A),
            (r"\bhereby\s+(?:called\s+upon|call\s+upon|require)\b", 3, A), (r"\bnotice\s+under\s+section\s+(?:138|80|106|434|8|13\(?)\b", 3, A),
            (r"\bregistered\s+post\b|\bspeed\s+post\b|\bpostal\s+acknowledg", 1, H), (r"\bfailing\s+which\b", 2, A),
            (r"\bat\s+your\s+(?:own\s+)?risk\s+(?:and\s+)?(?:as\s+to\s+)?(?:costs|cost)\b", 2, A), (r"\bwithout\s+prejudice\b", 1, A),
            (r"(?:विधिक|कानूनी|वैधानिक)\s+नोटिस", 3, H), (r"मेरे\s+(?:मुवक्किल|पक्षकार)", 2, A), (r"अन्यथा\s+(?:मेरे|मेरा)", 1, A),
        ],
    },
    "Agreement / Contract": {
        "folder": None,
        "rules": [
            (r"\bthis\s+(?:agreement|memorandum\s+of\s+understanding|mou|contract)\b", 3, H), (r"\bwhereas\b", 2, A),
            (r"\bnow\s+(?:this\s+)?(?:agreement\s+)?witness(?:eth)?\b|\bnow\s+therefore\b", 2, A), (r"\bin\s+witness\s+whereof\b", 3, A),
            (r"\bthe\s+parties\s+(?:hereby\s+)?agree\b", 2, A), (r"\bgoverning\s+law\b|\bjurisdiction\s+of\s+the\s+courts\b", 1, A),
            (r"\b(?:non[- ]disclosure|service|employment|retainer|consultancy|shareholders?|partnership|franchise)\s+agreement\b", 2, H),
            (r"\bindemnif", 1, A), (r"\bterminat(?:e|ion)\b", 1, A),
            (r"अनुबंध|इकरारनामा|करारनामा|समझौता\s*(?:पत्र)?", 2, H), (r"प्रथम\s+पक्ष|द्वितीय\s+पक्ष", 2, A),
        ],
    },
    "Deed / Property Document": {
        "folder": None,
        "rules": [
            (r"\b(?:sale|gift|lease|rent|release|settlement|partition|mortgage|conveyance|exchange|trust)\s+deed\b", 3, H),
            (r"\bpower\s+of\s+attorney\b", 3, H), (r"^\s*(?:last\s+)?will\b|\blast\s+will\s+and\s+testament\b", 3, H),
            (r"\bsub[- ]registrar\b", 2, A), (r"\bschedule\s+of\s+(?:the\s+)?property\b", 3, A), (r"\bencumbrance\b", 2, A),
            (r"\bvendor\b.*\bpurchaser\b|\blessor\b.*\blessee\b|\bdonor\b.*\bdonee\b", 2, A), (r"\bstamp\s+(?:paper|duty)\b", 1, A),
            (r"\bsurvey\s+no\b|\bpatta\b|\bkhasra\b|\bkhata\b", 2, A),
            (r"विक्रय\s*पत्र|बैनामा|दान\s*पत्र|किराया\s*नामा|पट्टा\s*(?:विलेख)?|वसीयत(?:नामा)?|मुख्तारनामा|आम\s+मुख्तार", 3, H), (r"खसरा|खतौनी|उप\s*-?\s*निबंधक", 2, A),
        ],
    },
    "FIR / Police Record": {
        "folder": "03 · Evidence & Exhibits",
        "rules": [
            (r"\bfirst\s+information\s+report\b", 3, H), (r"\bf\.?i\.?r\.?\s*no\b", 2, H), (r"\bpolice\s+station\b", 1, H),
            (r"\bfinal\s+report\b.*\bsection\s+(?:173|193)\b|\bcharge[- ]?sheet\b", 3, A), (r"\bseizure\s+(?:memo|mahazar)\b|\bmahazar\b", 3, A),
            (r"\bremand\b", 1, A), (r"\binvestigating\s+officer\b|\bio\b", 1, A), (r"\bunder\s+section.*\b(?:ipc|bns|ndps|pocso)\b", 2, A),
            (r"प्रथम\s+सूचना\s+रिपोर्ट|एफ\.?\s*आई\.?\s*आर", 3, H), (r"थाना|पुलिस\s+स्टेशन", 1, H), (r"आरोप\s*-?\s*पत्र", 3, A),
        ],
    },
    "Summons / Court Notice": {
        "folder": "02 · Court Filings",
        "rules": [
            (r"\bsummons?\b", 3, H), (r"\byou\s+are\s+(?:hereby\s+)?(?:summoned|directed|required)\s+to\s+appear\b", 3, A),
            (r"\bcause\s+list\b|\blist\s+of\s+business\b", 3, H), (r"\bshow\s+cause\s+notice\b", 3, H), (r"\bnotice\s+of\s+(?:hearing|motion|appearance)\b", 3, H),
            (r"\bwarrant\s+of\s+arrest\b|\bnon[- ]bailable\s+warrant\b", 3, H), (r"\bfail(?:ure)?\s+to\s+appear\b", 1, A),
            (r"(?:सम्मन|समन|तलबी)", 2, H), (r"कारण\s+बताओ\s+नोटिस", 3, H), (r"गिरफ्तारी\s+वारंट|जमानती\s+वारंट", 3, H),
        ],
    },
    "RTI Application / Reply": {
        "folder": "02 · Court Filings",
        "rules": [
            (r"\bright\s+to\s+information\s+act\b", 3, A), (r"\bpublic\s+information\s+officer\b|\bpio\b", 3, A), (r"\bsection\s+6\(1\)\b|\bsection\s+19\(1\)\b", 3, A),
            (r"\bfirst\s+appellate\s+authority\b", 3, A), (r"\bcentral\s+information\s+commission\b|\bstate\s+information\s+commission\b", 2, A), (r"\brti\b", 2, A),
            (r"सूचना\s+का\s+अधिकार", 3, A), (r"जन\s+सूचना\s+अधिकारी", 3, A),
        ],
    },
    "Correspondence / Letter": {
        "folder": "04 · Correspondence",
        "rules": [
            (r"\bdear\s+(?:sir|madam|mr|ms|mrs|shri|smt)\b", 3, H), (r"\byours\s+(?:faithfully|sincerely|truly)\b|\bwith\s+regards\b|\bregards\b", 2, A),
            (r"^\s*(?:sub(?:ject)?|re|ref)\s*[:.-]", 2, H), (r"^\s*from:\s|^\s*to:\s|^\s*cc:\s", 2, H), (r"\bplease\s+find\s+(?:attached|enclosed)\b", 2, A),
            (r"\bkindly\s+(?:acknowledge|confirm|let\s+us\s+know)\b", 2, A),
        ],
    },
    "Invoice / Fee Note": {
        "folder": None,
        "rules": [
            (r"\b(?:tax\s+)?invoice\b", 3, H), (r"\bgstin\b", 3, A), (r"\bfee\s+(?:note|bill|memo|receipt)\b", 3, H), (r"\bbill\s+no\b|\binvoice\s+no\b", 2, H),
            (r"\btotal\s+(?:amount|payable|due)\b", 2, A), (r"\b(?:cgst|sgst|igst)\b", 2, A), (r"\bhsn\b|\bsac\b", 1, A), (r"\bprofessional\s+(?:fee|charges)\b", 2, A),
        ],
    },
    "ID / KYC Document": {
        "folder": None,
        "rules": [
            (r"\bunique\s+identification\s+authority\s+of\s+india\b|\baadhaar\b", 3, A), (r"\bpermanent\s+account\s+number\b|\bincome\s+tax\s+department\b", 3, H),
            (r"\belection\s+commission\s+of\s+india\b|\belector['’]?s\s+photo\b", 3, H), (r"\bpassport\b.*\brepublic\s+of\s+india\b", 3, H),
            (r"\bdriving\s+licen[cs]e\b", 3, H), (r"\bdate\s+of\s+birth\b|\bdob\b", 1, H),
        ],
    },
    "Exhibit / Annexure": {
        "folder": "03 · Evidence & Exhibits",
        "rules": [
            (r"^\s*(?:annexure|annexures|exhibit|ex\.)\s*[-:.]?\s*[a-z]{0,2}[-\s]?\d+\b", 3, H), (r"\bmarked\s+(?:as\s+)?ex(?:hibit|\.)\b", 3, A),
            (r"\bex\.?\s*[pdrc][-\s]?\d+\b", 2, A), (r"^\s*list\s+of\s+(?:documents|annexures|exhibits)\b", 3, H),
        ],
    },
    "Legal Opinion / Research Note": {
        "folder": "05 · Research & Precedents",
        "rules": [
            (r"\blegal\s+opinion\b|\bopinion\s+on\b", 3, H), (r"\bmemorandum\s+of\s+law\b|\bresearch\s+(?:note|memo)\b|\bnote\s+on\b", 3, H),
            (r"\bissues?\s+for\s+consideration\b|\bquestions?\s+presented\b", 2, A), (r"\bconclusion\b", 1, A), (r"\bin\s+my\s+(?:considered\s+)?opinion\b", 2, A),
            (r"\bbrief\s+facts\b", 1, A), (r"\bwritten\s+submissions\b|\bwritten\s+arguments\b", 3, H), (r"\bcase\s+(?:brief|summary)\b|\bnotes\s+of\s+arguments\b", 2, H),
        ],
    },
}

FILENAME_HINTS = [
    (r"affidavit", "Affidavit"), (r"vakalat|vakalath", "Vakalatnama / Authorisation"), (r"legal[\s_-]*notice|\bnotice\b", "Legal Notice"),
    (r"\border\b|order[\s_-]*sheet|\bord\b", "Court Order"), (r"judg(?:e)?ment|\bjudg\b", "Judgment"), (r"\bfir\b|charge[\s_-]*sheet", "FIR / Police Record"),
    (r"agreement|\bmou\b|contract", "Agreement / Contract"), (r"\bdeed\b|\bpoa\b|power[\s_-]*of[\s_-]*attorney", "Deed / Property Document"),
    (r"bail", "Bail Application"), (r"written[\s_-]*statement|\bws\b|counter", "Written Statement / Reply"), (r"petition|plaint", "Petition / Plaint"),
    (r"invoice|fee[\s_-]*note|\bbill\b", "Invoice / Fee Note"), (r"\brti\b", "RTI Application / Reply"), (r"annexure|exhibit|\bex[\s_-]?[pd]\b", "Exhibit / Annexure"),
    (r"aadhaar|aadhar|\bpan\b|passport|voter|driving", "ID / KYC Document"), (r"summons|cause[\s_-]*list", "Summons / Court Notice"),
]

CLASS_NAMES = list(CLASSES.keys()) + ["Unclassified"]
ROUGH_FOLDERS = ["01 · Pleadings & Drafts", "02 · Court Filings", "03 · Evidence & Exhibits", "04 · Correspondence", "05 · Research & Precedents"]

_COMPILED = {
    name: [(re.compile(p, re.I | re.M), w, z) for p, w, z in spec["rules"]] for name, spec in CLASSES.items()
}
_FNAME = [(re.compile(p, re.I), c) for p, c in FILENAME_HINTS]

AUTO_CONFIDENCE = 0.72      # at/above: filed under this label automatically (still editable)
MIN_CONFIDENCE = 0.45       # below: "Unclassified" + review queue


# ── case number / court / party / date extraction ────────────────────────────────────
CASE_TYPES = (
    # spelled-out forms first (a long form must win over the short form that starts the same way)
    r"WRIT\s+PETITION\s*(?:\([A-Z]{1,8}\))?|WRIT\s+APPEAL|CIVIL\s+APPEAL|CRIMINAL\s+APPEAL|CIVIL\s+SUIT|ORIGINAL\s+SUIT|SESSIONS\s+CASE|COMPLAINT\s+CASE|CONSUMER\s+(?:CASE|COMPLAINT)|"
    r"EXECUTION\s+(?:PETITION|APPLICATION)|MISC(?:ELLANEOUS|\.)?\s*(?:APPEAL|PETITION|APPLICATION|CASE)|CRIMINAL\s+(?:MISC\.?\s+)?(?:PETITION|CASE|REVISION)|BAIL\s+APPL(?:ICATION|N)?\.?|"
    r"(?:REGULAR\s+)?(?:FIRST|SECOND)\s+APPEAL|LETTERS?\s+PATENT\s+APPEAL|ARBITRATION\s+(?:PETITION|APPEAL|CASE)|REVIEW\s+PETITION|CONTEMPT\s+(?:PETITION|CASE)|"
    r"TRANSFER\s+PETITION|SPECIAL\s+LEAVE\s+PETITION|MATRIMONIAL\s+(?:CASE|PETITION)|MOTOR\s+ACCIDENTS?\s+CLAIMS?\s+(?:PETITION|CASE)|COMPANY\s+(?:PETITION|APPLICATION)|"
    r"वाद\s*(?:संख्या|क्रमांक)|प्रकरण\s*(?:संख्या|क्रमांक)|केस\s*(?:संख्या|नंबर)|याचिका\s*(?:संख्या|क्रमांक)|अपील\s*(?:संख्या|क्रमांक)|"
    # abbreviations - the many-letter ones before the ones they start with
    r"M\.?\s?A\.?\s?C\.?\s?(?:P|A|T)\.?|MAC\.?\s?(?:APP|PET)\.?|CRL\.?\s?L\.?\s?P\.?|CRL\.?\s?REV\.?\s?P\.?|CRL\.?\s?REV\.?|CO\.?\s?(?:PET|APPL)\.?|"
    r"O\.?\s?M\.?\s?P\.?|L\.?\s?P\.?\s?A\.?|R\.?\s?S\.?\s?A\.?|R\.?\s?C\.?\s?(?:A|S)\.?|C\.?\s?C\.?\s?P\.?|EX\.?\s?(?:P|A)\.?|E\.?\s?F\.?\s?A\.?|"
    r"M\.?\s?F\.?\s?A\.?|H\.?\s?C\.?\s?P\.?|I\.?\s?T\.?\s?A\.?|L\.?\s?A\.?\s?C\.?|R\.?\s?P\.?|M\.?\s?C\.?|"
    r"W\.?\s?P\.?\s?(?:\([A-Z]{1,4}\)|(?:CRL|CIVIL|C)(?![A-Za-z]))?|W\.?\s?A\.?|WMP|CRL\.?\s?M\.?\s?C\.?|CRL\.?\s?O\.?\s?P\.?|CRL\.?\s?A\.?|CRL\.?\s?R\.?\s?C\.?|"
    r"CRL\.?\s?M\.?\s?P\.?|ABA|O\.?\s?S\.?|C\.?\s?S\.?|S\.?\s?C\.?|C\.?\s?C\.?|C\.?\s?M\.?\s?A\.?|C\.?\s?M\.?\s?P\.?|"
    r"C\.?\s?R\.?\s?P\.?|A\.?\s?S\.?|S\.?\s?A\.?|F\.?\s?A\.?\s?O\.?|R\.?\s?F\.?\s?A\.?|M\.?\s?C\.?\s?O\.?\s?P\.?|SLP\s?(?:\([A-Z]{1,4}\)|(?:CRL|CIVIL|C)(?![A-Za-z]))?|C\.?\s?A\.?|"
    r"T\.?\s?P\.?\s?(?:\([A-Z]{1,4}\)|(?:CRL|CIVIL|C)(?![A-Za-z]))?|ARB\.?\s?P\.?|ARB\.?\s?A\.?|COMM\.?\s?(?:S\.?|A\.?)?|I\.?\s?A\.?|E\.?\s?P\.?|E\.?\s?A\.?|O\.?\s?A\.?|"
    r"C\.?\s?P\.?\s?(?:\([A-Z]{1,4}\)|(?:CRL|CIVIL|C)(?![A-Za-z]))?|H\.?\s?M\.?\s?O\.?\s?P\.?|O\.?\s?P\.?|R\.?\s?C\.?|CONT\.?\s?CAS\.?|PIL|CR\.?|"
    r"NI\s?ACT|M\.?\s?A\.?|DFR"
)
# Many courts write the bench / side / stream in brackets after the type: CS(OS) 12/2020, CP(IB) 3/2021,
# ARB.A.(COMM.) 4/2022. The bracket is part of the type, so it is folded into the same group.
_TYPE_SUFFIX = r"(?:\s*\(\s*[A-Za-z][A-Za-z.&\s]{0,11}\))*"
CASE_RE = re.compile(
    rf"(?<![A-Za-z])(?P<type>(?:{CASE_TYPES}){_TYPE_SUFFIX})\s*(?:No\.?|Nos\.?|Number|\bNo\b)?\s*[:.\-]?\s*(?P<num>\d{{1,6}})\s*(?:/|\s+of\s+|-)\s*(?P<year>(?:19|20)\d{{2}})\b",
    re.I,
)
# FIRs are police records, not court case numbers - kept in their own field so a bail
# application is not "filed under" the FIR number.
FIR_RE = re.compile(
    r"(?<![A-Za-z])(?:F\.?\s?I\.?\s?R\.?|first\s+information\s+report|crime|अपराध|एफ\.?\s?आई\.?\s?आर\.?)\s*(?:No\.?|Nos\.?|Number|क्रमांक|संख्या)?\s*[:.\-]?\s*(?P<num>\d{1,6})\s*(?:/|\s+of\s+|-)\s*(?P<year>(?:19|20)\d{2})\b",
    re.I,
)
# Sub-numbers inside a case (interim applications etc.) - listed after the main case number.
_SUB_TYPES = {"IA", "WMP", "CRLMP", "CMP"}
CNR_RE = re.compile(r"\b([A-Z]{4}\d{12})\b")
_NOT_CASE_CONTEXT = re.compile(r"(?:act|section|sec\.?|article|art\.?|rule|order|clause|para(?:graph)?|regulation|notification|circular|gst|invoice|bill)\s*(?:no\.?)?\s*$", re.I)

_COURT_LINE = re.compile(
    r"(?:supreme\s+court\s+of\s+india|high\s+court\s+of\s+judicature\s+(?:at|for)\s+[a-z]+(?:\s+[a-z]+){0,2}|high\s+court\s+of\s+[a-z]+(?:\s+(?:and\s+)?[a-z]+){0,3}(?:\s+at\s+[a-z]+(?:\s+[a-z]+)?)?|"
    r"court\s+of\s+the\s+[a-z .\-]{3,60}?(?:judge|magistrate|munsif|court)(?:\s*,\s*[a-z .\-]{3,40})?|"
    r"(?:principal\s+|additional\s+|chief\s+)?(?:district|sessions|family|civil|small\s+causes|city\s+civil|labour|commercial)\s+(?:and\s+sessions\s+)?(?:court|judge)(?:\s*,\s*[a-z .\-]{3,40})?|"
    r"(?:district|state|national)\s+consumer\s+disputes\s+redressal\s+commission(?:\s*,\s*[a-z .\-]{3,40})?|national\s+company\s+law\s+(?:appellate\s+)?tribunal(?:\s*,\s*[a-z .\-]{3,40})?|"
    r"debts?\s+recovery\s+(?:appellate\s+)?tribunal(?:\s*,\s*[a-z .\-]{3,40})?|motor\s+accidents?\s+claims?\s+tribunal(?:\s*,\s*[a-z .\-]{3,40})?|income\s+tax\s+appellate\s+tribunal(?:\s*,\s*[a-z .\-]{3,40})?|"
    r"(?:metropolitan|judicial)\s+magistrate(?:\s*,\s*[a-z .\-]{3,40})?|labour\s+court(?:\s*,\s*[a-z .\-]{3,40})?|industrial\s+tribunal(?:\s*,\s*[a-z .\-]{3,40})?|"
    r"(?:माननीय\s+)?(?:सर्वोच्च\s+न्यायालय|उच्च\s+न्यायालय[^\n]{0,40}|जिला\s+(?:एवं\s+सत्र\s+)?न्यायालय[^\n]{0,40}))",
    re.I,
)
_SMALL_WORDS = {"of", "at", "the", "and", "for", "in"}


def _smart_title(s):
    words = s.split()
    out = []
    for i, w in enumerate(words):
        lw = w.lower()
        out.append(lw if (i and lw in _SMALL_WORDS) else (w if not w.isascii() else lw.capitalize()))
    return " ".join(out)


_ROLE_TAIL = re.compile(r"[\s.…_\-–,:;]*(?:\(?\d*\)?\s*)?(?:\b(?:petitioners?|respondents?|appellants?|defendants?|plaintiffs?|applicants?|complainants?|accused|opposite\s+part(?:y|ies)|revision\s+petitioners?|claimants?)\b|याचिकाकर्ता|प्रतिवादी|वादी|अपीलार्थी|प्रत्यर्थी|आवेदक|अभियुक्त|परिवादी).*$", re.I)
_PARTY_VS = re.compile(r"^(?P<a>.{3,90}?)\s+(?:v/s\.?|vs\.?|v\.|versus|बनाम)\s+(?P<b>.{3,90})$", re.I)
_PARTY_ALONE = re.compile(r"^(?:v/s\.?|vs\.?|v\.|versus|बनाम)$", re.I)

_MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"], start=1)}
_MON_ALT = "|".join(list(_MONTHS.keys()) + [m[:3] for m in _MONTHS])
_DATE_NUM = re.compile(r"\b(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*((?:19|20)\d{2})\b")
_DATE_TXT1 = re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s*(?:day\s+of\s+)?({_MON_ALT})\.?,?\s*((?:19|20)\d{{2}})\b", re.I)
_DATE_TXT2 = re.compile(rf"\b({_MON_ALT})\.?\s*(\d{{1,2}})(?:st|nd|rd|th)?,?\s*((?:19|20)\d{{2}})\b", re.I)
_NEXT_DATE = re.compile(
    r"(?:list(?:ed)?|post(?:ed)?|put\s+up|adjourn(?:ed)?|call(?:ed)?|next\s+date(?:\s+of\s+hearing)?(?:\s+is)?|re[- ]?list|"
    r"अगली\s+(?:तारीख|सुनवाई|पेशी)|आगामी\s+(?:तिथि|तारीख)|पेशी\s+(?:की\s+)?(?:तिथि|तारीख))\s*(?:the\s+matter\s+)?(?:on|for|to|:)?\s*[:\-]?\s*"
    r"(?P<d>\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*(?:19|20)\d{2}|\d{1,2}(?:st|nd|rd|th)?\s*(?:day\s+of\s+)?(?:%s)\.?,?\s*(?:19|20)\d{2}|(?:%s)\.?\s*\d{1,2}(?:st|nd|rd|th)?,?\s*(?:19|20)\d{2})" % (_MON_ALT, _MON_ALT),
    re.I,
)

_AADHAAR_RE = re.compile(r"(?<!\d)(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})(?!\d)")
_PAN_RE = re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")

_VERHOEFF_D = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
               [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
               [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]]
_VERHOEFF_P = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
               [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]]


def _verhoeff_ok(num):
    c = 0
    for i, ch in enumerate(reversed(num)):
        c = _VERHOEFF_D[c][_VERHOEFF_P[i % 8][int(ch)]]
    return c == 0


def _valid_date(y, m, d):
    try:
        dt = date(int(y), int(m), int(d))
    except ValueError:
        return None
    if not (1950 <= dt.year <= date.today().year + 10):
        return None
    return dt.isoformat()


def parse_dates(text):
    """[(position, iso)] for every recognisable date in text, in order of appearance."""
    out = []
    for m in _DATE_NUM.finditer(text):
        iso = _valid_date(m.group(3), m.group(2), m.group(1))   # Indian order: dd.mm.yyyy
        if iso:
            out.append((m.start(), iso))
    for m in _DATE_TXT1.finditer(text):
        mon = _MONTHS.get(m.group(2).lower()) or next((v for k, v in _MONTHS.items() if k.startswith(m.group(2).lower()[:3])), None)
        iso = _valid_date(m.group(3), mon, m.group(1)) if mon else None
        if iso:
            out.append((m.start(), iso))
    for m in _DATE_TXT2.finditer(text):
        mon = _MONTHS.get(m.group(1).lower()) or next((v for k, v in _MONTHS.items() if k.startswith(m.group(1).lower()[:3])), None)
        iso = _valid_date(m.group(3), mon, m.group(2)) if mon else None
        if iso:
            out.append((m.start(), iso))
    return sorted(out)


_LONG_FORMS = [
    (r"\bREGULAR\s+FIRST\s+APPEAL\b", "RFA"), (r"\bREGULAR\s+SECOND\s+APPEAL\b", "RSA"), (r"\bFIRST\s+APPEAL\b", "FA"), (r"\bSECOND\s+APPEAL\b", "SA"),
    (r"\bWRIT\s+PETITION\b", "WP"), (r"\bWRIT\s+APPEAL\b", "WA"), (r"\bLETTERS?\s+PATENT\s+APPEAL\b", "LPA"), (r"\bCIVIL\s+APPEAL\b", "CA"),
    (r"\bCRIMINAL\s+APPEAL\b", "CRLA"), (r"\bCIVIL\s+SUIT\b", "CS"), (r"\bORIGINAL\s+SUIT\b", "OS"), (r"\bSESSIONS\s+CASE\b", "SC"),
    (r"\bCONSUMER\s+(?:CASE|COMPLAINT)\b", "CC"), (r"\bCOMPLAINT\s+CASE\b", "CC"), (r"\bEXECUTION\s+PETITION\b", "EP"), (r"\bEXECUTION\s+APPLICATION\b", "EA"),
    (r"\bMISC(?:ELLANEOUS|\.)?\s*APPEAL\b", "MA"), (r"\bARBITRATION\s+PETITION\b", "ARBP"), (r"\bARBITRATION\s+APPEAL\b", "ARBA"),
    (r"\bREVIEW\s+PETITION\b", "RP"), (r"\bTRANSFER\s+PETITION\b", "TP"), (r"\bSPECIAL\s+LEAVE\s+PETITION\b", "SLP"),
    (r"\bMATRIMONIAL\s+(?:CASE|PETITION)\b", "MC"), (r"\bMOTOR\s+ACCIDENTS?\s+CLAIMS?\s+(?:PETITION|CASE)\b", "MACP"), (r"\bCOMPANY\s+PETITION\b", "COPET"),
    (r"\bCRIMINAL\s+MISC\.?\s+PETITION\b", "CRLMP"), (r"\bBAIL\s+APPL(?:ICATION|N)?\b", "BAILAPPLN"),
]
_BRACKET_FORMS = [(r"\(\s*CIVIL\s*\)", "(C)"), (r"\(\s*(?:CRIMINAL|CRL\.?)\s*\)", "(CRL)"), (r"\(\s*(?:COMMERCIAL|COMM\.?)\s*\)", "(COMM)"),
                  (r"\(\s*(?:ORIGINAL\s+SIDE|O\.?\s?S\.?)\s*\)", "(OS)")]


def case_key(ctype, num, year):
    """Matching key: 'W.P.(C) 1234/2024', 'WPC No. 1234 of 2024' and 'Writ Petition (Civil) 1234/2024' all
    become 'WPC 1234/2024'; 'Civil Appeal 55/2021' and 'C.A. 55/2021' both become 'CA 55/2021'."""
    t = re.sub(r"\s+", " ", ctype).upper()
    for pat, rep in _LONG_FORMS:
        t = re.sub(pat, rep, t)
    for pat, rep in _BRACKET_FORMS:
        t = re.sub(pat, rep, t)
    t = re.sub(r"[\s.()&]", "", t)
    return f"{t} {int(num)}/{year}"


def _display_case(ctype, num, year):
    t = re.sub(r"\s+", " ", ctype).strip()
    if t.isascii() and t.islower():
        t = t.upper() if len(re.sub(r"[^A-Za-z]", "", t)) <= 4 else t.title()
    return f"{t} {int(num)}/{year}"


def _case_hits(zone):
    hits = []
    for m in CASE_RE.finditer(zone):
        ctype = m.group("type")
        base = re.sub(r"\([^)]*\)", "", ctype)
        letters = re.sub(r"[^A-Za-z]", "", base)
        # 1-3 letter types ("as 12/2020", "sa 3/2019") only count when written in capitals; a lower-case
        # "as" or "cs" before a number is ordinary English far more often than a case type.
        if letters and len(letters) <= 3 and not base.isupper():
            continue
        prefix = zone[max(0, m.start() - 14):m.start()]
        if _NOT_CASE_CONTEXT.search(prefix):
            continue
        hits.append((m.start(), case_key(ctype, m.group("num"), m.group("year")), _display_case(ctype, m.group("num"), m.group("year"))))
    return hits


def extract_case_numbers(text):
    """(own_numbers_from_head, mentions_from_body). Head = the caption, where the document's OWN
    case number lives; numbers cited later (precedents, earlier proceedings) are mentions only."""
    seen, head, body = set(), [], []
    for zone, bucket in ((text[:1200], head), (text[1200:60000], body)):
        for _pos, key, shown in _case_hits(zone):
            if key in seen:
                continue
            seen.add(key)
            bucket.append((key, shown))
            if len(bucket) >= 8:
                break
    def order(lst):   # main case number first, interim-application numbers after
        return [shown for key, shown in sorted(lst, key=lambda kv: kv[0].split(" ")[0] in _SUB_TYPES)]
    return order(head)[:6], order(body)[:6]


def case_token(key):
    """'WPC 1234/2024' -> 'wpc12342024': one punctuation-free token, so 'W.P.(C) 1234/2024',
    'WPC No. 1234 of 2024' and 'wp(c) 1234/2024' are all the same search term."""
    return re.sub(r"[^a-z0-9\u0900-\u0dff]", "", key.lower())


def case_tokens(text):
    """Search tokens for every case / FIR number written in text (page-level, no head/body split)."""
    toks = {case_token(key) for _p, key, _shown in _case_hits(text)}
    for m in FIR_RE.finditer(text):
        toks.add(case_token(f"FIR {int(m.group('num'))}/{m.group('year')}"))
    return toks


def extract_fir_numbers(text):
    out = []
    for m in FIR_RE.finditer(text[:60000]):
        v = f"FIR {int(m.group('num'))}/{m.group('year')}"
        if v not in out:
            out.append(v)
        if len(out) >= 4:
            break
    return out


def extract_court(text):
    lines = [l.strip() for l in text[:3000].splitlines() if l.strip()][:30]
    for line in lines:
        if len(line) > 160:
            continue
        m = _COURT_LINE.search(line)
        if m:
            c = re.sub(r"\s+", " ", m.group(0)).strip(" ,.-:;")
            return _smart_title(c) if (c.isupper() or c.islower()) else c
    return None


def _clean_party(s):
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"^\W*(?:\d+[.)]\s*)+", "", s)
    s = _ROLE_TAIL.sub("", s)
    s = re.sub(r"\s*[,;].*$", "", s) if len(s) > 60 else s
    return s.strip(" .,-:;_…")


def extract_parties(text):
    lines = [l.strip() for l in text[:6000].splitlines() if l.strip()][:70]
    for i, line in enumerate(lines):
        if len(line) > 200 or "|" in line or "\t" in line:     # spreadsheet / table rows are not captions
            continue
        m = _PARTY_VS.match(line)
        if m:
            a, b = _clean_party(m.group("a")), _clean_party(m.group("b"))
            if 2 <= len(a) <= 70 and 2 <= len(b) <= 70 and not re.search(r"\b(?:section|article|order|rule|act)\b", a + b, re.I):
                return f"{a} vs {b}"
        if _PARTY_ALONE.match(line) and 0 < i < len(lines) - 1:
            a, b = _clean_party(lines[i - 1]), _clean_party(lines[i + 1])
            if 2 <= len(a) <= 70 and 2 <= len(b) <= 70:
                return f"{a} vs {b}"
        if _PARTY_ALONE.match(line) and i >= 2 and i < len(lines) - 2:
            # "A ... Petitioner \n VERSUS \n B ... Respondent" with a role line between name and VS
            a, b = _clean_party(lines[i - 2]), _clean_party(lines[i + 2])
            if 2 <= len(a) <= 70 and 2 <= len(b) <= 70 and _ROLE_TAIL.search(lines[i - 1] + " x"):
                return f"{a} vs {b}"
    return None


def detect_pii(text):
    found = []
    for m in _AADHAAR_RE.finditer(text[:200000]):
        digits = "".join(m.groups())
        if digits[0] in "01" or len(set(digits)) == 1:
            continue
        if _verhoeff_ok(digits):
            found.append("Aadhaar number")
            break
    if _PAN_RE.search(text[:200000]):
        found.append("PAN")
    return found


def detect_scripts(text):
    sample = text[:20000]
    n = max(1, sum(1 for c in sample if c.isalpha()))
    scripts = []
    for name, lo, hi in (("Devanagari", 0x900, 0x97F), ("Tamil", 0xB80, 0xBFF), ("Telugu", 0xC00, 0xC7F), ("Kannada", 0xC80, 0xCFF),
                         ("Malayalam", 0xD00, 0xD7F), ("Bengali", 0x980, 0x9FF), ("Gujarati", 0xA80, 0xAFF)):
        if sum(1 for c in sample if lo <= ord(c) <= hi) / n > 0.08:
            scripts.append(name)
    return scripts


# ── main entry ───────────────────────────────────────────────────────────────────────
def _score(text, filename):
    body = text[:20000]
    # "W.P.(C) 123/2024", "BAIL APPLN. 5/2025", "CIVIL APPEAL NO. 9 OF 2019" in the caption say what the
    # CASE is; an order or judgment in that case carries the same caption. Do not let it vote.
    head = CASE_RE.sub(" ", text[:1500])
    scores, evidence = {}, {}
    for name, rules in _COMPILED.items():
        s, ev = 0.0, []
        for rx, w, zone in rules:
            if w <= 0:
                continue
            m = rx.search(head if zone == H else body)
            if m:
                s += w
                snippet = re.sub(r"\s+", " ", m.group(0)).strip()[:60]
                if snippet:
                    ev.append(snippet)
        scores[name], evidence[name] = s, ev
    fname = re.sub(r"[_\-.]+", " ", (filename or "").rsplit(".", 1)[0])
    fname_hit = None
    for rx, cname in _FNAME:
        if rx.search(fname):
            scores[cname] = scores.get(cname, 0) + 1.5
            evidence.setdefault(cname, []).append(f"file name “{fname[:40]}”")
            fname_hit = cname
            break
    return scores, evidence, fname_hit


def classify(text, filename="", kind=""):
    """Returns dict(doc_class, confidence, evidence, alternatives)."""
    text = prep_text(text)
    if kind == "eml":
        return {"doc_class": "Correspondence / Letter", "confidence": 0.9, "evidence": ["e-mail message"], "alternatives": []}
    if len(text.strip()) < 40:
        scores, ev, fh = _score("", filename)
        if fh and scores.get(fh, 0) >= 1.5:
            return {"doc_class": fh, "confidence": 0.5, "evidence": ev.get(fh, []), "alternatives": [], "from_name_only": True}
        return {"doc_class": "Unclassified", "confidence": 0.0, "evidence": [], "alternatives": []}
    scores, evidence, _ = _score(text, filename)
    ranked = sorted(((s, n) for n, s in scores.items() if s > 0), reverse=True)
    if not ranked:
        return {"doc_class": "Unclassified", "confidence": 0.0, "evidence": [], "alternatives": []}
    s1, best = ranked[0]
    s2 = ranked[1][0] if len(ranked) > 1 else 0.0
    base = min(1.0, s1 / 7.0)
    margin = (s1 - s2) / s1
    conf = round(base * (0.45 + 0.55 * margin), 2)
    alts = [{"doc_class": n, "score": round(s, 1)} for s, n in ranked[1:3] if s >= max(2.0, s1 * 0.5)]
    if conf < MIN_CONFIDENCE:
        return {"doc_class": "Unclassified", "confidence": conf, "evidence": evidence.get(best, [])[:4],
                "alternatives": [{"doc_class": best, "score": round(s1, 1)}] + alts, "below_threshold": True}
    return {"doc_class": best, "confidence": conf, "evidence": evidence.get(best, [])[:5], "alternatives": alts}


_GENERIC_NAME = re.compile(r"^(?:scan|img|image|dsc|doc|document|file|new|untitled|copy of|whatsapp|screenshot|photo|pic|cam|cs|scanned|page|\d+)[\s_\-.\d()]*$", re.I)


_DEV_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
_DATE_LABEL = re.compile(
    r"(?:\bdated?\b|\bdt\b\.?|\bdate\s+of\s+(?:order|judg(?:e)?ment|filing|notice|decision|hearing)\b|\bthis\s+the\b|\bmade\s+(?:and\s+(?:entered|executed)\s+)?(?:on|at)\b|"
    r"\bentered\s+into\s+on\b|\bexecuted\s+on\b|\bsigned\s+on\b|\bpronounced\s+on\b|\bdelivered\s+on\b|\bdecided\s+on\b|\bdate\s+of\s+pronouncement\b|दिनांक|तारीख|दिन\s*ांक)\s*[:.\-]?",
    re.I,
)
_NOT_DOC_DATE_CTX = re.compile(r"(?:dob|birth|born|since|w\.?e\.?f\.?|from|till|until|upto|before|after|expir|valid|custody|arrest|incident|occurr|جन्म|जन्म)[^\n]{0,18}$", re.I)


_NOT_DATE_GAP = re.compile(r"\b(?:birth|death|marriage|incident|arrest|accident|offence|occurrence|expiry|joining|retirement|admission|dob)\b|जन्म|मृत्यु", re.I)
_WEAK_DATE_LABEL = re.compile(r"(?:dated?|dt\.?|दिनांक|तारीख|दिन\s*ांक)\s*[:.\-]?", re.I)


def prep_text(text):
    """NFC-normalise (PDF and OCR engines compose Devanagari differently) and read Devanagari digits."""
    return unicodedata.normalize("NFC", text or "").translate(_DEV_DIGITS)


def guess_doc_date(text):
    """Only trust a date that is *labelled* as the document's own ('Date:', 'Dated this', 'made on',
    'दिनांक') near the top or the signature block, or that stands alone on a letterhead line.
    A bare date in the body (custody since..., DOB...) is a fact about something else, not the
    document's date - better to say nothing than to file a bail application under its arrest date."""
    zones = [text[:2500], text[-2000:] if len(text) > 4500 else ""]
    for zone in zones:
        for m in _DATE_LABEL.finditer(zone):
            # "Date:" / "dated" / "दिनांक" mean the document's own date only near the start of a line
            # ("Place: Delhi   Date: 12.03.2025"); mid-sentence "the order dated 12.03.2025" is another
            # document's date. Phrases like "made on" / "executed on" / "this the" are always its own.
            weak = _WEAK_DATE_LABEL.fullmatch(m.group(0).strip()) is not None
            if weak:
                line_start = zone.rfind("\n", 0, m.start()) + 1
                prelude = zone[line_start:m.start()]
                if len(prelude) > 28:
                    continue
                # "As per the order dated 10.02.2019": lower-case words before the label = a sentence about
                # ANOTHER document. "Place: Delhi   Date:", "Judgment dated" and a bare "Date:" are the document's own.
                if any(t.isascii() and t.isalpha() and t.islower() for t in re.findall(r"[^\s:;,.\-|/()]+", prelude)):
                    continue
                if len(re.findall(r"[\u0900-\u097f]+", prelude)) >= 3:
                    continue
            tail = zone[m.end():m.end() + 45]
            for pos, iso in parse_dates(tail):
                if pos <= 14 and not _NOT_DOC_DATE_CTX.search(zone[max(0, m.start() - 24):m.start()]) and not _NOT_DATE_GAP.search(tail[:pos]):
                    return iso
                break
    for line in [l.strip() for l in text[:1200].splitlines() if l.strip()][:12]:
        if len(line) <= 28:
            found = parse_dates(line)
            if found and not _NOT_DOC_DATE_CTX.search(line):
                return found[0][1]
    return None


def analyse(text, filename="", kind=""):
    """Full analysis used by the ingest worker. Pure function of (text, filename, kind)."""
    text = prep_text(text)
    cls = classify(text, filename, kind)
    head_cases, mentions = extract_case_numbers(text)
    doc_date = guess_doc_date(text)
    next_hearing = None
    if cls["doc_class"] in ("Court Order", "Judgment", "Summons / Court Notice", "Unclassified"):
        for m in _NEXT_DATE.finditer(text[:30000]):
            d = parse_dates(m.group("d"))
            if d and (doc_date is None or d[0][1] >= doc_date):
                next_hearing = d[0][1]        # the LAST such phrase in an order is the operative one
    meta = {
        "case_numbers": head_cases,
        "case_mentions": mentions[:6],
        "fir_numbers": extract_fir_numbers(text),
        "cnr": sorted(set(CNR_RE.findall(text[:6000])))[:3],
        "court": extract_court(text),
        "parties": extract_parties(text),
        "doc_date": doc_date,
        "next_hearing": next_hearing,
        "pii": detect_pii(text),
        "scripts": detect_scripts(text),
    }
    folder = CLASSES.get(cls["doc_class"], {}).get("folder") if cls["doc_class"] != "Unclassified" else None
    title = None
    stem = (filename or "").rsplit(".", 1)[0]
    if _GENERIC_NAME.match(stem.strip()) and cls["doc_class"] != "Unclassified":
        label = cls["doc_class"].split(" / ")[0]
        bits = [label]
        if meta["parties"]:
            bits.append(meta["parties"])
        elif meta["case_numbers"] or meta["fir_numbers"]:
            ref = (meta["case_numbers"] or meta["fir_numbers"])[0]
            if not ref.lower().startswith(label.lower()):
                bits.append(ref)
        if meta["doc_date"]:
            bits.append(meta["doc_date"])
        if len(bits) > 1:
            title = " — ".join(bits)[:140]
    return {"class": cls, "meta": meta, "suggested_folder": folder, "suggested_title": title}
