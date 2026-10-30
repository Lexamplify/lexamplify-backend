// Shared sample data for the template (no backend). Kept realistic so the
// screens read as a real legal workspace.

export const MATTERS = [
  {
    id: 'm-8842', title: 'Mehta Industries v. Union of India', parties: 'Mehta Industries Pvt. Ltd. v. Union of India',
    type: 'Writ · Taxation', court: 'Delhi High Court', bench: "Hon'ble Mr. Justice R. Banerjee", num: 'W.P.(C) 8842/2025',
    next: '22 Oct', nextFull: '22 October 2026 · 10:30 AM', status: 'Active', tone: 'ok', stage: 'Arguments', client: 'Mehta Industries Pvt. Ltd.',
    filed: '04 Aug 2025', value: '₹2.4 Cr', lead: 'Aarav Advocate',
    summary: 'Challenge to a demand notice under Section 148 of the Income Tax Act on grounds of limitation and change of opinion.',
  },
  {
    id: 'm-0231', title: 'Verma Estate — Succession', parties: 'In re: Estate of Late Sh. K. Verma',
    type: 'Probate', court: 'Saket District Court', bench: 'Sh. A. Gupta, ADJ', num: 'Prob. 231/2024',
    next: '24 Oct', nextFull: '24 October 2026 · 12:30 PM', status: 'Hearing soon', tone: 'warn', stage: 'Evidence', client: 'Verma Family',
    filed: '19 Nov 2024', value: '₹6.1 Cr', lead: 'Aarav Advocate',
    summary: 'Grant of probate for a registered will; objections filed by two legal heirs on testamentary capacity.',
  },
  {
    id: 'm-5521', title: 'Khanna Bail Application', parties: 'Rohit Khanna v. State (NCT of Delhi)',
    type: 'Criminal · 439 CrPC', court: 'Delhi High Court', bench: "Hon'ble Ms. Justice P. Nair", num: 'Bail Appln. 5521/2025',
    next: '29 Oct', nextFull: '29 October 2026 · 11:00 AM', status: 'Filed', tone: 'ok', stage: 'Listed', client: 'Rohit Khanna',
    filed: '12 Oct 2025', value: '—', lead: 'Aarav Advocate',
    summary: 'Regular bail under Section 439 CrPC in an alleged offence under Sections 420/468 IPC; accused in custody 41 days.',
  },
  {
    id: 'm-htp1', title: 'Horizon Tech — Master Services', parties: 'Horizon Tech Pvt. Ltd. (advisory)',
    type: 'Advisory · Corporate', court: 'Advisory', bench: '—', num: '—',
    next: '—', nextFull: '—', status: 'Drafting', tone: 'muted', stage: 'Review', client: 'Horizon Tech Pvt. Ltd.',
    filed: '02 Oct 2025', value: '₹80 L', lead: 'Aarav Advocate',
    summary: 'Negotiation and review of a Master Services Agreement with a downstream SaaS vendor; liability and IP under discussion.',
  },
  {
    id: 'm-cc12', title: 'Rao v. Sunrise Developers', parties: 'S. Rao v. Sunrise Developers Pvt. Ltd.',
    type: 'Consumer · RERA', court: 'NCDRC', bench: 'Presiding Member', num: 'C.C. 112/2025',
    next: '06 Nov', nextFull: '06 November 2026 · 02:00 PM', status: 'Active', tone: 'ok', stage: 'Final hearing', client: 'S. Rao',
    filed: '28 Mar 2025', value: '₹48 L', lead: 'Aarav Advocate',
    summary: 'Deficiency of service for delayed possession; claim for refund with interest and compensation.',
  },
  {
    id: 'm-ptf1', title: 'Patel Family Trust', parties: 'Patel Family Trust (advisory)',
    type: 'Advisory · Trusts', court: 'Advisory', bench: '—', num: '—',
    next: '—', nextFull: '—', status: 'Disposed', tone: 'muted', stage: 'Closed', client: 'Patel Family',
    filed: '11 Jan 2025', value: '₹3.2 Cr', lead: 'Aarav Advocate',
    summary: 'Settlement and registration of a private family trust deed; advisory concluded.',
  },
];

export const getMatter = (id) => MATTERS.find((m) => m.id === id) || MATTERS[0];

export const DOCUMENTS = [
  { id: 'd1', name: 'Writ Petition (final)', kind: 'Petition', updated: '2 days ago', size: '412 KB', by: 'Aarav Advocate', tag: 'Filed' },
  { id: 'd2', name: 'Annexure P-1 — Demand Notice', kind: 'Annexure', updated: '2 days ago', size: '88 KB', by: 'Aarav Advocate', tag: 'Filed' },
  { id: 'd3', name: 'Rejoinder to counter-affidavit', kind: 'Rejoinder', updated: '5 hours ago', size: '126 KB', by: 'Priya (Assoc.)', tag: 'Draft' },
  { id: 'd4', name: 'Synopsis & list of dates', kind: 'Synopsis', updated: '1 week ago', size: '64 KB', by: 'Aarav Advocate', tag: 'Filed' },
  { id: 'd5', name: 'Vakalatnama', kind: 'Filing', updated: '3 weeks ago', size: '22 KB', by: 'Clerk', tag: 'Filed' },
];

export const HEARINGS = [
  { date: '22 Oct 2026', title: 'Arguments on limitation', court: 'Court 12', outcome: 'Upcoming', tone: 'warn' },
  { date: '18 Sep 2026', title: 'Counter-affidavit filed by respondent', court: 'Court 12', outcome: 'Completed', tone: 'muted' },
  { date: '04 Aug 2026', title: 'Notice issued; interim stay granted', court: 'Court 12', outcome: 'Completed', tone: 'ok' },
];

export const TIMELINE = [
  { when: 'Today', text: 'AI drafted the rejoinder (12 authorities)', who: 'Lexamplify', tone: 'accent' },
  { when: '2 days ago', text: 'Writ petition finalised and e-filed', who: 'Aarav Advocate', tone: 'ok' },
  { when: '18 Sep', text: 'Respondent filed counter-affidavit', who: 'Registry', tone: 'muted' },
  { when: '04 Aug', text: 'Interim stay granted; matter admitted', who: 'Court', tone: 'ok' },
  { when: '04 Aug', text: 'Matter filed', who: 'Aarav Advocate', tone: 'muted' },
];

export const CONTRACTS = [
  { id: 'c1', name: 'Master Services Agreement', party: 'Horizon Tech Pvt. Ltd.', pages: 24, risk: 72, flags: 1, status: 'In review', tone: 'warn' },
  { id: 'c2', name: 'Mutual NDA', party: 'Acme Analytics', pages: 6, risk: 91, flags: 0, status: 'Clean', tone: 'ok' },
  { id: 'c3', name: 'Leave & Licence Agreement', party: 'Prime Estates', pages: 11, risk: 64, flags: 2, status: 'Needs attention', tone: 'risk' },
  { id: 'c4', name: 'Employment Agreement', party: 'In-house · Associate', pages: 9, risk: 88, flags: 0, status: 'Clean', tone: 'ok' },
];

export const NOTIFICATIONS = [
  { icon: 'gavel', title: 'Hearing tomorrow — Mehta Industries', meta: 'Delhi HC · Court 12 · 10:30 AM', time: '1h', unread: true, tone: 'warn' },
  { icon: 'clock', title: 'Limitation in 2 days — Verma Estate', meta: 'Written statement due', time: '3h', unread: true, tone: 'risk' },
  { icon: 'draft', title: 'Rejoinder draft ready for review', meta: 'Lexamplify finished a draft', time: '5h', unread: true, tone: 'accent' },
  { icon: 'contract', title: 'Contract review complete', meta: 'Master Services Agreement · 1 flag', time: '1d', unread: false, tone: 'muted' },
  { icon: 'check', title: 'Khanna bail application e-filed', meta: 'Filing confirmed by registry', time: '2d', unread: false, tone: 'ok' },
];
