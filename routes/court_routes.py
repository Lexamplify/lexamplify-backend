from __future__ import annotations

import os
import re
import sqlite3
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse, quote

import requests
from bs4 import BeautifulSoup
from flask import Blueprint, render_template, jsonify, request, make_response

court_bp = Blueprint('court', __name__)

# ── DB path (relative to this file → instance/client_data.db) ─────────────────
_DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'instance', 'client_data.db')

_EVENT_CACHE_SCHEMA = """
CREATE TABLE IF NOT EXISTS event_cache (
    event_id     TEXT     PRIMARY KEY,
    title        TEXT,
    description  TEXT,
    event_date   TEXT,
    venue        TEXT,
    organizer    TEXT,
    register_url TEXT,
    raw_content  TEXT,
    source_url   TEXT,
    cached_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""

# ── Backend court data (moved from frontend JS) ────────────────────

_HC = {
    'delhi': {
        'name': 'Delhi High Court',
        'url': 'https://delhihighcourt.nic.in',
        'efiling': 'https://efiling.delhihighcourt.nic.in',
        'causelist': 'https://delhihighcourt.nic.in/web/cause-lists/cause-list',
        'casestatus': 'https://delhihighcourt.nic.in/case_status',
        'orders': 'https://delhihighcourt.nic.in/orders',
        'judgments': 'https://delhihighcourt.nic.in/judgments',
        'epass': 'https://epass.delhihighcourt.nic.in',
        'displayboard': 'https://delhihighcourt.nic.in/display',
        'judges': [
            {'name': "HON'BLE THE CHIEF JUSTICE DEVENDRA KUMAR UPADHYAYA & HON'BLE MR. JUSTICE TEJAS KARIA", 'room': '1 (DB-I)', 'vc': 'https://dhcvirtualcourt.webex.com/meet/dhcvirtualcourt9', 'meetId': '25125678824', 'email': 'courtmasterdbone@gmail.com / courtmaster253@gmail.com'},
            {'name': "HON'BLE MR. JUSTICE V KAMESWAR RAO & HON'BLE MR. JUSTICE MANMEET PRITAM SINGH ARORA", 'room': '37 (BD-II)', 'vc': 'https://dhcvirtualcourt.webex.com/meet/dhcvirtualcourt18', 'meetId': '1664 12 4933', 'email': 'cmrajeevkumar.dhc@gov.in'},
            {'name': "HON'BLE MR. JUSTICE NITIN WASUDEO SAMBRE & HON'BLE MR. JUSTICE AJAY DIGPAUL", 'room': '38 (DB-III)', 'vc': 'https://dhcvirtualcourt.webex.com/meet/dhcvirtualcourt15', 'meetId': '25161366727', 'email': 'cmatishgoel@gmail.com / faisal.zaki@dhc.nic.in'},
            {'name': "HON'BLE MR. JUSTICE DINESH MEHTA & HON'BLE MR. JUSTICE VINOD KUMAR", 'room': '33 (BD-IV)', 'vc': 'https://virtualcourtdhc.webex.com/meet/virtualcourtdhc8', 'meetId': '25158151075', 'email': ''},
            {'name': "HON'BLE MR. JUSTICE VIVEK CHAUDHARY & HON'BLE MS. JUSTICE RENU BHATNAGAR", 'room': '34 (DB-V)', 'vc': 'https://virtualcourtdhc.webex.com/meet/virtualcourtdhc10', 'meetId': '25127330441', 'email': 'sumanchawala575@gmail.com'},
            {'name': "HON'BLE MS. JUSTICE PRATHIBA M. SINGH & HON'BLE MS. JUSTICE MADHU JAIN", 'room': '42 (DB-VI)', 'vc': 'https://dhcvirtualcourt.webex.com/meet/dhcvirtualcourt6', 'meetId': '1669 92 0249', 'email': 'courtmaster@pmsingh.in'},
            {'name': "HON'BLE MR. JUSTICE NAVIN CHAWLA & HON'BLE MR. JUSTICE RAVINDER DUDEJA", 'room': '04 (DB-VII)', 'vc': 'https://dhcvirtualcourt.webex.com/meet/dhcvirtualcourt4', 'meetId': '25143288901', 'email': 'cmdhcdb7@gmail.com'},
            {'name': "HON'BLE MR. JUSTICE SURESH KUMAR KAIT", 'room': '10 (SB)', 'vc': 'https://dhcvirtualcourt.webex.com/meet/dhcvirtualcourt10', 'meetId': '25198765432', 'email': 'cmskk.dhc@gmail.com'},
            {'name': "HON'BLE MS. JUSTICE REKHA PALLI", 'room': '12 (SB)', 'vc': 'https://dhcvirtualcourt.webex.com/meet/dhcvirtualcourt12', 'meetId': '25134567890', 'email': 'cmrpalli.dhc@gmail.com'},
            {'name': "HON'BLE MR. JUSTICE SAURABH BANERJEE", 'room': '15 (SB)', 'vc': 'https://dhcvirtualcourt.webex.com/meet/dhcvirtualcourt15b', 'meetId': '25165432109', 'email': 'cmsbanerjee.dhc@gmail.com'},
            {'name': "HON'BLE MR. JUSTICE ANISH DAYAL", 'room': '17 (SB)', 'vc': 'https://dhcvirtualcourt.webex.com/meet/dhcvirtualcourt17', 'meetId': '25176543210', 'email': 'cmadayal.dhc@gmail.com'},
            {'name': "HON'BLE MR. JUSTICE DHARMESH SHARMA", 'room': '20 (SB)', 'vc': 'https://dhcvirtualcourt.webex.com/meet/dhcvirtualcourt20', 'meetId': '25209876543', 'email': 'cmdsharma.dhc@gmail.com'},
        ]
    },
    'maharashtra': {
        'name': 'Bombay High Court',
        'url': 'https://bombayhighcourt.nic.in',
        'efiling': 'https://bombayhighcourt.nic.in/efiling',
        'causelist': 'https://bombayhighcourt.nic.in/netbd.php',
        'casestatus': 'https://bombayhighcourt.nic.in/case_status',
        'orders': 'https://bombayhighcourt.nic.in/orders',
        'judgments': 'https://bombayhighcourt.nic.in/judgments',
        'epass': 'https://bombayhighcourt.nic.in/epass',
        'displayboard': 'https://bombayhighcourt.nic.in/display',
        'judges': [
            {'name': "HON'BLE THE CHIEF JUSTICE DEVENDRA KUMAR UPADHYAY", 'room': '1', 'vc': 'https://bombayhighcourt.nic.in/virtualcourt', 'meetId': 'See Official Website', 'email': 'reggeneral@bombayingcourt.nic.in'},
            {'name': "HON'BLE MR. JUSTICE GIRISH S. KULKARNI", 'room': '2', 'vc': 'https://bombayhighcourt.nic.in/virtualcourt', 'meetId': 'See Official Website', 'email': 'court02@bombayhighcourt.nic.in'},
            {'name': "HON'BLE MS. JUSTICE BHARATI DANGRE", 'room': '3', 'vc': 'https://bombayhighcourt.nic.in/virtualcourt', 'meetId': 'See Official Website', 'email': 'court03@bombayhighcourt.nic.in'},
            {'name': "HON'BLE MR. JUSTICE MILIND JADHAV", 'room': '5', 'vc': 'https://bombayhighcourt.nic.in/virtualcourt', 'meetId': 'See Official Website', 'email': 'court05@bombayhighcourt.nic.in'},
            {'name': "HON'BLE MR. JUSTICE SANDEEP MARNE", 'room': '7', 'vc': 'https://bombayhighcourt.nic.in/virtualcourt', 'meetId': 'See Official Website', 'email': 'court07@bombayhighcourt.nic.in'},
            {'name': "HON'BLE MR. JUSTICE ABHAY AHUJA", 'room': '9', 'vc': 'https://bombayhighcourt.nic.in/virtualcourt', 'meetId': 'See Official Website', 'email': 'court09@bombayhighcourt.nic.in'},
        ]
    },
    'tamil_nadu': {
        'name': 'Madras High Court',
        'url': 'https://hcmadras.tn.gov.in',
        'efiling': 'https://hcmadras.tn.gov.in/efiling',
        'causelist': 'https://mhc.tn.gov.in/judis/clists/clists-madras/index.php',
        'casestatus': 'https://hcmadras.tn.gov.in/case_status',
        'orders': 'https://hcmadras.tn.gov.in/orders',
        'judgments': 'https://hcmadras.tn.gov.in/judgments',
        'epass': 'https://hcmadras.tn.gov.in/epass',
        'displayboard': 'https://hcmadras.tn.gov.in/display',
        'judges': [
            {'name': "HON'BLE THE CHIEF JUSTICE SANJAY V. GANGAPURWALA", 'room': '1', 'vc': 'https://hcmadras.tn.gov.in/virtualcourt', 'meetId': 'See Official Website', 'email': 'cj.hcmadras@tn.gov.in'},
            {'name': "HON'BLE MR. JUSTICE D. BHARATHA CHAKRAVARTHY", 'room': '2', 'vc': 'https://hcmadras.tn.gov.in/virtualcourt', 'meetId': 'See Official Website', 'email': 'court02.hcmadras@tn.gov.in'},
            {'name': "HON'BLE MS. JUSTICE R. SUBRAMANIAN", 'room': '3', 'vc': 'https://hcmadras.tn.gov.in/virtualcourt', 'meetId': 'See Official Website', 'email': 'court03.hcmadras@tn.gov.in'},
            {'name': "HON'BLE MR. JUSTICE G.R. SWAMINATHAN", 'room': '4', 'vc': 'https://hcmadras.tn.gov.in/virtualcourt', 'meetId': 'See Official Website', 'email': 'court04.hcmadras@tn.gov.in'},
            {'name': "HON'BLE MR. JUSTICE P.T. ASHA", 'room': '5', 'vc': 'https://hcmadras.tn.gov.in/virtualcourt', 'meetId': 'See Official Website', 'email': 'court05.hcmadras@tn.gov.in'},
            {'name': "HON'BLE MR. JUSTICE N. ANAND VENKATESH", 'room': '6', 'vc': 'https://hcmadras.tn.gov.in/virtualcourt', 'meetId': 'See Official Website', 'email': 'court06.hcmadras@tn.gov.in'},
        ]
    },
    'karnataka': {
        'name': 'Karnataka High Court',
        'url': 'https://karnatakajudiciary.kar.nic.in',
        'efiling': 'https://karnatakajudiciary.kar.nic.in/efiling',
        'causelist': 'https://judiciary.karnataka.gov.in/causelistSearch.php',
        'casestatus': 'https://karnatakajudiciary.kar.nic.in/case_status',
        'orders': 'https://karnatakajudiciary.kar.nic.in/orders',
        'judgments': 'https://karnatakajudiciary.kar.nic.in/judgments',
        'epass': '',
        'displayboard': '',
        'judges': [
            {'name': "HON'BLE THE CHIEF JUSTICE N.V. ANJARIA", 'room': '1', 'vc': 'https://karnatakajudiciary.kar.nic.in/virtualcourt', 'meetId': 'See Official Website', 'email': 'cj.hck@karnatakajudiciary.kar.nic.in'},
            {'name': "HON'BLE MR. JUSTICE KRISHNA S. DIXIT", 'room': '2', 'vc': 'https://karnatakajudiciary.kar.nic.in/virtualcourt', 'meetId': 'See Official Website', 'email': 'court02.hck@karnatakajudiciary.kar.nic.in'},
            {'name': "HON'BLE MR. JUSTICE M. NAGAPRASANNA", 'room': '3', 'vc': 'https://karnatakajudiciary.kar.nic.in/virtualcourt', 'meetId': 'See Official Website', 'email': 'court03.hck@karnatakajudiciary.kar.nic.in'},
            {'name': "HON'BLE MS. JUSTICE HANCHATE SANJEEVKUMAR", 'room': '5', 'vc': 'https://karnatakajudiciary.kar.nic.in/virtualcourt', 'meetId': 'See Official Website', 'email': 'court05.hck@karnatakajudiciary.kar.nic.in'},
            {'name': "HON'BLE MR. JUSTICE SURAJ GOVINDARAJ", 'room': '7', 'vc': 'https://karnatakajudiciary.kar.nic.in/virtualcourt', 'meetId': 'See Official Website', 'email': 'court07.hck@karnatakajudiciary.kar.nic.in'},
        ]
    },
    'up': {
        'name': 'Allahabad High Court',
        'url': 'https://www.allahabadhighcourt.in',
        'efiling': 'https://efiling.allahabadhighcourt.in',
        'causelist': 'https://www.allahabadhighcourt.in/apps/status_ccms/index.php/causelist',
        'casestatus': 'https://www.allahabadhighcourt.in/case_status',
        'orders': 'https://www.allahabadhighcourt.in/orders',
        'judgments': 'https://www.allahabadhighcourt.in/judgments',
        'epass': '',
        'displayboard': '',
        'judges': [
            {'name': "HON'BLE THE CHIEF JUSTICE ARUN BHANSALI", 'room': '1', 'vc': 'https://www.allahabadhighcourt.in/virtualcourt', 'meetId': 'See Official Website', 'email': 'cj.hcall@allahabadhighcourt.in'},
            {'name': "HON'BLE MR. JUSTICE MANOJ KUMAR GUPTA", 'room': '2', 'vc': 'https://www.allahabadhighcourt.in/virtualcourt', 'meetId': 'See Official Website', 'email': 'court02@allahabadhighcourt.in'},
            {'name': "HON'BLE MR. JUSTICE VIVEK KUMAR BIRLA", 'room': '3', 'vc': 'https://www.allahabadhighcourt.in/virtualcourt', 'meetId': 'See Official Website', 'email': 'court03@allahabadhighcourt.in'},
            {'name': "HON'BLE MR. JUSTICE SIDDHARTH", 'room': '5', 'vc': 'https://www.allahabadhighcourt.in/virtualcourt', 'meetId': 'See Official Website', 'email': 'court05@allahabadhighcourt.in'},
        ]
    },
    'west_bengal': {
        'name': 'Calcutta High Court',
        'url': 'https://www.calcuttahighcourt.gov.in',
        'efiling': 'https://www.calcuttahighcourt.gov.in/efiling',
        'causelist': 'https://www.calcuttahighcourt.gov.in/Cause-Lists',
        'casestatus': 'https://www.calcuttahighcourt.gov.in/case_status',
        'orders': 'https://www.calcuttahighcourt.gov.in/orders',
        'judgments': 'https://www.calcuttahighcourt.gov.in/judgments',
        'epass': '',
        'displayboard': '',
        'judges': []
    },
    'gujarat': {
        'name': 'Gujarat High Court',
        'url': 'https://gujarathighcourt.nic.in',
        'efiling': 'https://gujarathighcourt.nic.in/efiling',
        'causelist': 'https://gujarathighcourt.nic.in/causelist',
        'casestatus': 'https://gujarathighcourt.nic.in/case_status',
        'orders': '',
        'judgments': 'https://gujarathighcourt.nic.in/judgments',
        'epass': '',
        'displayboard': '',
        'judges': []
    },
    'rajasthan': {
        'name': 'Rajasthan High Court',
        'url': 'https://hcraj.nic.in',
        'efiling': 'https://hcraj.nic.in/efiling',
        'causelist': 'https://hcraj.nic.in/cishcraj-jdp/causelists/',
        'casestatus': 'https://hcraj.nic.in/case_status',
        'orders': '',
        'judgments': 'https://hcraj.nic.in/judgments',
        'epass': '',
        'displayboard': '',
        'judges': []
    },
}

_DISTRICTS = {
    'delhi': [
        {'name': 'Rohini', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=7&state_cd=7&dist_cd=2'},
        {'name': 'Karkardooma (Shahdara)', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=7&state_cd=7&dist_cd=3'},
        {'name': 'Tis Hazari', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=7&state_cd=7&dist_cd=1'},
        {'name': 'Dwarka', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=7&state_cd=7&dist_cd=5'},
        {'name': 'Saket', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=7&state_cd=7&dist_cd=4'},
        {'name': 'Patiala House', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=7&state_cd=7&dist_cd=6'},
        {'name': 'Rouse Avenue', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=7&state_cd=7&dist_cd=7'},
        {'name': 'South-East (Saket)', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=7&state_cd=7&dist_cd=8'},
    ],
    'maharashtra': [
        {'name': 'City Civil Court Mumbai', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=24&state_cd=24&dist_cd=1'},
        {'name': 'Thane', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=24&state_cd=24&dist_cd=6'},
        {'name': 'Pune', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=24&state_cd=24&dist_cd=15'},
        {'name': 'Nagpur', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=24&state_cd=24&dist_cd=27'},
        {'name': 'Nashik', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=24&state_cd=24&dist_cd=11'},
        {'name': 'Aurangabad', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=24&state_cd=24&dist_cd=20'},
        {'name': 'Kolhapur', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=24&state_cd=24&dist_cd=17'},
        {'name': 'Solapur', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=24&state_cd=24&dist_cd=16'},
    ],
    'tamil_nadu': [
        {'name': 'Chennai City Civil Court', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=19&state_cd=19&dist_cd=1'},
        {'name': 'Coimbatore', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=19&state_cd=19&dist_cd=11'},
        {'name': 'Madurai', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=19&state_cd=19&dist_cd=18'},
        {'name': 'Salem', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=19&state_cd=19&dist_cd=27'},
        {'name': 'Tiruchirappalli', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=19&state_cd=19&dist_cd=20'},
        {'name': 'Tirunelveli', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=19&state_cd=19&dist_cd=22'},
        {'name': 'Vellore', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=19&state_cd=19&dist_cd=30'},
        {'name': 'Erode', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=19&state_cd=19&dist_cd=12'},
    ],
    'karnataka': [
        {'name': 'Bengaluru City Civil Court', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=15&state_cd=15&dist_cd=2'},
        {'name': 'Mysuru', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=15&state_cd=15&dist_cd=22'},
        {'name': 'Hubli-Dharwad', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=15&state_cd=15&dist_cd=8'},
        {'name': 'Belagavi', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=15&state_cd=15&dist_cd=4'},
        {'name': 'Mangaluru', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=15&state_cd=15&dist_cd=11'},
        {'name': 'Tumakuru', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=15&state_cd=15&dist_cd=27'},
        {'name': 'Shivamogga', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=15&state_cd=15&dist_cd=25'},
        {'name': 'Kalaburagi', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=15&state_cd=15&dist_cd=9'},
    ],
    'up': [
        {'name': 'Lucknow', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=26&state_cd=26&dist_cd=18'},
        {'name': 'Allahabad (Prayagraj)', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=25&state_cd=25&dist_cd=3'},
        {'name': 'Kanpur', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=25&state_cd=25&dist_cd=29'},
        {'name': 'Varanasi', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=25&state_cd=25&dist_cd=68'},
        {'name': 'Agra', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=25&state_cd=25&dist_cd=1'},
        {'name': 'Meerut', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=25&state_cd=25&dist_cd=43'},
        {'name': 'Ghaziabad', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=25&state_cd=25&dist_cd=19'},
        {'name': 'Noida (Gautam Buddh Nagar)', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=25&state_cd=25&dist_cd=22'},
    ],
    'gujarat': [
        {'name': 'Ahmedabad City Civil Court', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=9&state_cd=9&dist_cd=1'},
        {'name': 'Surat', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=9&state_cd=9&dist_cd=25'},
        {'name': 'Vadodara', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=9&state_cd=9&dist_cd=19'},
        {'name': 'Rajkot', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=9&state_cd=9&dist_cd=22'},
        {'name': 'Bhavnagar', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=9&state_cd=9&dist_cd=4'},
        {'name': 'Jamnagar', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=9&state_cd=9&dist_cd=10'},
        {'name': 'Junagadh', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=9&state_cd=9&dist_cd=12'},
        {'name': 'Gandhinagar', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=9&state_cd=9&dist_cd=8'},
    ],
    'rajasthan': [
        {'name': 'Jaipur', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=17&state_cd=17&dist_cd=10'},
        {'name': 'Jodhpur', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=17&state_cd=17&dist_cd=13'},
        {'name': 'Udaipur', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=17&state_cd=17&dist_cd=29'},
        {'name': 'Ajmer', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=17&state_cd=17&dist_cd=1'},
        {'name': 'Kota', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=17&state_cd=17&dist_cd=16'},
        {'name': 'Bikaner', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=17&state_cd=17&dist_cd=4'},
        {'name': 'Alwar', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=17&state_cd=17&dist_cd=2'},
        {'name': 'Sikar', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=17&state_cd=17&dist_cd=24'},
    ],
    'kerala': [
        {'name': 'Thiruvananthapuram', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=16&state_cd=16&dist_cd=14'},
        {'name': 'Kochi (Ernakulam)', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=16&state_cd=16&dist_cd=5'},
        {'name': 'Kozhikode', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=16&state_cd=16&dist_cd=8'},
        {'name': 'Thrissur', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=16&state_cd=16&dist_cd=13'},
        {'name': 'Palakkad', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=16&state_cd=16&dist_cd=11'},
        {'name': 'Kollam', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=16&state_cd=16&dist_cd=7'},
        {'name': 'Kannur', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=16&state_cd=16&dist_cd=6'},
        {'name': 'Malappuram', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=16&state_cd=16&dist_cd=9'},
    ],
    'telangana': [
        {'name': 'Hyderabad City Civil Court', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=36&state_cd=36&dist_cd=7'},
        {'name': 'Warangal', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=36&state_cd=36&dist_cd=31'},
        {'name': 'Karimnagar', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=36&state_cd=36&dist_cd=9'},
        {'name': 'Nizamabad', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=36&state_cd=36&dist_cd=19'},
        {'name': 'Khammam', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=36&state_cd=36&dist_cd=11'},
        {'name': 'Ranga Reddy', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=36&state_cd=36&dist_cd=23'},
    ],
    'andhra': [
        {'name': 'Visakhapatnam', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=28&state_cd=28&dist_cd=25'},
        {'name': 'Vijayawada', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=28&state_cd=28&dist_cd=4'},
        {'name': 'Tirupati', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=28&state_cd=28&dist_cd=12'},
        {'name': 'Guntur', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=28&state_cd=28&dist_cd=5'},
        {'name': 'Kakinada', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=28&state_cd=28&dist_cd=7'},
        {'name': 'Nellore', 'url': 'https://services.ecourts.gov.in/ecourtindia_v6/?p=casestatus/index&sess_state_cd=28&state_cd=28&dist_cd=11'},
    ],
}

_FORMS = [
    # ── Supreme Court of India ────────────────────────────────────────────
    # All SCI forms are indexed at https://main.sci.gov.in/forms-formats
    {'name': 'SC — All Standard Forms & Formats',       'cat': 'General',        'court': 'Supreme Court',  'url': 'https://main.sci.gov.in/forms-formats',                          'url_type': 'page'},
    {'name': 'SC — Civil Appeal / SLP Format',          'cat': 'Civil',          'court': 'Supreme Court',  'url': 'https://main.sci.gov.in/forms-formats',                          'url_type': 'page'},
    {'name': 'SC — Writ Petition (Article 32)',          'cat': 'Constitutional', 'court': 'Supreme Court',  'url': 'https://main.sci.gov.in/forms-formats',                          'url_type': 'page'},
    {'name': 'SC — Criminal Appeal Format',             'cat': 'Criminal',       'court': 'Supreme Court',  'url': 'https://main.sci.gov.in/forms-formats',                          'url_type': 'page'},
    {'name': 'SC — Transfer Petition Format',           'cat': 'General',        'court': 'Supreme Court',  'url': 'https://main.sci.gov.in/forms-formats',                          'url_type': 'page'},
    {'name': 'SC — Vakalatnama (All Petitions)',         'cat': 'General',        'court': 'Supreme Court',  'url': 'https://main.sci.gov.in/forms-formats',                          'url_type': 'page'},

    # ── Delhi High Court ──────────────────────────────────────────────────
    # All DHC forms are indexed at https://delhihighcourt.nic.in/web/page/new-forms
    {'name': 'DHC — All Standard Forms (Index)',         'cat': 'General',        'court': 'Delhi HC',       'url': 'https://delhihighcourt.nic.in/web/page/new-forms',               'url_type': 'page'},
    {'name': 'DHC — Vakalatnama (Civil)',                'cat': 'Civil',          'court': 'Delhi HC',       'url': 'https://delhihighcourt.nic.in/web/page/new-forms',               'url_type': 'page'},
    {'name': 'DHC — Vakalatnama (Criminal)',             'cat': 'Criminal',       'court': 'Delhi HC',       'url': 'https://delhihighcourt.nic.in/web/page/new-forms',               'url_type': 'page'},
    {'name': 'DHC — Index Form (Civil Petition)',        'cat': 'Civil',          'court': 'Delhi HC',       'url': 'https://delhihighcourt.nic.in/web/page/new-forms',               'url_type': 'page'},
    {'name': 'DHC — Address / Cover Form',               'cat': 'Civil',          'court': 'Delhi HC',       'url': 'https://delhihighcourt.nic.in/web/page/new-forms',               'url_type': 'page'},
    {'name': 'DHC — Bail Application (Criminal)',        'cat': 'Criminal',       'court': 'Delhi HC',       'url': 'https://delhihighcourt.nic.in/web/page/new-forms',               'url_type': 'page'},
    {'name': 'DHC — Affidavit Form (Convict)',           'cat': 'Criminal',       'court': 'Delhi HC',       'url': 'https://delhihighcourt.nic.in/web/page/new-forms',               'url_type': 'page'},
    {'name': 'DHC — Annexure B — Bail Bond',             'cat': 'Criminal',       'court': 'Delhi HC',       'url': 'https://delhihighcourt.nic.in/web/page/new-forms',               'url_type': 'page'},
    {'name': 'DHC — Surety / Bail Bond Form',            'cat': 'Criminal',       'court': 'Delhi HC',       'url': 'https://delhihighcourt.nic.in/web/page/new-forms',               'url_type': 'page'},
    {'name': 'DHC — Writ Petition Checklist',            'cat': 'Constitutional', 'court': 'Delhi HC',       'url': 'https://delhihighcourt.nic.in/web/page/new-forms',               'url_type': 'page'},
    {'name': 'DHC — Certified Copy Application (Civil)','cat': 'Civil',           'court': 'Delhi HC',       'url': 'https://delhihighcourt.nic.in/web/page/new-forms',               'url_type': 'page'},
    {'name': 'DHC — Certified Form Criminal (C.A.I.)',   'cat': 'Criminal',       'court': 'Delhi HC',       'url': 'https://delhihighcourt.nic.in/web/page/new-forms',               'url_type': 'page'},
    {'name': 'DHC — List of Dates Format',               'cat': 'General',        'court': 'Delhi HC',       'url': 'https://delhihighcourt.nic.in/web/page/new-forms',               'url_type': 'page'},
    {'name': 'DHC — Stay / Interim Application',         'cat': 'Civil',          'court': 'Delhi HC',       'url': 'https://delhihighcourt.nic.in/web/page/new-forms',               'url_type': 'page'},
    {'name': 'DHC — Undertaking Form',                   'cat': 'General',        'court': 'Delhi HC',       'url': 'https://delhihighcourt.nic.in/web/page/new-forms',               'url_type': 'page'},
    {'name': 'DHC — Written Statement Format',           'cat': 'Civil',          'court': 'Delhi HC',       'url': 'https://delhihighcourt.nic.in/web/page/new-forms',               'url_type': 'page'},
    {'name': 'DHC — Miscellaneous Application',          'cat': 'General',        'court': 'Delhi HC',       'url': 'https://delhihighcourt.nic.in/web/page/new-forms',               'url_type': 'page'},
    {'name': 'DHC — Check List (Civil)',                 'cat': 'Civil',          'court': 'Delhi HC',       'url': 'https://delhihighcourt.nic.in/web/page/new-forms',               'url_type': 'page'},
    {'name': 'DHC — Check List (138 NI Act)',            'cat': 'Civil',          'court': 'Delhi HC',       'url': 'https://delhihighcourt.nic.in/web/page/new-forms',               'url_type': 'page'},
    {'name': 'DHC — Return of Service / Summons',        'cat': 'Civil',          'court': 'Delhi HC',       'url': 'https://delhihighcourt.nic.in/web/page/new-forms',               'url_type': 'page'},
    {'name': 'DHC — Plaintiff Verification Format',      'cat': 'Civil',          'court': 'Delhi HC',       'url': 'https://delhihighcourt.nic.in/web/page/new-forms',               'url_type': 'page'},
    {'name': 'DHC — Extra Party Information Form',       'cat': 'General',        'court': 'Delhi HC',       'url': 'https://delhihighcourt.nic.in/web/page/new-forms',               'url_type': 'page'},

    # ── Bombay High Court ─────────────────────────────────────────────────
    # Forms indexed at https://bombayhighcourt.nic.in/forms.php
    {'name': 'BHC — All Forms Index',                    'cat': 'General',        'court': 'Bombay HC',      'url': 'https://bombayhighcourt.nic.in/forms.php',                       'url_type': 'page'},
    {'name': 'BHC — Vakalatnama',                        'cat': 'General',        'court': 'Bombay HC',      'url': 'https://bombayhighcourt.nic.in/forms.php',                       'url_type': 'page'},
    {'name': 'BHC — Writ Petition (Article 226)',        'cat': 'Constitutional', 'court': 'Bombay HC',      'url': 'https://bombayhighcourt.nic.in/forms.php',                       'url_type': 'page'},
    {'name': 'BHC — Bail Application (Criminal)',        'cat': 'Criminal',       'court': 'Bombay HC',      'url': 'https://bombayhighcourt.nic.in/forms.php',                       'url_type': 'page'},
    {'name': 'BHC — First Appeal / Civil Revision',      'cat': 'Civil',          'court': 'Bombay HC',      'url': 'https://bombayhighcourt.nic.in/forms.php',                       'url_type': 'page'},

    # ── Madras High Court ─────────────────────────────────────────────────
    # Forms indexed at https://hcmadras.tn.gov.in/forms.html
    {'name': 'MHC — All Forms Index',                    'cat': 'General',        'court': 'Madras HC',      'url': 'https://hcmadras.tn.gov.in/forms.html',                         'url_type': 'page'},
    {'name': 'MHC — Vakalatnama (Original Side)',         'cat': 'Civil',          'court': 'Madras HC',      'url': 'https://hcmadras.tn.gov.in/forms.html',                         'url_type': 'page'},
    {'name': 'MHC — Writ Petition Format',               'cat': 'Constitutional', 'court': 'Madras HC',      'url': 'https://hcmadras.tn.gov.in/forms.html',                         'url_type': 'page'},
    {'name': 'MHC — Criminal Appeals & Bail',            'cat': 'Criminal',       'court': 'Madras HC',      'url': 'https://hcmadras.tn.gov.in/forms.html',                         'url_type': 'page'},

    # ── Karnataka High Court ──────────────────────────────────────────────
    # Forms indexed at https://karnatakajudiciary.kar.nic.in/forms.asp
    {'name': 'KHC — All Forms Index',                    'cat': 'General',        'court': 'Karnataka HC',   'url': 'https://karnatakajudiciary.kar.nic.in/forms.asp',                'url_type': 'page'},
    {'name': 'KHC — Vakalatnama',                        'cat': 'General',        'court': 'Karnataka HC',   'url': 'https://karnatakajudiciary.kar.nic.in/forms.asp',                'url_type': 'page'},
    {'name': 'KHC — Writ Petition (Article 226)',        'cat': 'Constitutional', 'court': 'Karnataka HC',   'url': 'https://karnatakajudiciary.kar.nic.in/forms.asp',                'url_type': 'page'},

    # ── eCourts / District Courts ─────────────────────────────────────────
    # Portal: https://districts.ecourts.gov.in/ (national eCourts portal)
    {'name': 'eCourts — District Court Portal (All States)', 'cat': 'General',   'court': 'District Courts', 'url': 'https://districts.ecourts.gov.in/',                             'url_type': 'page'},
    {'name': 'eCourts — Bail Bond CrPC S.116(3)',        'cat': 'Criminal',       'court': 'District Courts', 'url': 'https://districts.ecourts.gov.in/',                             'url_type': 'page'},
    {'name': 'eCourts — Bail Bond CrPC S.437A',          'cat': 'Criminal',       'court': 'District Courts', 'url': 'https://districts.ecourts.gov.in/',                             'url_type': 'page'},
    {'name': 'eCourts — Surety Affidavit (Bail)',         'cat': 'Criminal',       'court': 'District Courts', 'url': 'https://districts.ecourts.gov.in/',                             'url_type': 'page'},
    {'name': 'eCourts — Plaint (Order VII CPC)',          'cat': 'Civil',          'court': 'District Courts', 'url': 'https://districts.ecourts.gov.in/',                             'url_type': 'page'},
    {'name': 'eCourts — Written Statement Format',        'cat': 'Civil',          'court': 'District Courts', 'url': 'https://districts.ecourts.gov.in/',                             'url_type': 'page'},
    {'name': 'eCourts — Execution Application',           'cat': 'Civil',          'court': 'District Courts', 'url': 'https://districts.ecourts.gov.in/',                             'url_type': 'page'},

    # ── Central Government (direct stable PDFs) ───────────────────────────
    # MHA FIR format — stable long-standing URL
    {'name': 'FIR Format — MHA Standard (CrPC S.154)', 'cat': 'Criminal',         'court': 'Central Govt',   'url': 'https://www.mha.gov.in/sites/default/files/FIR_format.pdf',    'url_type': 'pdf'},

    # ── NALSA / Legal Aid ─────────────────────────────────────────────────
    {'name': 'NALSA — Legal Aid Application Form',        'cat': 'General',        'court': 'NALSA',          'url': 'https://nalsa.gov.in/lsam/application-for-legal-services',     'url_type': 'page'},
    {'name': 'NALSA — Motor Accident Claim Format',       'cat': 'Civil',          'court': 'NALSA',          'url': 'https://nalsa.gov.in/',                                         'url_type': 'page'},
]



# ── Static globals (moved from frontend JS) ───────────────────────

_SC_COURTS = [
    {'room': i, 'vc': f'https://sci-vc.webex.com/meet/court{i:02d}',
     'meetId': 'View on Display Board', 'email': f'court{i:02d}@sci.nic.in'}
    for i in range(1, 35)
]

_BARE_ACTS = [
    {'name': 'Arbitration and Conciliation Act, 1996', 'url': 'https://indiankanoon.org/doc/1078764/'},
    {'name': 'Arms Act, 1959', 'url': 'https://indiankanoon.org/doc/267064/'},
    {'name': 'Code of Civil Procedure, 1908', 'url': 'https://indiankanoon.org/doc/74134/'},
    {'name': 'Code of Criminal Procedure, 1973', 'url': 'https://indiankanoon.org/doc/445276/'},
    {'name': 'Companies Act, 2013', 'url': 'https://indiankanoon.org/doc/127517806/'},
    {'name': 'Consumer Protection Act, 2019', 'url': 'https://indiankanoon.org/doc/130434417/'},
    {'name': 'Contract Act, 1872', 'url': 'https://indiankanoon.org/doc/1582532/'},
    {'name': 'Copyright Act, 1957', 'url': 'https://indiankanoon.org/doc/1138713/'},
    {'name': 'Criminal Law Amendment Act,b 2013', 'url': 'https://indiankanoon.org/doc/180549602/'},
    {'name': 'Domestic Violence Act, 2005', 'url': 'https://indiankanoon.org/doc/542337/'},
    {'name': 'Evidence Act, 1872', 'url': 'https://indiankanoon.org/doc/1621758/'},
    {'name': 'Foreign Exchange Management Act, 1999', 'url': 'https://indiankanoon.org/doc/1255617/'},
    {'name': 'GST Act — CGST Act, 2017', 'url': 'https://indiankanoon.org/doc/106374168/'},
    {'name': 'Income Tax Act, 1961', 'url': 'https://indiankanoon.org/doc/1090177/'},
    {'name': 'Indian Penal Code, 1860', 'url': 'https://indiankanoon.org/doc/1569253/'},
    {'name': 'Information Technology Act, 2000', 'url': 'https://indiankanoon.org/doc/1015617/'},
    {'name': 'Insolvency and Bankruptcy Code, 2016', 'url': 'https://indiankanoon.org/doc/91938321/'},
    {'name': 'Juvenile Justice Act, 2015', 'url': 'https://indiankanoon.org/doc/47023948/'},
    {'name': 'Land Acquisition Act, 2013', 'url': 'https://indiankanoon.org/doc/129053789/'},
    {'name': 'Motor Vehicles Act, 1988', 'url': 'https://indiankanoon.org/doc/923072/'},
    {'name': 'Narcotics Drugs and Psychotropic Substances Act, 1985', 'url': 'https://indiankanoon.org/doc/452541/'},
    {'name': 'Negotiable Instruments Act, 1881', 'url': 'https://indiankanoon.org/doc/1582671/'},
    {'name': 'POCSO Act, 2012', 'url': 'https://indiankanoon.org/doc/154880796/'},
    {'name': 'Prevention of Corruption Act, 1988', 'url': 'https://indiankanoon.org/doc/1244836/'},
    {'name': 'Prisoners Act, 1894', 'url': 'https://indiankanoon.org/doc/1025604/'},
    {'name': 'Right to Information Act, 2005', 'url': 'https://indiankanoon.org/doc/1308468/'},
    {'name': 'Specific Relief Act, 1963', 'url': 'https://indiankanoon.org/doc/1572451/'},
    {'name': 'The Advocates Act, 1961', 'url': 'https://indiankanoon.org/doc/1105498/'},
    {'name': 'The Airports Authority of India Act, 1994', 'url': 'https://indiankanoon.org/doc/1714073/'},
    {'name': 'The Constitution of India', 'url': 'https://indiankanoon.org/doc/237570/'},
    {'name': 'Transfer of Property Act, 1882', 'url': 'https://indiankanoon.org/doc/1601846/'},
    {'name': 'Bharatiya Nyaya Sanhita, 2023', 'url': 'https://indiankanoon.org/search/?q=Bharatiya+Nyaya+Sanhita'},
    {'name': 'Bharatiya Nagarik Suraksha Sanhita, 2023', 'url': 'https://indiankanoon.org/search/?q=Bharatiya+Nagarik+Suraksha+Sanhita'},
    {'name': 'Bharatiya Sakshya Adhiniyam, 2023', 'url': 'https://indiankanoon.org/search/?q=Bharatiya+Sakshya+Adhiniyam'},
]


_EVENTS = [
    {'id': 'evt-001', 'date': 'May 7, 2026',  'title': 'Supreme Court — Constitution Bench Sitting',          'sub': '5-Judge Bench on Electoral Bond Scheme Contempt',     'type': 'media',      'url': 'https://main.sci.gov.in/case-status'},
    {'id': 'evt-002', 'date': 'May 10, 2026', 'title': 'National Legal Services Day — Webinar',               'sub': 'NALSA — Free Legal Aid Awareness Drive',              'type': 'webinar',    'url': 'https://nalsa.gov.in/activities'},
    {'id': 'evt-003', 'date': 'May 12, 2026', 'title': 'eCourts Phase III Launch Update',                     'sub': 'Ministry of Law & Justice — New Delhi',               'type': 'conference', 'url': 'https://ecourts.gov.in/ecourts_home/'},
    {'id': 'evt-004', 'date': 'May 15, 2026', 'title': 'BCI Annual Conference 2026',                          'sub': 'Bar Council of India — New Delhi',                    'type': 'conference', 'url': 'https://www.barcouncilofindia.org/about-bci/'},
    {'id': 'evt-005', 'date': 'May 20, 2026', 'title': 'Seminar: BNS & BNSS Implementation in Practice',     'sub': 'Delhi High Court Bar Association',                    'type': 'conference', 'url': 'https://delhihighcourt.nic.in/web/page/notices'},
    {'id': 'evt-006', 'date': 'May 22, 2026', 'title': 'Webinar: AI in Indian Courts — Impact on Legal Practice', 'sub': 'LawTech India — Online',                          'type': 'webinar',    'url': 'https://www.nja.nic.in/programs/'},
    {'id': 'evt-007', 'date': 'May 25, 2026', 'title': 'Consumer Protection Act Workshop',                    'sub': 'National Consumer Disputes Redressal Commission',     'type': 'webinar',    'url': 'https://ncdrc.nic.in/ncdrc/'},
    {'id': 'evt-008', 'date': 'June 2, 2026', 'title': 'Criminal Law Reforms — Public Consultation',          'sub': 'Law Commission of India',                            'type': 'conference', 'url': 'https://legalaffairs.gov.in/law-commission-india'},
    {'id': 'evt-009', 'date': 'June 5, 2026', 'title': 'Mediation Training Programme',                        'sub': 'NALSA & Supreme Court Mediation Centre',             'type': 'webinar',    'url': 'https://nalsa.gov.in/services/adr'},
    {'id': 'evt-010', 'date': 'June 10, 2026','title': 'SCBA Annual General Meeting 2026',                    'sub': 'Supreme Court Bar Association, New Delhi',            'type': 'conference', 'url': 'https://www.scba.org.in/'},
    {'id': 'evt-011', 'date': 'June 12, 2026','title': 'IPR Day — Trademark & Patent Law Updates',            'sub': 'CGPDTM — Office of DPIIT, Mumbai',                   'type': 'conference', 'url': 'https://ipindia.gov.in/trade-marks.htm'},
    {'id': 'evt-012', 'date': 'June 15, 2026','title': 'Media Briefing — SC Notable Judgements of May 2026', 'sub': 'Supreme Court of India Press Release',                'type': 'media',      'url': 'https://main.sci.gov.in/judgments'},
    {'id': 'evt-013', 'date': 'June 20, 2026','title': 'Cyber Laws & Digital Evidence Workshop',              'sub': 'National Judicial Academy, Bhopal',                   'type': 'webinar',    'url': 'https://www.nja.nic.in/programs/'},
    {'id': 'evt-014', 'date': 'June 25, 2026','title': 'Alternative Dispute Resolution — NCLT Seminar',       'sub': 'NCLT Bar Association',                                'type': 'conference', 'url': 'https://www.nclt.gov.in/'},
]


_CAUSE_LIST_URLS = {
    'delhi':       {'url': 'https://delhihighcourt.nic.in/web/cause-lists/cause-list', 'label': "Pull today's Delhi High Court cause list."},
    'maharashtra': {'url': 'https://bombayhighcourt.nic.in/netbdpdf.php',                 'label': "Pull today's Bombay High Court cause list."},
    'tamil_nadu':  {'url': 'https://hcmadras.tn.gov.in/causelist',                     'label': "Pull today's Madras High Court cause list."},
    'karnataka':   {'url': 'https://judiciary.karnataka.gov.in/causelistSearch.php',                     'label': "Pull today's Karnataka High Court cause list."},
    'telangana':   {'url': 'https://causelist.tshc.gov.in/showDailyCauseList',                     'label': "Pull today's telangana High Court cause list."},
    'madhya pradesh':   {'url': 'https://mphc.gov.in/causelist',                     'label': "Pull today's Madhya Pradesh High Court cause list."},
    'punjab & haryana':   {'url': 'https://new.phhc.gov.in/cause/cause-list',                     'label': "Pull today's Punjab & Haryana High Court cause list."},
    'kerala':   {'url': 'https://hckinfo.keralacourts.in/digicourt/Casedetailssearch/viewCauselist',                     'label': "Pull today's Kerala High Court cause list."},
    'andhra pradesh':          {'url': 'https://aphc.gov.in/Hcdbs/searchdates.action',                         'label': "Pull today's Andhra Pradesh High Court cause list."},
    'odisha':          {'url': 'https://www.orissahighcourt.nic.in/cause-list/',                         'label': "Pull today's Odisha High Court cause list."},
    'jharkhand':          {'url': 'https://jharkhandhighcourt.nic.in/entire-cause-list.php',                         'label': "Pull today's Jharkhand High Court cause list."},
    'chattisgarh':          {'url': 'https://highcourt.cg.gov.in/clists/index.php',                         'label': "Pull today's Chattisgarh High Court cause list."},
    'assam':          {'url': 'https://ghconline.gov.in/index.php/consolidated-cause-list/',                         'label': "Pull today's Assam High Court cause list."},
    'himachal pradesh':          {'url': 'https://highcourt.hp.gov.in/causelist/netbd.php',                         'label': "Pull today's Himachal Pradesh High Court cause list."},
    'uttarkhand':          {'url': 'https://ehcr.uk.gov.in/uk_causelist/view_causelist.php',                         'label': "Pull today's Uttarkhand High Court cause list."},
    'goa':          {'url': 'https://hcbombayatgoa.nic.in/causelist/month-format.html',                         'label': "Pull today's Goa High Court cause list."},

    'up':          {'url': 'https://www.allahabadhighcourt.in/causelist/indexA.html',                         'label': "Pull today's Allahabad High Court cause list."},
    'west_bengal': {'url': 'https://www.calcuttahighcourt.gov.in/Cause-Lists',          'label': "Pull today's Calcutta High Court cause list."},
    'gujarat':     {'url': 'https://gujarathighcourt.nic.in/causelist',                 'label': "Pull today's Gujarat High Court cause list."},
    'rajasthan':   {'url': 'https://hcraj.nic.in/cishcraj-jdp/causelists/',             'label': "Pull today's Rajasthan High Court cause list."},
}

@court_bp.route('/court-resources')
def court_resources():
    return render_template('court_resources.html')


@court_bp.route('/api/court-data/<state>')
def get_court_data(state):
    if state == 'all':
        return jsonify({'districts': _DISTRICTS})
    hc = _HC.get(state, _HC['delhi'])
    hc_info = {k: v for k, v in hc.items() if k != 'judges'}
    return jsonify({
        'hc': hc_info,
        'judges': hc.get('judges', []),
        'districts': {state: _DISTRICTS.get(state, [])},
        'forms': _FORMS,
    })

@court_bp.route('/api/court-globals')
def get_court_globals():
    return jsonify({
        'sc_courts':      _SC_COURTS,
        'bare_acts':      _BARE_ACTS,
        'events':         _EVENTS,
        'cause_list_urls': _CAUSE_LIST_URLS,
    })

# ── Event cache helpers ────────────────────────────────────────────────────────

def _get_event_db() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
    conn = sqlite3.connect(_DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    return conn


def _ensure_event_cache(conn: sqlite3.Connection) -> None:
    conn.executescript(_EVENT_CACHE_SCHEMA)
    conn.commit()


_SCRAPE_HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/124.0.0.0 Safari/537.36'
    ),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8',
}


def _extract_viewstate(soup: BeautifulSoup) -> dict:
    """Pull ASP.NET hidden form tokens from any page."""
    def _val(name: str) -> str:
        el = soup.find('input', {'name': name})
        return el.get('value', '') if el else ''
    return {
        '__VIEWSTATE':          _val('__VIEWSTATE'),
        '__VIEWSTATEGENERATOR': _val('__VIEWSTATEGENERATOR'),
        '__EVENTVALIDATION':    _val('__EVENTVALIDATION'),
        '__EVENTTARGET':        '',
        '__EVENTARGUMENT':      '',
    }


def _parse_event_soup(soup: BeautifulSoup, source_url: str) -> dict:
    """
    Extract structured event fields from a parsed page.
    Applies cascading selector patterns that cover common Indian legal-body
    page structures without relying on any single site's class names.
    """
    # Title: cascade through heading tags, then <title>
    title = ''
    for sel in ['h1', 'h2', '.event-title', '.page-title', '.heading', 'title']:
        el = soup.select_one(sel)
        if el:
            t = el.get_text(' ', strip=True)
            if len(t) > 3:
                title = t[:200]
                break

    # Description: accumulate meaningful paragraph blocks
    desc_parts: list[str] = []
    for tag in soup.select('article p, .event-description p, .content p, main p, p'):
        text = tag.get_text(' ', strip=True)
        if len(text) > 60 and text not in desc_parts:
            desc_parts.append(text)
        if len(desc_parts) >= 4:
            break

    # Date: look for time tags, then elements whose class/id hints at a date
    event_date = ''
    for tag in soup.select('time, [class*="date"], [id*="date"], .event-date, .eventdate'):
        candidate = tag.get('datetime') or tag.get_text(' ', strip=True)
        if candidate and re.search(r'\d{4}|\d{1,2}[-/]\d{1,2}', candidate):
            event_date = candidate[:100]
            break
    # Fallback: regex scan the visible body for a date-like string
    if not event_date:
        body_text = soup.get_text(' ', strip=True)
        m = re.search(
            r'\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4}'
            r'|\d{4}-\d{2}-\d{2}'
            r'|\d{1,2}/\d{1,2}/\d{4})\b',
            body_text, re.IGNORECASE
        )
        if m:
            event_date = m.group(1)

    # Venue
    venue = ''
    for tag in soup.select('[class*="venue"], [class*="location"], [id*="venue"], .place'):
        candidate = tag.get_text(' ', strip=True)
        if 5 < len(candidate) < 200:
            venue = candidate
            break

    # Organizer
    organizer = ''
    for tag in soup.select('[class*="organiz"], [class*="host"], [class*="sponsor"], .org'):
        candidate = tag.get_text(' ', strip=True)
        if 3 < len(candidate) < 150:
            organizer = candidate
            break

    # Register / RSVP URL
    register_url = ''
    register_kws = ('register', 'rsvp', 'enrol', 'enroll', 'sign up', 'apply', 'join')
    for a_tag in soup.find_all('a', href=True):
        text = a_tag.get_text(' ', strip=True).lower()
        if any(kw in text for kw in register_kws):
            register_url = urljoin(source_url, a_tag['href'])
            break

    # Raw content: first 4000 chars of visible body text (shown in modal)
    raw_content = soup.get_text(' ', strip=True)[:4000]

    return {
        'title':        title,
        'description':  ' '.join(desc_parts)[:2500],
        'event_date':   event_date,
        'venue':        venue,
        'organizer':    organizer,
        'register_url': register_url,
        'raw_content':  raw_content,
    }


def _scrape_event_page(source_url: str) -> dict:
    """
    Fetch an event page using a persistent requests.Session and return
    structured event data.

    VULNERABILITY PATCH — ASP.NET ViewState Redirect Trap:
    ────────────────────────────────────────────────────────
    Many Indian legal-body sites (BCI, NALSA, NJA, etc.) run on ASP.NET
    WebForms. A plain GET returns the page shell, but navigating to sub-pages
    requires POSTing back the hidden __VIEWSTATE, __VIEWSTATEGENERATOR, and
    __EVENTVALIDATION tokens that the server embedded in the initial response.

    Without replaying these tokens, the server returns a redirect loop or an
    empty "Session Expired" page.  We handle this by:
      1. GET the URL with a reused Session (carries cookies automatically)
      2. Parse and extract all ASP.NET hidden tokens from the GET response
      3. If ViewState is non-empty, POST back to the same URL with the tokens
      4. Parse the POST response — this is the actual content page
      5. If no ViewState, the site is plain HTML; parse the GET response directly

    We deliberately avoid Playwright/Selenium because they are heavy, require
    separate browser binaries, and introduce deployment complexity that is
    disproportionate for scraping a summary page.
    """
    session = requests.Session()
    session.headers.update(_SCRAPE_HEADERS)

    # Step 1 — GET to collect cookies + ViewState tokens
    resp_get = session.get(source_url, timeout=20, allow_redirects=True)
    resp_get.raise_for_status()
    soup_get = BeautifulSoup(resp_get.content, 'html.parser')

    tokens = _extract_viewstate(soup_get)

    # Step 2 — POST back if this is an ASP.NET page (ViewState present)
    if tokens['__VIEWSTATE']:
        resp_post = session.post(source_url, data=tokens, timeout=20, allow_redirects=True)
        resp_post.raise_for_status()
        soup = BeautifulSoup(resp_post.content, 'html.parser')
    else:
        # Plain HTML — the GET response is already the full content
        soup = soup_get

    return _parse_event_soup(soup, source_url)


# ── /api/events/<event_id> ─────────────────────────────────────────────────────

@court_bp.route('/api/events/<event_id>')
def get_event_detail(event_id: str):
    """
    Return cached or freshly-scraped detail for a legal event.

    VULNERABILITY PATCH — Stale Data / TTL Cache:
    ──────────────────────────────────────────────
    Event pages on government sites are updated infrequently, but can
    change (venue shifts, cancellations). We cache every scraped result
    in SQLite and serve from cache if the record is less than 6 hours old.
    This eliminates repeated outbound HTTP calls for the same event while
    still surfacing updates within half a working day.
    """
    # Look up this event in our static list to get the source URL
    event_meta = next((e for e in _EVENTS if e['id'] == event_id), None)
    if not event_meta:
        return jsonify({'error': 'Event not found'}), 404

    source_url = event_meta['url']

    try:
        conn = _get_event_db()
        _ensure_event_cache(conn)

        # ── Cache read: hit only if row exists AND is < 6 hours old ───────────
        row = conn.execute(
            """
            SELECT * FROM event_cache
            WHERE event_id = ?
              AND cached_at > datetime('now', '-6 hours')
            """,
            (event_id,),
        ).fetchone()

        if row:
            conn.close()
            return jsonify(dict(row))

        # ── Cache miss: scrape the live page ──────────────────────────────────
        try:
            data = _scrape_event_page(source_url)
        except requests.RequestException as exc:
            conn.close()
            return jsonify({'error': f'Could not reach event page: {exc}'}), 502
        except Exception as exc:
            conn.close()
            return jsonify({'error': f'Scrape failed: {exc}'}), 502

        # Populate any missing fields with what we know statically
        if not data['title']:
            data['title'] = event_meta['title']
        if not data['event_date']:
            data['event_date'] = event_meta['date']
        if not data['description']:
            data['description'] = event_meta['sub']

        # ── Cache write: upsert fresh result ──────────────────────────────────
        conn.execute(
            """
            INSERT OR REPLACE INTO event_cache
                (event_id, title, description, event_date, venue, organizer,
                 register_url, raw_content, source_url, cached_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            """,
            (
                event_id,
                data['title'],
                data['description'],
                data['event_date'],
                data['venue'],
                data['organizer'],
                data['register_url'],
                data['raw_content'][:8000],   # cap stored blob size
                source_url,
            ),
        )
        conn.commit()
        conn.close()

        data['event_id']   = event_id
        data['source_url'] = source_url
        return jsonify(data)

    except sqlite3.Error as exc:
        return jsonify({'error': f'Database error: {exc}'}), 500


@court_bp.route('/api/calculate-fee', methods=['POST'])
def calculate_fee():
    data = request.get_json(force=True)
    amount = float(data.get('amount', 0) or 0)
    court_type = data.get('court_type', '')
    fee = 0
    note = ''
    if 'Civil Suit' in court_type:
        if amount <= 50000:
            fee = 200
        elif amount <= 200000:
            fee = round(amount * 0.02)
        elif amount <= 1000000:
            fee = round(amount * 0.015)
        else:
            fee = round(amount * 0.01)
        note = 'Based on Court Fees Act schedule. Actual fee may vary by state.'
    elif 'First Appeal' in court_type:
        fee = round(amount * 0.01) + 500
        note = 'High Court first appeal fee (approx). Check court website.'
    elif 'Writ' in court_type:
        fee = 5000
        note = 'Fixed fee for writ petitions in most High Courts.'
    elif 'SLP' in court_type:
        fee = 10000
        note = 'Supreme Court SLP fixed fee.'
    elif 'Consumer' in court_type:
        if amount <= 500000:
            fee = 200
        elif amount <= 1000000:
            fee = 400
        else:
            fee = 5000
        note = 'Consumer Forum fee as per Consumer Protection Rules.'
    elif 'NCLT' in court_type:
        fee = 1000
        note = 'NCLT fee — varies by petition type.'
    else:
        fee = 500
        note = 'Approximate fee — verify on court portal.'
    return jsonify({'fee': fee, 'note': note})


# ══════════════════════════════════════════════════════════════════════════════
# IN-APP BROWSER ENGINE — Secure Reverse Proxy
# ══════════════════════════════════════════════════════════════════════════════
#
# Architecture: Flask acts as a trusted middleman between the user's browser
# and strict Indian Government ASP.NET sites (.nic.in / .gov.in).  Four
# production vulnerabilities are patched inline:
#
#  Patch 1 — SSRF:         Strict domain whitelist via _proxy_validate_url()
#  Patch 2 — WAF/Bots:     Client UA + XFF + cookies forwarded upstream;
#                           every redirect hop re-validated against whitelist
#  Patch 3 — ASP.NET trap: POST body passthrough; <form action> rewritten to
#                           loop back through /api/proxy
#  Patch 4 — JS/AJAX:      <base href> injected after <head>; X-Frame-Options
#                           and Content-Security-Policy stripped from response
# ──────────────────────────────────────────────────────────────────────────────

# Domains whose subdomains are safe to proxy.
# e.g. 'nic.in' matches 'ecourts.nic.in', 'delhihighcourt.nic.in', etc.
# Add entries here — never derive this list from user input.
ALLOWED_DOMAINS: frozenset[str] = frozenset({
    'nic.in',
    'gov.in',
    'sci.gov.in',
    'allahabadhighcourt.in',
    'hcmadras.tn.gov.in',
    'bci.org.in',
    'nalsa.gov.in',
    'nclt.gov.in',
    'nclat.gov.in',
    'drt.gov.in',
})

# Response headers that must NOT be forwarded to the client browser.
# Lower-cased for case-insensitive comparison.
_PROXY_STRIP_RESP_HEADERS: frozenset[str] = frozenset({
    # Patch 4: remove frame-busting and CSP so our dashboard can render the page
    'x-frame-options',
    'content-security-policy',
    'content-security-policy-report-only',
    # Hop-by-hop headers: requests already decoded these; re-sending them
    # would corrupt the response body the browser receives.
    'transfer-encoding',
    'content-encoding',
    'content-length',       # recalculated by Flask/Werkzeug
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'upgrade',
})

# Request headers we must NOT blindly forward upstream (hop-by-hop / security).
_PROXY_BLOCK_REQ_HEADERS: frozenset[str] = frozenset({
    'host',             # must be the target host, set by requests automatically
    'connection',
    'transfer-encoding',
    'content-length',   # recalculated by requests
    'te',
})

# (connect_timeout, read_timeout) in seconds
_PROXY_TIMEOUT: tuple[int, int] = (10, 30)

# Hard cap: refuse to buffer responses larger than this.
# Prevents OOM if a government server sends a huge binary blob.
_PROXY_MAX_BYTES: int = 12 * 1024 * 1024  # 12 MB


# ── Helpers ───────────────────────────────────────────────────────────────────

def _proxy_validate_url(url: str) -> tuple[bool, str]:
    """
    SSRF guard (Patch 1).

    Accepts a raw URL string and returns (True, normalised_url) only when:
      • scheme is http or https
      • hostname resolves to a domain in ALLOWED_DOMAINS (exact match or
        subdomain match, case-insensitive)

    Returns (False, '') for anything that fails.

    NOTE: This does NOT resolve the hostname to an IP address, so DNS-rebinding
    attacks (where a whitelisted domain transiently resolves to a private IP)
    are theoretically possible.  Mitigate at the infrastructure level by
    running the Flask process in a network namespace that cannot reach RFC-1918
    ranges, or by adding an OS-level DNS firewall.
    """
    if not url:
        return False, ''
    try:
        p = urlparse(url)
    except Exception:
        return False, ''

    if p.scheme not in ('http', 'https'):
        return False, ''

    hostname = (p.hostname or '').lower().strip()
    if not hostname:
        return False, ''

    for domain in ALLOWED_DOMAINS:
        if hostname == domain or hostname.endswith('.' + domain):
            return True, url

    return False, ''


def _proxy_build_upstream_headers() -> dict[str, str]:
    """
    WAF/Bot-Blocker patch (Patch 2, header side).

    Forwards the client's exact User-Agent and builds a correct
    X-Forwarded-For chain.  Also passes through a safe subset of
    informational request headers so the government server sees a realistic
    browser request rather than a generic Python/requests bot fingerprint.
    """
    headers: dict[str, str] = {}

    # User-Agent: forward client's UA verbatim; fall back to a realistic
    # desktop Chrome string rather than the default "python-requests/x.y.z".
    ua = request.headers.get('User-Agent', '')
    headers['User-Agent'] = ua or (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/124.0.0.0 Safari/537.36'
    )

    # X-Forwarded-For: append our server addr to any existing chain so the
    # government server can log the true client IP.
    existing_xff = request.headers.get('X-Forwarded-For', '').strip()
    headers['X-Forwarded-For'] = (
        f'{existing_xff}, {request.remote_addr}' if existing_xff
        else request.remote_addr
    )

    # Safe informational headers — improves accept-language matching on
    # Indian government sites that serve multilingual content.
    for hdr in ('Accept', 'Accept-Language', 'Accept-Encoding', 'Cache-Control'):
        val = request.headers.get(hdr)
        if val:
            headers[hdr] = val

    return headers


def _proxy_make_session() -> requests.Session:
    """
    WAF/Bot-Blocker patch (Patch 2, session + redirect side).

    Creates a requests.Session that:
      • carries the client's cookies upstream (preserves ASP.NET session state)
      • re-validates every redirect destination against ALLOWED_DOMAINS before
        following it, preventing open-redirect SSRF chains
    """
    session = requests.Session()
    session.max_redirects = 5

    # Copy client cookies into the upstream session verbatim.
    # This keeps ASP.NET_SessionId and ViewState cookies alive across hops.
    for name, value in request.cookies.items():
        session.cookies.set(name, value)

    # ── Redirect SSRF guard ────────────────────────────────────────────────
    # requests fires response hooks *before* following the redirect, giving us
    # a chance to abort if Location points outside the whitelist.
    def _validate_redirect(resp: requests.Response, *args, **kwargs) -> None:
        if not resp.is_redirect:
            return
        location = resp.headers.get('Location', '').strip()
        if not location:
            return
        abs_location = urljoin(resp.url, location)
        allowed, _ = _proxy_validate_url(abs_location)
        if not allowed:
            # Raising inside a hook cancels the redirect chain.
            raise requests.TooManyRedirects(
                f'Proxy SSRF guard: redirect to {abs_location!r} '
                f'is outside the allowed domain list.'
            )

    session.hooks['response'].append(_validate_redirect)
    return session


def _proxy_fetch(target_url: str) -> requests.Response:
    """
    Execute the upstream HTTP request (GET or POST).

    POST body passthrough (Patch 3, request side):
      • URL-encoded / multipart forms → forward as form data so that ASP.NET
        __VIEWSTATE and __EVENTVALIDATION tokens survive the round-trip.
      • Raw body (JSON, XML, etc.) → forwarded verbatim with original
        Content-Type.
    """
    session  = _proxy_make_session()
    headers  = _proxy_build_upstream_headers()
    kwargs   = dict(headers=headers, timeout=_PROXY_TIMEOUT, allow_redirects=True)

    if request.method == 'POST':
        ct = (request.content_type or '').lower()
        if 'application/x-www-form-urlencoded' in ct or 'multipart/form-data' in ct:
            # Preserve multi-value fields (e.g. checkbox groups) with flat=False.
            kwargs['data'] = request.form.to_dict(flat=False)
        else:
            # Raw body (JSON / SOAP / XML) — forward with original Content-Type.
            kwargs['data'] = request.get_data()
            headers['Content-Type'] = request.content_type or 'application/octet-stream'
        return session.post(target_url, **kwargs)

    return session.get(target_url, **kwargs)


def _proxy_rewrite_html(raw_bytes: bytes, final_url: str) -> bytes:
    """
    HTML rewriting pass (Patches 3 & 4).

    Patch 4 — <base href> injection:
        Inserted as the very first child of <head> so the browser natively
        resolves every relative asset URL (JS, CSS, images, AJAX endpoints)
        against the government server.  We do NOT walk every <img>/<script>/
        <link> tag — the <base> tag handles all of them for free.

    Patch 3 — <form action> rewriting:
        Every form whose action resolves to a whitelisted domain is rewritten
        to POST through /api/proxy, which forwards the complete ASP.NET
        payload (including __VIEWSTATE / __EVENTVALIDATION) back to the server.
        Forms whose action is outside the whitelist are left untouched — they
        will simply fail to submit, which is the correct safe-failure behavior.
    """
    p            = urlparse(final_url)
    base_origin  = f'{p.scheme}://{p.netloc}'

    soup = BeautifulSoup(raw_bytes, 'html.parser')

    # ── Patch 4: inject <base href> ────────────────────────────────────────
    head = soup.find('head')
    if head:
        base_tag = soup.new_tag('base', href=f'{base_origin}/')
        head.insert(0, base_tag)
    else:
        # Malformed HTML with no <head>: wrap in a minimal shell.
        body = soup.find('body')
        if body:
            new_head = soup.new_tag('head')
            new_head.append(soup.new_tag('base', href=f'{base_origin}/'))
            body.insert_before(new_head)

    # ── Patch 3: rewrite <form action> attributes ──────────────────────────
    for form in soup.find_all('form'):
        action = (form.get('action') or '').strip()

        if not action:
            # No action attribute → form submits to the current URL.
            # Rewrite to proxy that URL explicitly so the POST goes through us.
            proxy_action = f'/api/proxy?target_url={quote(final_url, safe="")}'
            form['action'] = proxy_action
            continue

        if action.startswith('#') or action.lower().startswith('javascript:'):
            continue  # fragment / JS handler — leave as-is

        abs_action = urljoin(final_url, action)
        allowed, _ = _proxy_validate_url(abs_action)
        if allowed:
            form['action'] = f'/api/proxy?target_url={quote(abs_action, safe="")}'
        # else: leave action untouched — form will fail on submit (correct behavior)

    return str(soup).encode('utf-8')


# ── Route ─────────────────────────────────────────────────────────────────────

@court_bp.route('/api/proxy', methods=['GET', 'POST'])
def reverse_proxy():
    """
    In-App Browser Engine entry point.

    Query parameters
    ────────────────
    target_url  Required. Absolute URL of the government page to proxy.
                Must resolve to a domain in ALLOWED_DOMAINS (Patch 1).

    Flow
    ────
    1. Validate target_url — 403 immediately if not whitelisted.
    2. Execute upstream request with client header/cookie passthrough.
    3. If response is HTML: inject <base href>, rewrite <form> actions.
    4. Strip frame-busting / CSP response headers.
    5. Forward upstream Set-Cookie headers (preserves ASP.NET session).
    6. Return response to the browser with the correct Content-Type.
    """
    target_url = (request.args.get('target_url') or '').strip()

    if not target_url:
        return jsonify({'error': 'target_url parameter is required.'}), 400

    # ── Patch 1: SSRF guard ────────────────────────────────────────────────
    allowed, _ = _proxy_validate_url(target_url)
    if not allowed:
        return jsonify({
            'error': 'Target domain is not in the allowed list.',
            'hint':  'Only whitelisted Indian government domains may be proxied.',
        }), 403

    # ── Patches 2–3: upstream request ─────────────────────────────────────
    try:
        upstream = _proxy_fetch(target_url)
    except requests.Timeout:
        return jsonify({'error': 'The government server did not respond in time.'}), 504
    except requests.ConnectionError as exc:
        return jsonify({'error': f'Could not connect to the government server: {exc}'}), 502
    except requests.TooManyRedirects as exc:
        # This fires from our redirect SSRF guard hook (Patch 2).
        return jsonify({'error': str(exc)}), 403
    except requests.RequestException as exc:
        return jsonify({'error': f'Upstream request failed: {exc}'}), 502

    # ── Content-length guard: reject oversized responses ───────────────────
    declared_length = int(upstream.headers.get('Content-Length', 0) or 0)
    if declared_length > _PROXY_MAX_BYTES:
        return jsonify({'error': 'Government server response exceeds the proxy size limit.'}), 502

    content_type = upstream.headers.get('Content-Type', '')

    # ── Patches 3 & 4: HTML rewriting ─────────────────────────────────────
    if 'text/html' in content_type:
        raw = upstream.content
        if len(raw) > _PROXY_MAX_BYTES:
            return jsonify({'error': 'Response body exceeds proxy size limit.'}), 502
        try:
            body = _proxy_rewrite_html(raw, upstream.url)
        except Exception:
            # Rewriting failed (highly malformed HTML) — pass raw bytes through.
            body = raw
        resp_content_type = 'text/html; charset=utf-8'
    else:
        # Binary passthrough: PDFs, images, CSS, JS — no rewriting needed.
        raw = upstream.content
        if len(raw) > _PROXY_MAX_BYTES:
            return jsonify({'error': 'Response body exceeds proxy size limit.'}), 502
        body = raw
        resp_content_type = content_type

    # ── Build Flask response ───────────────────────────────────────────────
    flask_resp = make_response(body, upstream.status_code)
    flask_resp.headers['Content-Type'] = resp_content_type

    # ── Patch 4: strip frame-busting / CSP; forward safe upstream headers ──
    for key, value in upstream.headers.items():
        if key.lower() in _PROXY_STRIP_RESP_HEADERS:
            continue
        try:
            flask_resp.headers[key] = value
        except Exception:
            pass  # skip any malformed header values

    # Forward upstream cookies so the ASP.NET session stays alive.
    # Re-scope them to our domain (not the government domain) and mark
    # Secure + HttpOnly + SameSite=Strict to prevent leakage.
    for cookie in upstream.cookies:
        flask_resp.set_cookie(
            cookie.name,
            cookie.value,
            max_age=cookie.expires,
            secure=True,
            httponly=True,
            samesite='Strict',
        )

    return flask_resp
