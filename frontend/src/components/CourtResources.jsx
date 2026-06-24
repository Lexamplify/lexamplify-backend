import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  fetchCourtGlobals,
  fetchCourtData,
  fetchDistricts,
  fetchEventDetails,
  calculateCourtFee,
  fetchIPAssets,
  addIPAsset,
  updateIPAsset,
  deleteIPAsset
} from '../services/api';

// ── Curated Bare Acts — bypass proxy, open directly in new tab ───────────────
// IndiaCode (nic.in) for new criminal codes; Indian Kanoon for legacy acts.
const BARE_ACTS = [
  { name: 'Constitution of India',                          url: 'https://indiankanoon.org/doc/237570/' },
  { name: 'Bharatiya Nyaya Sanhita, 2023 (BNS)',            url: 'https://www.indiacode.nic.in/handle/123456789/20062' },
  { name: 'Bharatiya Nagarik Suraksha Sanhita, 2023 (BNSS)', url: 'https://www.indiacode.nic.in/handle/123456789/20064' },
  { name: 'Bharatiya Sakshya Adhiniyam, 2023 (BSA)',        url: 'https://www.indiacode.nic.in/handle/123456789/20063' },
  { name: 'Indian Penal Code, 1860 (IPC)',                  url: 'https://indiankanoon.org/doc/1569253/' },
  { name: 'Code of Criminal Procedure, 1973 (CrPC)',        url: 'https://indiankanoon.org/doc/445276/' },
  { name: 'Code of Civil Procedure, 1908 (CPC)',            url: 'https://indiankanoon.org/doc/74228/' },
  { name: 'Indian Evidence Act, 1872',                      url: 'https://indiankanoon.org/doc/1167802/' },
  { name: 'Indian Contract Act, 1872',                      url: 'https://indiankanoon.org/doc/172699/' },
  { name: 'Transfer of Property Act, 1882',                 url: 'https://indiankanoon.org/doc/1601408/' },
  { name: 'Specific Relief Act, 1963',                      url: 'https://indiankanoon.org/doc/1616744/' },
  { name: 'Limitation Act, 1963',                          url: 'https://indiankanoon.org/doc/1271402/' },
];

// ── CSV-ingested High Court routing table (high courts.csv, June 2026) ──────
// Keys match stateLabelMap. Each entry has exactly the 5 official portal links.
const HIGH_COURT_LINKS = {
  delhi: {
    mainWebsite:  'https://delhihighcourt.nic.in/web/',
    causeList:    'https://delhihighcourt.nic.in/app/online-causelist',
    eFiling:      'https://dhcefiling.nic.in/eFiling/',
    caseStatus:   'https://delhihighcourt.nic.in/app/get-case-type-status',
    displayBoard: 'https://delhihighcourt.nic.in/app/physical-display-board',
  },
  maharashtra: {
    mainWebsite:  'https://bombayhighcourt.gov.in/bhc/',
    causeList:    'https://bombayhighcourt.gov.in/bhc/causelistFinal',
    eFiling:      'https://filing.ecourts.gov.in/pdedev/',
    caseStatus:   'https://bombayhighcourt.gov.in/bhc/casestatus/casenumber',
    displayBoard: 'https://bombayhighcourt.gov.in/bhc/displayboard',
  },
  tamil_nadu: {
    mainWebsite:  'https://hcmadras.tn.gov.in/',
    causeList:    'https://mhc.tn.gov.in/judis/clists/clists-madras/index.php',
    eFiling:      'https://filing.ecourts.gov.in/pdedev/',
    caseStatus:   'https://hcmadras.tn.gov.in/case_status_mas.php',
    displayBoard: 'https://hcmadras.tn.gov.in/display_board_mhc.php',
  },
  karnataka: {
    mainWebsite:  'https://judiciary.karnataka.gov.in/',
    causeList:    'https://judiciary.karnataka.gov.in/causelistSearch.php',
    eFiling:      'https://filing.ecourts.gov.in/pdedev/',
    caseStatus:   'https://judiciary.karnataka.gov.in/casemenu.php',
    displayBoard: 'https://judiciary.karnataka.gov.in/display_board_bench.php',
  },
  up: {
    mainWebsite:  'https://www.allahabadhighcourt.in/',
    causeList:    'https://www.allahabadhighcourt.in/causelist/indexA.html',
    eFiling:      'https://efiling-alld.allahabadhighcourt.in/onlinecasefiling/',
    caseStatus:   'https://www.allahabadhighcourt.in/apps/status_ccms/',
    displayBoard: 'https://courtview2.allahabadhighcourt.in/courtview/CourtViewAllahabad.do',
  },
  gujarat: {
    mainWebsite:  'https://gujarathighcourt.nic.in/',
    causeList:    'https://gujarathc-casestatus.nic.in/gujarathc/#',
    eFiling:      'https://filing.ecourts.gov.in/pdedev/',
    caseStatus:   'https://gujarathc-casestatus.nic.in/gujarathc/#',
    displayBoard: 'https://gujarathighcourt.nic.in/boarddisplay',
  },
  rajasthan: {
    mainWebsite:  'https://hcraj.nic.in/hcraj/',
    causeList:    'https://hcraj.nic.in/cishcraj-jdp/causelists/',
    eFiling:      'https://filing.ecourts.gov.in/pdedev/',
    caseStatus:   'https://hcraj.nic.in/cishcraj_urn/',
    displayBoard: 'https://hcraj.nic.in/displayboard/jodhpur.php',
  },
  west_bengal: {
    mainWebsite:  'https://www.calcuttahighcourt.gov.in/',
    causeList:    'https://www.calcuttahighcourt.gov.in/Cause-Lists',
    eFiling:      'https://filing.ecourts.gov.in/pdedev/',
    caseStatus:   'https://hcservices.ecourts.gov.in/ecourtindiaHC/index_highcourt.php?state_cd=16&dist_cd=1&court_code=2&stateNm=Calcutta#',
    displayBoard: 'https://display.calcuttahighcourt.gov.in/principal.php',
  },
  kerala: {
    mainWebsite:  'https://highcourt.kerala.gov.in/',
    causeList:    'https://hckinfo.keralacourts.in/digicourt/Casedetailssearch/viewCauselist',
    eFiling:      'https://ecourt.keralacourts.in/digicourt/',
    caseStatus:   'https://hckinfo.keralacourts.in/digicourt/Casedetailssearch',
    displayBoard: 'https://highcourt.kerala.gov.in/notice_board.php',
  },
  telangana: {
    mainWebsite:  'https://tshc.gov.in/',
    causeList:    'https://causelist.tshc.gov.in/showDailyCauseList',
    eFiling:      'https://filing.ecourts.gov.in/pdedev/',
    caseStatus:   'https://csis.tshc.gov.in/',
    displayBoard: 'https://displayboard.tshc.gov.in/hcdbs/displayall',
  },
  andhra: {
    mainWebsite:  'https://aphc.gov.in/index.php',
    causeList:    'https://aphc.gov.in/Hcdbs/searchdates.action',
    eFiling:      'https://filing.ecourts.gov.in/pdedev/',
    caseStatus:   'https://digi-courts.aphc.ap.gov.in/csis_ap/',
    displayBoard: 'https://aphc.gov.in/Hcdbs/displayboard.jsp',
  },
};

const styles = `
  .resources-container {
    padding: 24px;
    font-family: var(--font-sans);
    color: var(--text-dark-primary);
  }

  .banner-card {
    background: linear-gradient(135deg, var(--bg-dark-panel) 0%, #1e2230 100%);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 12px;
    padding: 20px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
  }

  .session-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .session-pill.in {
    background-color: rgba(16, 185, 129, 0.15);
    color: var(--accent-success);
    border: 1px solid rgba(16, 185, 129, 0.3);
  }

  .session-pill.holiday {
    background-color: rgba(239, 68, 68, 0.15);
    color: var(--accent-danger);
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .session-pill .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: currentColor;
    box-shadow: 0 0 8px currentColor;
  }

  /* Tabs Navigation */
  .tabs-wrapper {
    display: flex;
    overflow-x: auto;
    border-bottom: 1px solid var(--border-dark-subtle);
    margin-bottom: 24px;
    gap: 8px;
    padding-bottom: 4px;
  }

  .tab-btn {
    background: transparent;
    border: none;
    color: var(--text-dark-muted);
    padding: 10px 16px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    border-radius: 6px;
    white-space: nowrap;
    transition: all 0.2s;
  }

  .tab-btn:hover {
    color: var(--text-dark-primary);
    background-color: rgba(255, 255, 255, 0.04);
  }

  .tab-btn.active {
    color: var(--accent-primary);
    background-color: var(--accent-muted);
    font-weight: 600;
  }

  /* Panels and Sub-Tabs */
  .resource-panel {
    background-color: var(--bg-dark-panel);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 12px;
    padding: 24px;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15);
  }

  .panel-header {
    margin-bottom: 20px;
  }

  .panel-header h2 {
    font-size: 20px;
    margin-bottom: 6px;
    color: white;
  }

  .panel-header p {
    font-size: 13px;
    color: var(--text-dark-muted);
  }

  .sub-tabs-wrapper {
    display: flex;
    gap: 6px;
    margin-bottom: 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    padding-bottom: 8px;
  }

  .sub-tab-btn {
    background: transparent;
    border: none;
    color: var(--text-dark-muted);
    padding: 8px 12px;
    font-size: 13px;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.2s;
  }

  .sub-tab-btn:hover {
    color: white;
    background-color: rgba(255, 255, 255, 0.03);
  }

  .sub-tab-btn.active {
    color: white;
    background-color: rgba(255, 255, 255, 0.08);
    font-weight: 600;
  }

  /* Forms and Controls */
  .control-row {
    display: flex;
    gap: 16px;
    margin-bottom: 20px;
    flex-wrap: wrap;
  }

  .input-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-width: 200px;
  }

  .input-label {
    font-size: 12px;
    color: var(--text-dark-muted);
    font-weight: 500;
  }

  .select-element {
    background-color: var(--bg-dark-app);
    border: 1px solid var(--border-dark-subtle);
    color: var(--text-dark-primary);
    border-radius: 6px;
    padding: 10px 14px;
    font-family: var(--font-sans);
    font-size: 13.5px;
    outline: none;
    cursor: pointer;
    transition: border-color 0.2s;
  }

  .select-element:focus {
    border-color: var(--accent-primary);
  }

  .search-input-field {
    background-color: var(--bg-dark-app);
    border: 1px solid var(--border-dark-subtle);
    color: var(--text-dark-primary);
    border-radius: 6px;
    padding: 10px 14px;
    font-family: var(--font-sans);
    font-size: 13.5px;
    outline: none;
    transition: border-color 0.2s;
  }

  .search-input-field:focus {
    border-color: var(--accent-primary);
  }

  /* Grid Lists and Cards */
  .grid-container {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }

  .premium-card {
    background-color: var(--bg-dark-card);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 10px;
    padding: 18px;
    transition: transform 0.2s, border-color 0.2s;
    cursor: pointer;
  }

  .premium-card:hover {
    transform: translateY(-2px);
    border-color: rgba(59, 130, 246, 0.4);
  }

  .card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .card-badge {
    font-size: 11px;
    background-color: rgba(59, 130, 246, 0.15);
    color: var(--accent-primary);
    padding: 2px 8px;
    border-radius: 12px;
    font-weight: 600;
  }

  .card-h3 {
    font-size: 15px;
    margin-bottom: 8px;
    color: white;
  }

  .card-desc {
    font-size: 12.5px;
    color: var(--text-dark-muted);
    line-height: 1.4;
    margin-bottom: 12px;
  }

  .card-action-text {
    font-size: 12px;
    font-weight: 600;
    color: var(--accent-primary);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  /* Tables and Lists */
  .responsive-table-container {
    overflow-x: auto;
    width: 100%;
    border-radius: 8px;
    border: 1px solid var(--border-dark-subtle);
  }

  .premium-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
    text-align: left;
  }

  .premium-table th {
    background-color: var(--bg-dark-sidebar);
    padding: 12px 16px;
    font-weight: 600;
    color: var(--text-dark-muted);
    border-bottom: 1px solid var(--border-dark-subtle);
  }

  .premium-table td {
    padding: 14px 16px;
    border-bottom: 1px solid var(--border-dark-subtle);
    vertical-align: middle;
  }

  .premium-table tr:hover {
    background-color: rgba(255, 255, 255, 0.01);
  }

  .premium-table tr:last-child td {
    border-bottom: none;
  }

  .copy-btn-link {
    background: transparent;
    border: none;
    color: var(--accent-primary);
    cursor: pointer;
    font-size: 12px;
    margin-left: 8px;
    text-decoration: underline;
  }

  .copy-btn-link:hover {
    color: white;
  }

  /* Event Details Modal */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.7);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    backdrop-filter: blur(4px);
  }

  .modal-card {
    background-color: var(--bg-dark-panel);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 12px;
    width: 100%;
    max-width: 580px;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 20px 24px;
    border-bottom: 1px solid var(--border-dark-subtle);
  }

  .modal-body {
    padding: 24px;
  }

  .modal-meta-row {
    display: flex;
    margin-bottom: 12px;
    font-size: 13.5px;
  }

  .modal-meta-label {
    width: 100px;
    color: var(--text-dark-muted);
    font-weight: 500;
  }

  .modal-meta-value {
    flex: 1;
    color: white;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 24px;
    border-top: 1px solid var(--border-dark-subtle);
  }

  /* Skeleton Loading Styles */
  .skeleton-line {
    background: linear-gradient(90deg, #1A1C26 25%, #222533 50%, #1A1C26 75%);
    background-size: 200% 100%;
    animation: loading-shimmer 1.5s infinite;
    border-radius: 4px;
    height: 14px;
    margin-bottom: 12px;
  }

  @keyframes loading-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* Toast Notification */
  .toast-banner {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background-color: var(--accent-success);
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 1100;
    font-size: 13.5px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  /* ── Live Events Skeleton ───────────────────────── */
  .events-skeleton-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }
  .events-skeleton-card {
    background: var(--bg-dark-card);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 12px;
    padding: 18px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .skel-line {
    background: linear-gradient(90deg, rgba(255,255,255,.04) 25%, rgba(255,255,255,.09) 50%, rgba(255,255,255,.04) 75%);
    background-size: 200% 100%;
    border-radius: 4px;
    animation: skelShimmer 1.4s ease infinite;
  }
  @keyframes skelShimmer { to { background-position: -200% 0; } }

  .events-source-pill {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 9.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .06em; color: #1E293B;
    background: rgba(255,255,255,.05);
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 10px; padding: 2px 7px; flex-shrink: 0;
  }
  .events-error-state {
    display: flex; flex-direction: column; align-items: center; gap: 14px;
    padding: 48px 24px; text-align: center;
    border: 1px dashed rgba(255,255,255,.08); border-radius: 12px;
    color: var(--text-dark-muted);
  }

  /* ── PDF Viewer Modal ──────────────────────────── */
  .pdf-modal-overlay {
    position: fixed; inset: 0; z-index: 9000;
    background: rgba(0,0,0,.72);
    backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
    animation: pdfFadeIn .18s ease;
  }
  @keyframes pdfFadeIn { from { opacity: 0; } to { opacity: 1; } }

  .pdf-modal-container {
    width: min(92vw, 1080px);
    height: min(90vh, 860px);
    background: #0f1117;
    border: 1px solid rgba(255,255,255,.1);
    border-radius: 14px;
    display: flex; flex-direction: column;
    overflow: hidden;
    box-shadow: 0 32px 80px rgba(0,0,0,.6);
    animation: pdfSlideUp .2s ease;
  }
  @keyframes pdfSlideUp { from { transform: translateY(18px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

  .pdf-modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 13px 18px;
    background: #161a26;
    border-bottom: 1px solid rgba(255,255,255,.08);
    flex-shrink: 0;
  }
  .pdf-modal-title {
    font-size: 13.5px; font-weight: 600; color: #E2E8F0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    max-width: 70%;
  }
  .pdf-modal-actions { display: flex; align-items: center; gap: 8px; }
  .pdf-modal-close {
    background: none; border: none; color: #64748B; cursor: pointer;
    padding: 4px 7px; border-radius: 6px; font-size: 18px; line-height: 1;
    transition: color .13s, background .13s;
  }
  .pdf-modal-close:hover { color: #E2E8F0; background: rgba(255,255,255,.08); }

  .pdf-modal-body {
    flex: 1; display: flex; align-items: center; justify-content: center;
    overflow: hidden; background: #1a1f2e;
  }
  .pdf-modal-iframe {
    width: 100%; height: 100%; border: none;
  }
  .pdf-modal-state {
    display: flex; flex-direction: column; align-items: center; gap: 14px;
    color: #64748B; font-size: 13px;
  }
  .pdf-modal-spinner {
    width: 32px; height: 32px;
    border: 3px solid rgba(59,130,246,.2);
    border-top-color: #3B82F6;
    border-radius: 50%;
    animation: spin .7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
`;

// Judge roster DB for District courts matching the HTML page
const DISTRICT_JUDGES_DB = {
  "Madurai District Court": [
    { name: "Thiru. A. Muthusamy", designation: "Principal District Judge", room: "Court Hall 1" },
    { name: "Tmt. K. Dakshinamoorthy", designation: "I Additional District Judge", room: "Court Hall 2" },
    { name: "Thiru. S. Kasi", designation: "Chief Judicial Magistrate", room: "Court Hall 3" },
    { name: "Tmt. R. Selvakumar", designation: "Family Court Judge", room: "Court Hall 4" },
    { name: "Thiru. M. Senthil", designation: "Sub Judge", room: "Court Hall 5" }
  ],
  "Pune District Court": [
    { name: "Shri. S. V. Yarlagadda", designation: "Principal District Judge", room: "Room 101" }
  ],
  "Delhi Tis Hazari": [
    { name: "Shri. Narottam Kaushal", designation: "Principal District & Sessions Judge", room: "Room 1" }
  ]
};

export default function CourtResources() {
  const location = useLocation();

  const [activeTab, setActiveTab] = useState('supreme');

  // ── Deep-link from AI Legal Associate navigation ──────────────────────────
  // When the AI navigates here with { state: { openTab: 'highcourt' } }, auto-switch tab
  useEffect(() => {
    const requestedTab = location.state?.openTab;
    const VALID_TABS = ['supreme','highcourt','district','laws','forms','events','courtfee','enotary','iptracker'];
    if (requestedTab && VALID_TABS.includes(requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, [location.state]);
  const [globals, setGlobals] = useState({ sc_courts: [], bare_acts: [], events: [], cause_list_urls: {} });
  const [loadingGlobals, setLoadingGlobals] = useState(true);
  
  // High Court States
  const [hcState, setHcState] = useState('delhi');
  const [hcData, setHcData] = useState({ hc: null, judges: [], forms: [] });
  const [loadingHC, setLoadingHC] = useState(true);
  const [hcSubTab, setHcSubTab] = useState('overview');
  
  // District Court States
  const [districtsDb, setDistrictsDb] = useState({});
  const [selectedDistState, setSelectedDistState] = useState('');
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const [distSubTab, setDistSubTab] = useState('overview');
  const [loadingDistricts, setLoadingDistricts] = useState(false);
  
  // IP Tracker States
  const [ipAssets, setIpAssets] = useState([]);
  const [loadingIP, setLoadingIP] = useState(true);
  const [ipModal, setIpModal] = useState({
    isOpen: false,
    mode: 'add',
    id: null,
    ip_type: 'Trademark',
    title: '',
    registration_number: '',
    filing_date: '',
    renewal_due: '',
    status: 'Active',
    notes: ''
  });

  // Modal / Detailed Events States
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [eventModalData, setEventModalData] = useState(null);
  const [eventModalStatus, setEventModalStatus] = useState('idle'); // 'idle' | 'loading' | 'content' | 'error'
  const [eventModalError, setEventModalError] = useState('');
  const [pdfModal, setPdfModal] = useState({ open: false, loading: false, isScraping: false, error: false, blobUrl: null, title: '', fallbackUrl: '' });

  // Live Events feed state
  const [liveEvents, setLiveEvents]     = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsError, setEventsError]   = useState(null);
  
  // Search Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [eventsFilter, setEventsFilter] = useState('all');

  // Fee Calculator States
  const [feeAmount, setFeeAmount] = useState('');
  const [feeCourt, setFeeCourt] = useState('delhi_hc');
  const [calculatedFee, setCalculatedFee] = useState(null);
  const [feeNote, setFeeNote] = useState('');
  const [calculatingFee, setCalculatingFee] = useState(false);

  // Forms court-filter state
  const [activeCourtFilter, setActiveCourtFilter] = useState('All');

  // Toast State
  const [toastMessage, setToastMessage] = useState(null);

  // ── secure reverse proxy — used for cause lists (embeds inside app) ──────
  const openInAppBrowser = (targetUrl) => {
    if (!targetUrl) return;
    const apiBase = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com';
    const proxyUrl = `${apiBase}/api/proxy?target_url=${encodeURIComponent(targetUrl)}`;
    const windowFeatures = 'width=1024,height=768,left=150,top=80,resizable=yes,scrollbars=yes,status=no,toolbar=no';
    const popup = window.open(proxyUrl, 'LexAISecureBrowser', windowFeatures);
    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      alert('⚠️ Your browser blocked the secure LexAI secure window pop-up. Please allow pop-ups in your browser address bar.');
    }
  };

  // ── direct external link — used for event URLs so gov sites don't ─────────
  // reject the proxy referrer and redirect to their own homepage
  const openDirectLink = (url) => {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Toast helper
  const triggerToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Copy helper
  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    triggerToast('VC Link Copied!');
  };

  // ── Legal Forms PDF viewer ────────────────────────────────────────────────
  // For url_type:'pdf' — fetch binary via the existing /api/proxy (which already
  // strips X-Frame-Options + CSP for gov.in/nic.in), convert to blob:// URL,
  // and render in <iframe>.  blob:// is same-origin so X-Frame-Options is moot.
  // For url_type:'page' — no direct PDF path exists; fall back to external tab.
  const openFormInModal = async (form) => {
    if (form.url_type === 'page') {
      window.open(form.url, '_blank', 'noopener,noreferrer');
      return;
    }
    const isScraping = form.url_type === 'dynamic_pdf';
    setPdfModal({ open: true, loading: true, isScraping, error: false, blobUrl: null, title: form.name, fallbackUrl: form.url });
    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com';
      let fetchUrl;
      if (isScraping) {
        // dynamic_pdf: backend scrapes sci.gov.in/forms/, extracts direct PDF href, streams binary
        const searchTitle = encodeURIComponent(form.sc_title || form.name);
        fetchUrl = `${apiBase}/api/forms/fetch-dynamic?form_title=${searchTitle}`;
      } else {
        // pdf: direct proxy of a known static PDF URL
        fetchUrl = `${apiBase}/api/proxy?target_url=${encodeURIComponent(form.url)}`;
      }
      const res = await fetch(fetchUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) throw new Error('Backend returned error JSON');
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      setPdfModal(prev => ({ ...prev, loading: false, isScraping: false, blobUrl }));
    } catch {
      setPdfModal(prev => ({ ...prev, loading: false, isScraping: false, error: true }));
    }
  };

  const closePdfModal = () => {
    if (pdfModal.blobUrl) URL.revokeObjectURL(pdfModal.blobUrl);
    setPdfModal({ open: false, loading: false, isScraping: false, error: false, blobUrl: null, title: '', fallbackUrl: '' });
  };

  // ── Live Events RSS ingestion ─────────────────────────────────────────────
  const fetchLiveEvents = async (forceRefresh = false) => {
    setLoadingEvents(true);
    setEventsError(null);
    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com';
      const res  = await fetch(`${apiBase}/api/legal-events${forceRefresh ? '?refresh=1' : ''}`);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Feed unavailable');
      setLiveEvents(data.events || []);
    } catch (err) {
      setEventsError(err.message || 'Failed to load live events');
    } finally {
      setLoadingEvents(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'events' && liveEvents.length === 0 && !loadingEvents && !eventsError) {
      fetchLiveEvents();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // ── INIT: Load court-globals ──────────────────────────────────────────
  useEffect(() => {
    const loadGlobals = async () => {
      setLoadingGlobals(true);
      const res = await fetchCourtGlobals();
      if (!res.error) {
        setGlobals(res);
      }
      setLoadingGlobals(false);
    };
    loadGlobals();
  }, []);

  // ── Load High Court data when state changes ────────────────────────────
  useEffect(() => {
    const loadHCData = async () => {
      setLoadingHC(true);
      const res = await fetchCourtData(hcState);
      if (!res.error) {
        setHcData(res);
      }
      setLoadingHC(false);
    };
    loadHCData();
  }, [hcState]);

  // ── Load District Database once for cascading select ─────────────────
  useEffect(() => {
    const loadDistrictsDb = async () => {
      setLoadingDistricts(true);
      const res = await fetchDistricts();
      if (!res.error) {
        setDistrictsDb(res);
      }
      setLoadingDistricts(false);
    };
    loadDistrictsDb();
  }, []);

  // ── Load IP Assets ──────────────────────────────────────────────────
  const loadIP = async () => {
    setLoadingIP(true);
    const res = await fetchIPAssets();
    if (!res.error) {
      setIpAssets(res);
    }
    setLoadingIP(false);
  };

  useEffect(() => {
    if (activeTab === 'iptracker') {
      loadIP();
    }
  }, [activeTab]);

  // ── Banner text and court operational status ────────────────────────
  const { dateText, isWeekend } = (() => {
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const d = new Date();
    const dateText = `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    return { dateText, isWeekend };
  })();

  // ── Event scraper detail modal orchestrator ─────────────────────────
  const openEventModal = async (id, fallbackTitle, fallbackUrl, fallbackType, fallbackDate) => {
    setSelectedEventId(id);
    setEventModalStatus('loading');
    setEventModalError('');
    setEventModalData({
      title: fallbackTitle,
      event_date: fallbackDate,
      venue: '',
      organizer: '',
      description: '',
      register_url: fallbackUrl,
      source_url: fallbackUrl,
      type: fallbackType
    });

    const res = await fetchEventDetails(id);
    if (res.error) {
      setEventModalStatus('error');
      setEventModalError(res.message || 'Scraper failed to pull details from server.');
    } else {
      setEventModalData(res);
      setEventModalStatus('content');
    }
  };

  const closeEventModal = () => {
    setSelectedEventId(null);
    setEventModalStatus('idle');
    setEventModalData(null);
  };

  // ── Court Fee Calculator handler ────────────────────────────────────
  const handleCalculateFee = async (e) => {
    e.preventDefault();
    if (!feeAmount) return;
    setCalculatingFee(true);
    const res = await calculateCourtFee(parseFloat(feeAmount), feeCourt);
    if (!res.error) {
      setCalculatedFee(res.fee);
      setFeeNote(res.note);
    } else {
      setCalculatedFee('Error');
      setFeeNote('Could not calculate fee. Please try again.');
    }
    setCalculatingFee(false);
  };

  // ── IP Tracker Form Actions ─────────────────────────────────────────
  const openIPModalForm = (mode, asset = null) => {
    if (mode === 'edit' && asset) {
      setIpModal({
        isOpen: true,
        mode: 'edit',
        id: asset.id,
        ip_type: asset.ip_type || 'Trademark',
        title: asset.title || '',
        registration_number: asset.registration_number || '',
        filing_date: asset.filing_date || '',
        renewal_due: asset.renewal_due || '',
        status: asset.status || 'Active',
        notes: asset.notes || ''
      });
    } else {
      setIpModal({
        isOpen: true,
        mode: 'add',
        id: null,
        ip_type: 'Trademark',
        title: '',
        registration_number: '',
        filing_date: '',
        renewal_due: '',
        status: 'Active',
        notes: ''
      });
    }
  };

  const saveIPAssetItem = async (e) => {
    e.preventDefault();
    if (!ipModal.title.trim()) {
      alert('Title is required');
      return;
    }

    const payload = {
      ip_type: ipModal.ip_type,
      title: ipModal.title.trim(),
      registration_number: ipModal.registration_number.trim(),
      filing_date: ipModal.filing_date || null,
      renewal_due: ipModal.renewal_due || null,
      status: ipModal.status,
      notes: ipModal.notes.trim()
    };

    let res;
    if (ipModal.mode === 'edit') {
      res = await updateIPAsset(ipModal.id, payload);
    } else {
      res = await addIPAsset(payload);
    }

    if (!res.error) {
      triggerToast(ipModal.mode === 'edit' ? 'IP Asset updated!' : 'IP Asset created!');
      setIpModal(prev => ({ ...prev, isOpen: false }));
      loadIP();
    } else {
      alert(res.message || 'Failed to save IP asset.');
    }
  };

  const deleteIPAssetItem = async (id, title) => {
    if (!window.confirm(`Are you sure you want to permanently delete "${title}"?`)) {
      return;
    }
    const res = await deleteIPAsset(id);
    if (!res.error) {
      triggerToast('IP Asset deleted');
      loadIP();
    } else {
      alert(res.message || 'Failed to delete IP asset.');
    }
  };

  // State dropdown mapping labels
  const stateLabelMap = {
    delhi: 'Delhi',
    maharashtra: 'Maharashtra',
    tamil_nadu: 'Tamil Nadu',
    karnataka: 'Karnataka',
    up: 'Uttar Pradesh',
    gujarat: 'Gujarat',
    rajasthan: 'Rajasthan',
    west_bengal: 'West Bengal',
    kerala: 'Kerala',
    telangana: 'Telangana',
    andhra: 'Andhra Pradesh'
  };

  const hcLinks = HIGH_COURT_LINKS[hcState] || {};

  const formatIPDate = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <>
      <style>{styles}</style>
      <div className="resources-container">
        
        {/* Date / Session Status Banner */}
        <div className="banner-card">
          <div>
            <h1 style={{ fontSize: '24px', marginBottom: '4px', fontFamily: 'var(--font-serif)' }}>Court Directory &amp; Resources</h1>
            <span style={{ fontSize: '13px', color: 'var(--text-dark-muted)' }}>{dateText}</span>
          </div>
          <span className={`session-pill ${isWeekend ? 'holiday' : 'in'}`}>
            <span className="dot"></span>
            {isWeekend ? 'Court Holiday' : 'Court in Session'}
          </span>
        </div>

        {/* Breadcrumb back navigation */}
        <div style={{ marginBottom: '20px' }}>
          <Link to="/dashboard" style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontSize: '13px' }}>
            ← Back to Advocate Terminal
          </Link>
        </div>

        {/* Global tab options */}
        <div className="tabs-wrapper">
          <button className={`tab-btn ${activeTab === 'supreme' ? 'active' : ''}`} onClick={() => { setActiveTab('supreme'); setSearchQuery(''); }}>🏛️ Supreme Court</button>
          <button className={`tab-btn ${activeTab === 'highcourt' ? 'active' : ''}`} onClick={() => { setActiveTab('highcourt'); setSearchQuery(''); }}>🏢 High Courts</button>
          <button className={`tab-btn ${activeTab === 'district' ? 'active' : ''}`} onClick={() => { setActiveTab('district'); setSearchQuery(''); }}>📂 District Courts</button>
          <button className={`tab-btn ${activeTab === 'laws' ? 'active' : ''}`} onClick={() => { setActiveTab('laws'); setSearchQuery(''); }}>📖 Bare Acts</button>
          <button className={`tab-btn ${activeTab === 'forms' ? 'active' : ''}`} onClick={() => { setActiveTab('forms'); setSearchQuery(''); }}>📋 Legal Forms</button>
          <button className={`tab-btn ${activeTab === 'events' ? 'active' : ''}`} onClick={() => { setActiveTab('events'); setSearchQuery(''); }}>📅 Legal Events</button>
          <button className={`tab-btn ${activeTab === 'courtfee' ? 'active' : ''}`} onClick={() => { setActiveTab('courtfee'); setSearchQuery(''); }}>⚖️ Fee Calculator</button>
          <button className={`tab-btn ${activeTab === 'enotary' ? 'active' : ''}`} onClick={() => { setActiveTab('enotary'); setSearchQuery(''); }}>🔏 e-Notary</button>
          <button className={`tab-btn ${activeTab === 'iptracker' ? 'active' : ''}`} onClick={() => { setActiveTab('iptracker'); setSearchQuery(''); }}>🏷️ IP Tracker</button>
        </div>

        {/* ────────── TAB 1: SUPREME COURT ────────── */}
        {activeTab === 'supreme' && (
          <div className="resource-panel">
            <div className="panel-header">
              <h2>Supreme Court of India</h2>
              <p>Virtual hearing details, courtroom video links, and official display boards.</p>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '24px', alignItems: 'start' }}>
              <div className="responsive-table-container">
                {loadingGlobals ? (
                  <div style={{ padding: '30px', textAlign: 'center', fontStyle: 'italic', color: 'var(--text-dark-muted)' }}>Loading virtual court directory...</div>
                ) : (
                  <table className="premium-table">
                    <thead>
                      <tr>
                        <th>Courtroom</th>
                        <th>VC Webex Meeting Link</th>
                        <th>Status</th>
                        <th>Court Master Email</th>
                      </tr>
                    </thead>
                    <tbody>
                      {globals.sc_courts.map((court, i) => (
                        <tr key={i}>
                          <td><strong>Court {court.room}</strong></td>
                          <td>
                            <a href={court.vc} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>
                              {court.vc.length > 40 ? `${court.vc.slice(0, 40)}...` : court.vc}
                            </a>
                            <button className="copy-btn-link" onClick={() => handleCopy(court.vc)}>Copy</button>
                          </td>
                          <td>
                            <button className="copy-btn-link" style={{ marginLeft: 0 }} onClick={() => openInAppBrowser('https://sci.gov.in/display-board')}>
                              📺 {court.meetId} ↗
                            </button>
                          </td>
                          <td style={{ fontSize: '12.5px', color: 'var(--text-dark-muted)' }}>{court.email}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Sidebar Action Widget */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ backgroundColor: 'var(--bg-dark-card)', border: '1px solid var(--border-dark-subtle)', borderRadius: '10px', padding: '18px' }}>
                  <h4 style={{ fontSize: '14px', marginBottom: '10px', color: 'white' }}>Today's Cause List</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-dark-muted)', marginBottom: '14px', lineHeight: '1.4' }}>
                    Pull the official day list for the Supreme Court.
                  </p>
                  <button className="btn-accent" style={{ width: '100%', fontSize: '13px' }} onClick={() => openInAppBrowser('https://www.sci.gov.in/cause-list/')}>
                    📄 Open SC Cause List ↗
                  </button>
                </div>
                <div style={{ backgroundColor: 'var(--bg-dark-card)', border: '1px solid var(--border-dark-subtle)', borderRadius: '10px', padding: '18px' }}>
                  <h4 style={{ fontSize: '14px', marginBottom: '10px', color: 'white' }}>Supreme Court Calendar</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-dark-muted)', marginBottom: '14px', lineHeight: '1.4' }}>
                    Official holiday and sitting scheduler.
                  </p>
                  <button className="btn-accent" style={{ width: '100%', fontSize: '13px', background: 'transparent', border: '1px solid var(--border-dark-subtle)', color: 'white' }} onClick={() => openInAppBrowser('https://sci.gov.in/sitting-judges-calendar')}>
                    📅 Sitting Calendar ↗
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ────────── TAB 2: HIGH COURTS ────────── */}
        {activeTab === 'highcourt' && (
          <div className="resource-panel">
            <div className="control-row">
              <div className="input-group" style={{ maxWidth: '320px' }}>
                <label className="input-label">Select State High Court</label>
                <select className="select-element" value={hcState} onChange={(e) => { setHcState(e.target.value); setHcSubTab('overview'); setSearchQuery(''); }}>
                  {Object.keys(stateLabelMap).map(k => (
                    <option key={k} value={k}>{stateLabelMap[k]} High Court</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="sub-tabs-wrapper">
              <button className={`sub-tab-btn ${hcSubTab === 'overview' ? 'active' : ''}`} onClick={() => setHcSubTab('overview')}>🏛️ Overview &amp; Links</button>
              <button className={`sub-tab-btn ${hcSubTab === 'judges' ? 'active' : ''}`} onClick={() => setHcSubTab('judges')}>📋 Judges Roster ({hcData.judges.length})</button>
            </div>

            {loadingHC ? (
              <div style={{ padding: '40px', textAlign: 'center', fontStyle: 'italic', color: 'var(--text-dark-muted)' }}>Loading High Court data...</div>
            ) : (
              <div>
                {/* SUB TAB: Overview */}
                {hcSubTab === 'overview' && hcData.hc && (
                  <div>
                    <div style={{ padding: '12px 16px', background: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.15)', borderRadius: '8px', marginBottom: '24px', fontSize: '13.5px' }}>
                      🔗 Selected: <strong>{hcData.hc.name}</strong>. Access official legal modules directly via the secure virtual sandbox browser.
                    </div>
                    
                    <div className="grid-container">
                      <div
                        className="premium-card"
                        onClick={hcLinks.mainWebsite ? () => openInAppBrowser(hcLinks.mainWebsite) : undefined}
                        style={!hcLinks.mainWebsite ? { opacity: 0.45, cursor: 'not-allowed', pointerEvents: 'none' } : {}}
                      >
                        <div className="card-top">
                          <span className="card-badge">Portal</span>
                          <span style={{ fontSize: '16px' }}>🏛️</span>
                        </div>
                        <h3 className="card-h3">Main Court Website</h3>
                        <p className="card-desc">Navigate directly to the official homepage announcements.</p>
                        <div className="card-action-text">{hcLinks.mainWebsite ? 'Launch Portal ↗' : 'Not Available'}</div>
                      </div>

                      <div
                        className="premium-card"
                        onClick={hcLinks.causeList ? () => openInAppBrowser(hcLinks.causeList) : undefined}
                        style={!hcLinks.causeList ? { opacity: 0.45, cursor: 'not-allowed', pointerEvents: 'none' } : {}}
                      >
                        <div className="card-top">
                          <span className="card-badge">Daily</span>
                          <span style={{ fontSize: '16px' }}>📅</span>
                        </div>
                        <h3 className="card-h3">Cause List Directory</h3>
                        <p className="card-desc">Review and pull today's cause lists and board rosters.</p>
                        <div className="card-action-text">{hcLinks.causeList ? 'Check Board ↗' : 'Not Available'}</div>
                      </div>

                      <div
                        className="premium-card"
                        onClick={hcLinks.eFiling ? () => openInAppBrowser(hcLinks.eFiling) : undefined}
                        style={!hcLinks.eFiling ? { opacity: 0.45, cursor: 'not-allowed', pointerEvents: 'none' } : {}}
                      >
                        <div className="card-top">
                          <span className="card-badge">Ingestion</span>
                          <span style={{ fontSize: '16px' }}>📤</span>
                        </div>
                        <h3 className="card-h3">E-Filing Portal</h3>
                        <p className="card-desc">Submit case files, plaints, and applications online.</p>
                        <div className="card-action-text">{hcLinks.eFiling ? 'Start Filing ↗' : 'Not Available'}</div>
                      </div>

                      <div
                        className="premium-card"
                        onClick={hcLinks.caseStatus ? () => openInAppBrowser(hcLinks.caseStatus) : undefined}
                        style={!hcLinks.caseStatus ? { opacity: 0.45, cursor: 'not-allowed', pointerEvents: 'none' } : {}}
                      >
                        <div className="card-top">
                          <span className="card-badge">Search</span>
                          <span style={{ fontSize: '16px' }}>🔍</span>
                        </div>
                        <h3 className="card-h3">Case History Status</h3>
                        <p className="card-desc">Track progress, hearings, and orders by case number.</p>
                        <div className="card-action-text">{hcLinks.caseStatus ? 'Query Status ↗' : 'Not Available'}</div>
                      </div>

                      <div
                        className="premium-card"
                        onClick={hcLinks.displayBoard ? () => openInAppBrowser(hcLinks.displayBoard) : undefined}
                        style={!hcLinks.displayBoard ? { opacity: 0.45, cursor: 'not-allowed', pointerEvents: 'none' } : {}}
                      >
                        <div className="card-top">
                          <span className="card-badge">Live</span>
                          <span style={{ fontSize: '16px' }}>📺</span>
                        </div>
                        <h3 className="card-h3">Physical Display Board</h3>
                        <p className="card-desc">Real-time status board indicating which matter is active in courtroom.</p>
                        <div className="card-action-text">{hcLinks.displayBoard ? 'Launch Board ↗' : 'Not Available'}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* SUB TAB: Judges */}
                {hcSubTab === 'judges' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <input
                        type="text"
                        placeholder="Filter judges by name or room..."
                        className="search-input-field"
                        style={{ width: '100%', maxWidth: '320px' }}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                    </div>

                    {hcData.judges.length === 0 ? (
                      <div style={{ padding: '20px', backgroundColor: 'var(--bg-dark-card)', borderRadius: '8px', textAlign: 'center', color: 'var(--text-dark-muted)' }}>
                        No judges roster data loaded for this court. Use the website overview tab to view official directory listings.
                      </div>
                    ) : (
                      <div className="responsive-table-container">
                        <table className="premium-table">
                          <thead>
                            <tr>
                              <th>Judge Name</th>
                              <th>Courtroom / Bench</th>
                              <th>Virtual Courtroom Link</th>
                              <th>Court Secretary Email</th>
                            </tr>
                          </thead>
                          <tbody>
                            {hcData.judges
                              .filter(j => 
                                j.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                                j.room.toLowerCase().includes(searchQuery.toLowerCase())
                              )
                              .map((j, idx) => (
                                <tr key={idx}>
                                  <td><strong>{j.name}</strong></td>
                                  <td><span className="card-badge" style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: 'white' }}>{j.room}</span></td>
                                  <td>
                                    {j.vc.startsWith('http') ? (
                                      <>
                                        <a href={j.vc} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>
                                          {j.vc.length > 35 ? `${j.vc.slice(0, 35)}...` : j.vc}
                                        </a>
                                        <button className="copy-btn-link" onClick={() => handleCopy(j.vc)}>Copy</button>
                                        <div style={{ fontSize: '11px', color: 'var(--text-dark-muted)', marginTop: '4px' }}>Meet ID: {j.meetId}</div>
                                      </>
                                    ) : (
                                      <span style={{ color: 'var(--text-dark-muted)', fontStyle: 'italic' }}>{j.vc}</span>
                                    )}
                                  </td>
                                  <td style={{ fontSize: '12.5px', color: 'var(--text-dark-muted)' }}>{j.email || '—'}</td>
                                </tr>
                              ))
                            }
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ────────── TAB 3: DISTRICT COURTS ────────── */}
        {activeTab === 'district' && (
          <div className="resource-panel">
            <div className="panel-header">
              <h2>District Courts Database</h2>
              <p>Locate case statuses, rosters, and order portals for local subordinate courts.</p>
            </div>

            <div className="control-row">
              <div className="input-group">
                <label className="input-label">Select State</label>
                <select className="select-element" value={selectedDistState} onChange={(e) => { setSelectedDistState(e.target.value); setSelectedDistrict(''); setDistSubTab('overview'); }}>
                  <option value="">Select State</option>
                  {Object.keys(districtsDb).sort().map(st => (
                    <option key={st} value={st}>{stateLabelMap[st] || st}</option>
                  ))}
                </select>
              </div>

              <div className="input-group">
                <label className="input-label">Select District Court</label>
                <select 
                  className="select-element" 
                  value={selectedDistrict} 
                  onChange={(e) => setSelectedDistrict(e.target.value)}
                  disabled={!selectedDistState}
                  style={{ opacity: selectedDistState ? 1 : 0.6, cursor: selectedDistState ? 'pointer' : 'not-allowed' }}
                >
                  <option value="">Select District</option>
                  {selectedDistState && (districtsDb[selectedDistState] || [])
                    .slice()
                    .sort((a,b) => a.name.localeCompare(b.name))
                    .map(d => (
                      <option key={d.name} value={d.name}>{d.name}</option>
                    ))
                  }
                </select>
              </div>
            </div>

            {selectedDistrict ? (() => {
              const distUrl = (districtsDb[selectedDistState] || []).find(d => d.name === selectedDistrict)?.url || null;
              return (
              <div>
                <div style={{ padding: '14px 18px', background: 'var(--bg-dark-card)', borderRadius: '10px', border: '1px solid var(--border-dark-subtle)', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ fontSize: '16px', color: 'white', marginBottom: '2px' }}>{selectedDistrict}</h3>
                    <span style={{ fontSize: '12px', color: 'var(--text-dark-muted)' }}>Subordinate Court System</span>
                  </div>
                  {distUrl ? (
                    <a
                      href={distUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-accent"
                      style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      🏛️ Open Official Site ↗
                    </a>
                  ) : (
                    <button
                      className="btn-accent"
                      disabled
                      style={{ opacity: 0.45, cursor: 'not-allowed', pointerEvents: 'none' }}
                    >
                      🏛️ Site Not Available
                    </button>
                  )}
                </div>

              </div>
            );
          })() : (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dark-muted)', fontStyle: 'italic', border: '1px dashed var(--border-dark-subtle)', borderRadius: '8px' }}>
                Please select a State and a Subordinate District Court above to display court services.
              </div>
            )}
          </div>
        )}

        {/* ────────── TAB 4: BARE ACTS ────────── */}
        {activeTab === 'laws' && (
          <div className="resource-panel">
            <div className="panel-header">
              <h2>Bare Acts Reference</h2>
              <p>Reference list of major Indian codifications linking directly to Indian Kanoon libraries.</p>
            </div>

            <div style={{ marginBottom: '18px' }}>
              <input
                type="text"
                placeholder="Search Acts by title (e.g. Contract Act, BNS)..."
                className="search-input-field"
                style={{ width: '100%', maxWidth: '400px' }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
              {BARE_ACTS
                .filter(act => act.name.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((act, index) => (
                  <a
                    key={index}
                    href={act.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ textDecoration: 'none' }}
                  >
                    <div className="premium-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px' }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '8px' }}>
                        <span style={{ color: 'white', fontWeight: '500', fontSize: '13.5px' }}>📖 {act.name}</span>
                      </div>
                      <span style={{ fontSize: '11px', color: 'var(--accent-primary)', fontWeight: '600', flexShrink: 0 }}>Read ↗</span>
                    </div>
                  </a>
                ))
              }
            </div>
          </div>
        )}

        {/* ────────── TAB 5: LEGAL FORMS ────────── */}
        {activeTab === 'forms' && (
          <div className="resource-panel">
            <div className="panel-header">
              <h2>Standard Legal Forms &amp; Templates</h2>
              <p>Official court forms, vakalatnamas, bail bonds, and checklists — sourced directly from court websites. Click to open the official portal and download.</p>
            </div>

            {/* Court filter pills */}
            <div className="control-row" style={{ marginBottom: '14px' }}>
              <div className="sub-tabs-wrapper" style={{ borderBottom: 'none', marginBottom: 0, flexWrap: 'wrap', gap: '6px' }}>
                {['All', 'Supreme Court', 'Delhi HC', 'Bombay HC', 'Madras HC', 'Karnataka HC', 'District Courts', 'Central Govt', 'NALSA'].map(court => (
                  <button
                    key={court}
                    className={`sub-tab-btn ${activeCourtFilter === court ? 'active' : ''}`}
                    onClick={() => setActiveCourtFilter(court)}
                  >
                    {court}
                  </button>
                ))}
              </div>
            </div>

            {/* Search bar */}
            <div style={{ marginBottom: '18px' }}>
              <input
                type="text"
                placeholder="Search forms (e.g. Vakalatnama, Bail, Writ)..."
                className="search-input-field"
                style={{ width: '100%', maxWidth: '420px' }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Info banner */}
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '10px',
              padding: '10px 14px', marginBottom: '16px',
              background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
              borderRadius: '8px', fontSize: '12px', color: 'var(--text-dark-muted)',
            }}>
              <span style={{ fontSize: '14px', flexShrink: 0 }}>ℹ️</span>
              <span>
                <strong style={{ color: 'var(--text-dark-primary)' }}>📄 View Document</strong> — fetches the PDF internally and renders it inside LexAmplify — you never leave the dashboard.&nbsp;&nbsp;
                <strong style={{ color: 'var(--text-dark-primary)' }}>🌐 Open Portal</strong> — no direct PDF path available; opens the official court forms page in a new tab.
              </span>
            </div>

            <div className="responsive-table-container">
              {loadingHC ? (
                <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-dark-muted)' }}>Loading form templates...</div>
              ) : (() => {
                const filtered = hcData.forms.filter(f => {
                  const matchText = f.name.toLowerCase().includes(searchQuery.toLowerCase());
                  const matchCourt = activeCourtFilter === 'All' || f.court === activeCourtFilter;
                  return matchText && matchCourt;
                });
                return (
                  <table className="premium-table">
                    <thead>
                      <tr>
                        <th>Form / Template Name</th>
                        <th>Court</th>
                        <th>Category</th>
                        <th style={{ width: '160px', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr>
                          <td colSpan={4} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-dark-muted)' }}>
                            No forms match your filters.
                          </td>
                        </tr>
                      ) : filtered.map((form, idx) => (
                        <tr key={idx}>
                          <td><strong>📋 {form.name}</strong></td>
                          <td>
                            <span className="card-badge" style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: 'var(--text-dark-muted)', fontSize: '11px' }}>
                              {form.court || 'General'}
                            </span>
                          </td>
                          <td>
                            <span className="card-badge" style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: 'white' }}>{form.cat}</span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="btn-accent"
                              style={{ fontSize: '11px', padding: '4px 10px' }}
                              onClick={() => openFormInModal(form)}
                            >
                              {(form.url_type === 'pdf' || form.url_type === 'dynamic_pdf') ? '📄 View Document' : '🌐 Open Portal'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
        )}

        {/* ────────── TAB 6: LEGAL EVENTS ────────── */}
        {activeTab === 'events' && (
          <div className="resource-panel">
            <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2>Live Legal Feed</h2>
                <p>Real-time legal news, SC orders, conference notices, and bar updates — aggregated from LiveLaw &amp; Bar &amp; Bench.</p>
              </div>
              <button
                className="btn-accent"
                style={{ fontSize: '11px', padding: '5px 12px', flexShrink: 0, marginTop: '4px' }}
                onClick={() => fetchLiveEvents(true)}
                disabled={loadingEvents}
              >
                {loadingEvents ? '…' : '↺ Refresh'}
              </button>
            </div>

            {/* Filter pills */}
            <div className="control-row">
              <div className="sub-tabs-wrapper" style={{ borderBottom: 'none', marginBottom: 0 }}>
                {[
                  { key: 'all',        label: 'All' },
                  { key: 'judgment',   label: '⚖️ Judgments' },
                  { key: 'conference', label: '🎤 Conferences' },
                  { key: 'webinar',    label: '💻 Webinars' },
                  { key: 'media',      label: '📢 Press' },
                  { key: 'news',       label: '📰 News' },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    className={`sub-tab-btn ${eventsFilter === key ? 'active' : ''}`}
                    onClick={() => setEventsFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Loading skeleton */}
            {loadingEvents && (
              <div className="events-skeleton-grid">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="events-skeleton-card">
                    <div className="skel-line" style={{ height: '10px', width: '40%' }} />
                    <div className="skel-line" style={{ height: '14px', width: '90%' }} />
                    <div className="skel-line" style={{ height: '14px', width: '75%' }} />
                    <div className="skel-line" style={{ height: '11px', width: '60%', marginTop: '4px' }} />
                    <div className="skel-line" style={{ height: '11px', width: '80%' }} />
                    <div className="skel-line" style={{ height: '30px', width: '100%', marginTop: '8px', borderRadius: '7px' }} />
                  </div>
                ))}
              </div>
            )}

            {/* Error state */}
            {!loadingEvents && eventsError && (
              <div className="events-error-state">
                <span style={{ fontSize: '32px' }}>📡</span>
                <div>
                  <p style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '6px', fontWeight: '600' }}>Live feed unavailable</p>
                  <p style={{ fontSize: '12px', color: '#475569' }}>{eventsError}</p>
                </div>
                <button className="btn-accent" style={{ fontSize: '12px', padding: '7px 16px' }} onClick={() => fetchLiveEvents(true)}>
                  ↺ Retry Feed
                </button>
              </div>
            )}

            {/* Live event cards */}
            {!loadingEvents && !eventsError && (() => {
              const filtered = liveEvents.filter(e =>
                eventsFilter === 'all' ? true : e.category === eventsFilter
              );
              if (filtered.length === 0) return (
                <div className="events-error-state">
                  <span style={{ fontSize: '28px' }}>🔍</span>
                  <p style={{ fontSize: '13px', color: '#475569' }}>No {eventsFilter} items in the current feed.</p>
                </div>
              );
              return (
                <div className="grid-container">
                  {filtered.map(event => (
                    <div key={event.id} className="premium-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div>
                        <div className="card-top" style={{ marginBottom: '8px' }}>
                          <span className="card-badge" style={{ textTransform: 'capitalize' }}>{event.category}</span>
                          <span className="events-source-pill">{event.source}</span>
                          <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)', marginLeft: 'auto' }}>📅 {event.date}</span>
                        </div>
                        <h3 className="card-h3" style={{ fontSize: '13.5px', lineHeight: '1.45', marginBottom: '8px' }}>{event.title}</h3>
                        {event.description && (
                          <p className="card-desc" style={{ marginBottom: '14px', fontSize: '12px', lineHeight: '1.5' }}>{event.description}</p>
                        )}
                      </div>
                      <a
                        href={event.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-accent"
                        style={{ fontSize: '11px', padding: '6px 10px', textDecoration: 'none', textAlign: 'center', display: 'block' }}
                      >
                        Read Article ↗
                      </a>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* ────────── TAB 7: FEE CALCULATOR ────────── */}
        {activeTab === 'courtfee' && (
          <div className="resource-panel">
            <div className="panel-header">
              <h2>Court Fee Calculator</h2>
              <p>Compute standardized court fees for civil suits, family disputes, and petition filings.</p>
            </div>

            <form onSubmit={handleCalculateFee} style={{ maxWidth: '500px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '20px' }}>
                <div className="input-group">
                  <label className="input-label">Disputed Claim Valuation (Amount in ₹)</label>
                  <input
                    type="number"
                    placeholder="e.g. 500000"
                    className="search-input-field"
                    value={feeAmount}
                    onChange={(e) => setFeeAmount(e.target.value)}
                    required
                    min="0"
                  />
                </div>
                <div className="input-group">
                  <label className="input-label">Jurisdiction / Suit Type</label>
                  <select className="select-element" value={feeCourt} onChange={(e) => setFeeCourt(e.target.value)}>
                    <option value="delhi_hc">Delhi HC - Commercial Suit</option>
                    <option value="bombay_hc">Bombay HC - Original Side Civil Suit</option>
                    <option value="madras_hc">Madras HC - Civil Suit</option>
                    <option value="sc_filing">Supreme Court - Special Leave Petition (SLP)</option>
                  </select>
                </div>
                <button type="submit" className="btn-accent" style={{ alignSelf: 'flex-start', padding: '10px 20px' }} disabled={calculatingFee}>
                  {calculatingFee ? 'Calculating...' : '⚡ Calculate Fee'}
                </button>
              </div>
            </form>

            {calculatedFee !== null && (
              <div style={{ marginTop: '24px', padding: '20px', backgroundColor: 'var(--bg-dark-card)', border: '1px solid var(--border-dark-subtle)', borderRadius: '8px' }}>
                <h4 style={{ fontSize: '13px', color: 'var(--text-dark-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>Estimated Filing Stamp Duty</h4>
                <div style={{ fontSize: '28px', color: 'white', fontWeight: 'bold', fontFamily: 'var(--font-serif)', marginBottom: '8px' }}>
                  {typeof calculatedFee === 'number' ? `₹ ${calculatedFee.toLocaleString('en-IN')}` : calculatedFee}
                </div>
                <p style={{ fontSize: '13px', color: 'var(--text-dark-muted)', lineHeight: '1.4' }}>{feeNote}</p>
              </div>
            )}
          </div>
        )}

        {/* ────────── TAB 8: e-NOTARY ────────── */}
        {activeTab === 'enotary' && (
          <div className="resource-panel">
            <div className="panel-header">
              <h2>Digital Document Notarisation</h2>
              <p>Execute electronically signed contracts, deeds, and statutory declarations under IT Act, 2000 Section 5.</p>
            </div>

            <div className="grid-container" style={{ marginBottom: '28px' }}>
              <div className="premium-card" onClick={() => window.open('https://www.nesl.co.in', '_blank')}>
                <div className="card-top">
                  <span className="card-badge">Stamping &amp; e-Sign</span>
                  <span style={{ fontSize: '18px' }}>🏦</span>
                </div>
                <h3 className="card-h3">NeSL (National e-Governance Services)</h3>
                <p className="card-desc">Government-backed infrastructure offering biometric Aadhaar OTP validation. Recognized by NCLT, DRT, and SEBI.</p>
                <div className="card-action-text">nesl.co.in ↗</div>
              </div>

              <div className="premium-card" onClick={() => window.open('https://www.leegality.com', '_blank')}>
                <div className="card-top">
                  <span className="card-badge">Commercial</span>
                  <span style={{ fontSize: '18px' }}>✍️</span>
                </div>
                <h3 className="card-h3">Leegality</h3>
                <p className="card-desc">Leading e-Sign deployment gateway. Simplifies high-volume Aadhaar eSign contracts and biometric security compliance.</p>
                <div className="card-action-text">leegality.com ↗</div>
              </div>

              <div className="premium-card" onClick={() => window.open('https://www.signdesk.com', '_blank')}>
                <div className="card-top">
                  <span className="card-badge">Stamping</span>
                  <span style={{ fontSize: '18px' }}>📝</span>
                </div>
                <h3 className="card-h3">SignDesk</h3>
                <p className="card-desc">End-to-end digital stamping (e-stamping), certificate generation, and MCA-CCA audit logs.</p>
                <div className="card-action-text">signdesk.com ↗</div>
              </div>

              <div className="premium-card" onClick={() => window.open('https://www.digio.in', '_blank')}>
                <div className="card-top">
                  <span className="card-badge">KYC Gateway</span>
                  <span style={{ fontSize: '18px' }}>🔐</span>
                </div>
                <h3 className="card-h3">Digio</h3>
                <p className="card-desc">Integrated signature authorization gateway. Extensively used in corporate financing and banking sectors.</p>
                <div className="card-action-text">digio.in ↗</div>
              </div>
            </div>

            <div className="panel-header" style={{ marginBottom: '14px' }}>
              <h2 style={{ fontSize: '16px' }}>Statutory Framework</h2>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px' }}>
              <div className="premium-card" style={{ padding: '14px 18px' }} onClick={() => openInAppBrowser('https://www.meity.gov.in/content/information-technology-act')}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ color: 'white', fontWeight: '500', fontSize: '13px' }}>IT Act, 2000 — Sections 3–5</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-dark-muted)', marginTop: '2px' }}>Electronic Records &amp; Signatures validity</div>
                  </div>
                  <span style={{ color: 'var(--accent-primary)', fontSize: '16px' }}>↗</span>
                </div>
              </div>
              <div className="premium-card" style={{ padding: '14px 18px' }} onClick={() => openInAppBrowser('https://www.cca.gov.in')}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ color: 'white', fontWeight: '500', fontSize: '13px' }}>Controller of Certifying Authorities (CCA)</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-dark-muted)', marginTop: '2px' }}>Licensing agency for DSC providers</div>
                  </div>
                  <span style={{ color: 'var(--accent-primary)', fontSize: '16px' }}>↗</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ────────── TAB 9: IP TRACKER ────────── */}
        {activeTab === 'iptracker' && (
          <div className="resource-panel">
            <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h2>Intellectual Property (IP) Asset Tracker</h2>
                <p>Monitor clients' trademark, patent, and copyright applications with automated renewal Alerts.</p>
              </div>
              <button className="btn-accent" onClick={() => openIPModalForm('add')}>
                ➕ Add IP Asset
              </button>
            </div>

            {loadingIP ? (
              <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-dark-muted)', fontStyle: 'italic' }}>Loading IP portfolio...</div>
            ) : ipAssets.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dark-muted)', border: '1px dashed var(--border-dark-subtle)', borderRadius: '8px' }}>
                No assets tracked yet. Click "Add IP Asset" to seed client trademarks, patents, and copyright renewal filings.
              </div>
            ) : (
              <div className="responsive-table-container">
                <table className="premium-table">
                  <thead>
                    <tr>
                      <th>IP Type</th>
                      <th>Title / Description</th>
                      <th>Registration / Application</th>
                      <th>Filing Date</th>
                      <th>Renewal Due Date</th>
                      <th>Status</th>
                      <th style={{ width: '100px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ipAssets.map((asset) => {
                      // Renewal status calculations
                      let renewalDisplay = formatIPDate(asset.renewal_due);
                      let alertColor = 'inherit';
                      if (asset.renewal_due) {
                        const today = new Date(); today.setHours(0,0,0,0);
                        const days = Math.round((new Date(asset.renewal_due + 'T00:00:00') - today) / 86400000);
                        if (days < 0) {
                          renewalDisplay = `${formatIPDate(asset.renewal_due)} ⚠️ OVERDUE`;
                          alertColor = 'var(--accent-danger)';
                        } else if (days <= 30) {
                          renewalDisplay = `${formatIPDate(asset.renewal_due)} ⚠️ ${days} days`;
                          alertColor = 'var(--accent-warning)';
                        }
                      }

                      // Badge styles
                      const statusColorsMap = {
                        Active: { bg: 'rgba(16, 185, 129, 0.15)', text: 'var(--accent-success)', border: 'rgba(16, 185, 129, 0.3)' },
                        Pending: { bg: 'rgba(245, 158, 11, 0.12)', text: 'var(--accent-warning)', border: 'rgba(245, 158, 11, 0.25)' },
                        Expired: { bg: 'rgba(239, 68, 68, 0.12)', text: 'var(--accent-danger)', border: 'rgba(239, 68, 68, 0.25)' },
                        Opposed: { bg: 'rgba(59, 130, 246, 0.12)', text: 'var(--accent-primary)', border: 'rgba(59, 130, 246, 0.25)' }
                      };
                      const statusColors = statusColorsMap[asset.status] || { bg: 'rgba(255,255,255,0.05)', text: 'var(--text-dark-muted)', border: 'rgba(255,255,255,0.1)' };

                      return (
                        <tr key={asset.id}>
                          <td><strong>{asset.ip_type}</strong></td>
                          <td>
                            <strong>{asset.title}</strong>
                            {asset.notes && (
                              <div style={{ fontSize: '11px', color: 'var(--text-dark-muted)', marginTop: '2px' }}>{asset.notes}</div>
                            )}
                          </td>
                          <td><code>{asset.registration_number || '—'}</code></td>
                          <td>{formatIPDate(asset.filing_date)}</td>
                          <td style={{ color: alertColor, fontWeight: alertColor !== 'inherit' ? 'bold' : 'normal' }}>
                            {renewalDisplay}
                          </td>
                          <td>
                            <span 
                              className="card-badge" 
                              style={{ 
                                backgroundColor: statusColors.bg, 
                                color: statusColors.text, 
                                border: `1px solid ${statusColors.border}`,
                                borderRadius: '20px',
                                padding: '3px 10px'
                              }}
                            >
                              {asset.status}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                              <button 
                                className="btn-accent" 
                                style={{ fontSize: '11px', padding: '5px 10px', background: 'transparent', border: '1px solid var(--border-dark-subtle)', color: 'white' }}
                                onClick={() => openIPModalForm('edit', asset)}
                              >
                                ✏️
                              </button>
                              <button 
                                className="btn-accent" 
                                style={{ fontSize: '11px', padding: '5px 10px', background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--accent-danger)' }}
                                onClick={() => deleteIPAssetItem(asset.id, asset.title)}
                              >
                                🗑️
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </div>

      {/* ── GLOBAL EVENT MODAL ── */}
      {selectedEventId && eventModalData && (
        <div className="modal-overlay" onClick={closeEventModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="card-badge" style={{ textTransform: 'capitalize', marginBottom: '8px', display: 'inline-block' }}>{eventModalData.type}</span>
                <h2 style={{ fontSize: '18px', color: 'white', fontFamily: 'var(--font-serif)' }}>{eventModalData.title}</h2>
              </div>
              <button 
                onClick={closeEventModal}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-dark-muted)', fontSize: '20px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {eventModalStatus === 'loading' && (
                <div>
                  <div className="skeleton-line" style={{ width: '80%' }}></div>
                  <div className="skeleton-line" style={{ width: '60%' }}></div>
                  <div className="skeleton-line" style={{ width: '100%', height: '80px', marginTop: '20px' }}></div>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-dark-muted)', marginTop: '8px', fontStyle: 'italic' }}>
                    Parsing government event nodes dynamically...
                  </div>
                </div>
              )}

              {eventModalStatus === 'error' && (
                <div style={{ padding: '16px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '24px', marginBottom: '8px' }}>⚠️</div>
                  <h4 style={{ color: 'white', marginBottom: '6px' }}>Network Parsing Error</h4>
                  <p style={{ fontSize: '12.5px', color: 'var(--text-dark-muted)', marginBottom: '14px' }}>{eventModalError}</p>
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                    <button 
                      className="btn-accent" 
                      style={{ fontSize: '12px' }}
                      onClick={() => openEventModal(selectedEventId, eventModalData.title, eventModalData.source_url, eventModalData.type, eventModalData.event_date)}
                    >
                      Retry Parse
                    </button>
                    {eventModalData.source_url && (
                      <button 
                        className="btn-accent" 
                        style={{ fontSize: '12px', background: 'transparent', border: '1px solid var(--border-dark-subtle)', color: 'white' }}
                        onClick={() => { closeEventModal(); openDirectLink(eventModalData.source_url); }}
                      >
                        Open Official Page
                      </button>
                    )}
                  </div>
                </div>
              )}

              {eventModalStatus === 'content' && (
                <div>
                  <div className="modal-meta-row">
                    <span className="modal-meta-label">📅 Date</span>
                    <span className="modal-meta-value">{eventModalData.event_date}</span>
                  </div>
                  {eventModalData.venue && (
                    <div className="modal-meta-row">
                      <span className="modal-meta-label">📍 Venue</span>
                      <span className="modal-meta-value">{eventModalData.venue}</span>
                    </div>
                  )}
                  {eventModalData.organizer && (
                    <div className="modal-meta-row">
                      <span className="modal-meta-label">🏛️ Organiser</span>
                      <span className="modal-meta-value">{eventModalData.organizer}</span>
                    </div>
                  )}

                  <hr style={{ border: 'none', borderBottom: '1px solid var(--border-dark-subtle)', margin: '16px 0' }} />

                  <p style={{ fontSize: '13.5px', lineHeight: '1.6', color: 'var(--text-dark-muted)', whiteSpace: 'pre-line' }}>
                    {eventModalData.description || 'No detailed descriptive parsed payload from the event board.'}
                  </p>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button 
                className="btn-accent" 
                style={{ background: 'transparent', border: '1px solid var(--border-dark-subtle)', color: 'white' }} 
                onClick={closeEventModal}
              >
                Close Window
              </button>
              {eventModalStatus === 'content' && eventModalData.register_url && (
                <button 
                  className="btn-accent"
                  onClick={() => { closeEventModal(); openDirectLink(eventModalData.register_url); }}
                >
                  📝 Register / RSVP ↗
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── IP TRACKER CREATION/EDIT MODAL ── */}
      {ipModal.isOpen && (
        <div className="modal-overlay" onClick={() => setIpModal(prev => ({ ...prev, isOpen: false }))}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={saveIPAssetItem}>
              <div className="modal-header">
                <h2 style={{ fontSize: '18px', color: 'white', fontFamily: 'var(--font-serif)' }}>
                  {ipModal.mode === 'edit' ? 'Edit Tracked IP Asset' : 'Track New IP Asset'}
                </h2>
                <button 
                  type="button"
                  onClick={() => setIpModal(prev => ({ ...prev, isOpen: false }))}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-dark-muted)', fontSize: '20px', cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>

              <div className="modal-body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div className="input-group">
                    <label className="input-label">Asset Type *</label>
                    <select 
                      className="select-element"
                      value={ipModal.ip_type}
                      onChange={(e) => setIpModal(prev => ({ ...prev, ip_type: e.target.value }))}
                    >
                      <option>Trademark</option>
                      <option>Patent</option>
                      <option>Copyright</option>
                      <option>Design</option>
                      <option>Geographical Indication</option>
                    </select>
                  </div>
                  <div className="input-group">
                    <label className="input-label">Status</label>
                    <select 
                      className="select-element"
                      value={ipModal.status}
                      onChange={(e) => setIpModal(prev => ({ ...prev, status: e.target.value }))}
                    >
                      <option>Active</option>
                      <option>Pending</option>
                      <option>Expired</option>
                      <option>Opposed</option>
                    </select>
                  </div>
                </div>

                <div className="input-group" style={{ marginBottom: '16px' }}>
                  <label className="input-label">Title / Trademark Text / Patent Description *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. LexAmplify Word Mark (Class 42)"
                    className="search-input-field"
                    value={ipModal.title}
                    onChange={(e) => setIpModal(prev => ({ ...prev, title: e.target.value }))}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                  <div className="input-group">
                    <label className="input-label">Reg. / App. No.</label>
                    <input
                      type="text"
                      placeholder="e.g. 5812903"
                      className="search-input-field"
                      value={ipModal.registration_number}
                      onChange={(e) => setIpModal(prev => ({ ...prev, registration_number: e.target.value }))}
                    />
                  </div>
                  <div className="input-group">
                    <label className="input-label">Filing Date</label>
                    <input
                      type="date"
                      className="search-input-field"
                      value={ipModal.filing_date}
                      onChange={(e) => setIpModal(prev => ({ ...prev, filing_date: e.target.value }))}
                    />
                  </div>
                  <div className="input-group">
                    <label className="input-label">Renewal Due</label>
                    <input
                      type="date"
                      className="search-input-field"
                      value={ipModal.renewal_due}
                      onChange={(e) => setIpModal(prev => ({ ...prev, renewal_due: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="input-group">
                  <label className="input-label">Advocate Notes / Client Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Client: Tech Corp. Opposed by competitor on 12.04.2026."
                    className="search-input-field"
                    value={ipModal.notes}
                    onChange={(e) => setIpModal(prev => ({ ...prev, notes: e.target.value }))}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button 
                  type="button"
                  className="btn-accent" 
                  style={{ background: 'transparent', border: '1px solid var(--border-dark-subtle)', color: 'white' }} 
                  onClick={() => setIpModal(prev => ({ ...prev, isOpen: false }))}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-accent">
                  💾 Save Asset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── TOAST NOTIFICATION BANNER ── */}
      {toastMessage && (
        <div className="toast-banner">
          <span>✅</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ── PDF VIEWER MODAL ── */}
      {pdfModal.open && (
        <div className="pdf-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closePdfModal(); }}>
          <div className="pdf-modal-container">
            <div className="pdf-modal-header">
              <span className="pdf-modal-title">📄 {pdfModal.title}</span>
              <div className="pdf-modal-actions">
                {!pdfModal.loading && !pdfModal.error && pdfModal.blobUrl && (
                  <a
                    href={pdfModal.fallbackUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-accent"
                    style={{ fontSize: '11px', padding: '4px 10px', textDecoration: 'none' }}
                  >
                    ↓ Download
                  </a>
                )}
                <button className="pdf-modal-close" onClick={closePdfModal} title="Close">✕</button>
              </div>
            </div>

            <div className="pdf-modal-body">
              {pdfModal.loading && (
                <div className="pdf-modal-state">
                  <div className="pdf-modal-spinner" />
                  <span>
                    {pdfModal.isScraping
                      ? 'Scraping SCI forms index → extracting PDF link → fetching binary…'
                      : 'Fetching document from court server…'}
                  </span>
                </div>
              )}
              {pdfModal.error && (
                <div className="pdf-modal-state">
                  <span style={{ fontSize: '28px' }}>⚠️</span>
                  <span style={{ color: '#94A3B8', textAlign: 'center', maxWidth: '340px', lineHeight: '1.5' }}>
                    The government server blocked the fetch (bot-protection or temporary unavailability).
                  </span>
                  <a
                    href={pdfModal.fallbackUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-accent"
                    style={{ fontSize: '12px', padding: '7px 14px', textDecoration: 'none', marginTop: '4px' }}
                  >
                    🌐 Open on Court Website ↗
                  </a>
                </div>
              )}
              {!pdfModal.loading && !pdfModal.error && pdfModal.blobUrl && (
                <iframe
                  className="pdf-modal-iframe"
                  src={pdfModal.blobUrl}
                  title={pdfModal.title}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
