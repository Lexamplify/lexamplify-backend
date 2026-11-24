const nav = (to, title, desc) => ({ target: `[data-tour="nav-${to}"]`, title, content: desc, skipBeacon: true, placement: 'right' });

const STEPS = {
  onboarding: [
    {
      target: '.rail__brand',
      title: 'Welcome to Your Chambers!',
      content: 'This is your law chamber on LexAmplify. Everything you need to manage your legal practice is organized in this sidebar. Let\'s walk through each section so you know exactly where to find things.',
      skipBeacon: true,
      placement: 'right',
    },
    {
      target: '[data-tour="chamber-edit"]',
      title: 'Edit Your Chamber Name',
      content: 'Click this pencil icon anytime to change your chamber name. It appears on all auto-generated documents, letterheads, and your team\'s sidebar. Use your official name as registered with the Bar Council.',
      skipBeacon: true,
      placement: 'bottom',
      spotlightClicks: true,
    },
    {
      target: '[data-tour="workspace-switcher"]',
      title: 'Client Workspace Switcher',
      content: 'This is your client switcher. Each client gets their own workspace — their matters, documents, and AI-generated drafts are completely separate. Click the dropdown to switch between clients, add new ones, or manage existing ones. Think of it like separate filing cabinets for each client.',
      skipBeacon: true,
      placement: 'bottom',
      spotlightClicks: true,
    },
    nav('start', 'Start Page', 'Your home base. See today\'s hearings, this week\'s schedule, active drafts, and open matters at a glance. Use the AI command bar at the top to quickly draft documents or ask legal questions.'),
    nav('matters', 'Matters (Cases)', 'All your cases and legal engagements live here. Each matter belongs to a client workspace and tracks its own hearings, documents, deadlines, and complete case history. Create new matters, filter by type, and click into any matter for full details.'),
    nav('dashboard', 'Dashboard', 'A quick overview of your practice — active matters, upcoming hearings, approaching deadlines, and recent activity. Use this to stay on top of your daily workflow without checking each section individually.'),
    nav('contract-analyzer', 'Contract Analyzer', 'Upload any contract (PDF or Word) and get AI-powered clause-by-clause analysis. The AI checks against your general and master checklists, flags risky clauses, identifies missing provisions, and highlights key dates. You can customize checklists from Settings.'),
    nav('auto-draft', 'Auto-Draft Studio', 'Generate legal documents from a simple prompt. Tell the AI what you need — a legal notice, reply, petition, or any document — and it drafts it using facts from your current workspace. The AI asks clarifying questions for anything it\'s unsure about and never guesses. Download as Word with your letterhead.'),
    nav('court-resources', 'Court Resources', 'Access court directories across India, check daily cause lists, and track your IP (Intellectual Property) assets with automatic renewal reminders. If you have trademarks, patents, or copyrights, register them here to get email alerts before they expire.'),
    nav('research', 'Legal Research', 'Search Indian legal databases with AI assistance. Ask legal questions and get answers that cite real case law and statutes. Every citation is labeled — the AI clearly marks what\'s verified from the database vs. what\'s from its general knowledge, so you always know what to trust.'),
    nav('calendar', 'Legal Calendar', 'Track all your hearings, filing deadlines, and appointments in one place. Hearings from your matters automatically appear here. Set reminders and the system sends email notifications so you never miss a date.'),
    nav('war-room', 'Virtual Courtroom', 'Prepare for hearings in a focused workspace. Organize your arguments, evidence, and case strategy. Great for complex matters where you need to lay out your entire case before walking into court.'),
    {
      target: '[data-tour="nav-practice"]',
      title: 'Practice Management',
      content: 'Manage your firm settings, team members, and practice operations. View your team, check audit logs, manage clients, and configure how your chamber operates on LexAmplify.',
      skipBeacon: true,
      placement: 'right',
    },
    {
      target: '[data-tour="settings-link"]',
      title: 'Settings & Configuration',
      content: 'Your chamber\'s control panel. From here you can: manage your profile and billing, configure email notifications, customize contract analysis checklists, set up security (IP allowlists & MFA), manage team permissions, and personalize the look of your chamber. Explore this when you\'re ready to fine-tune your setup.',
      skipBeacon: true,
      placement: 'right',
    },
  ],

  sidebar: [
    { target: '.rail__brand', title: 'Your Law Chamber', content: 'This is your chamber identity. The sidebar gives you quick access to every feature. You can collapse it using the arrow icon to get more screen space.', skipBeacon: true, placement: 'right' },
    { target: '[data-tour="workspace-switcher"]', title: 'Client Switcher', content: 'Switch between your clients here. Each client is a separate workspace — their matters, documents, and drafts stay isolated. Click to see all clients, search, add new ones, or manage existing ones.', skipBeacon: true, placement: 'bottom' },
  ],

  matters: [
    nav('matters', 'Matters', 'Manage all your cases and matters here. Each matter belongs to a client workspace and tracks hearings, documents, deadlines, and full case history.'),
    nav('dashboard', 'Dashboard', 'A quick overview of your active matters, upcoming hearings, and deadlines across all your cases.'),
  ],

  contracts: [
    nav('contract-analyzer', 'Contract Analyzer', 'Upload any contract (PDF/Word) and get AI-powered clause-by-clause analysis using your general and master checklists. Flags risky clauses and missing provisions.'),
  ],

  autodraft: [
    nav('auto-draft', 'Auto-Draft Studio', 'Generate legal documents from a prompt. The AI uses facts from your current workspace, asks for what it doesn\'t know, and produces Word documents with your letterhead.'),
  ],

  litigation: [
    nav('court-resources', 'Court Resources', 'Court directories, daily cause lists, and IP asset tracking with automatic renewal reminders.'),
    nav('research', 'Legal Research', 'Search Indian legal databases with AI. Every citation is labeled — verified from database vs. general knowledge.'),
    nav('calendar', 'Legal Calendar', 'Track hearings, filing deadlines, and appointments. Automatic email reminders keep you on schedule.'),
    nav('war-room', 'Virtual Courtroom', 'Prepare for hearings — organize arguments, evidence, and case strategy in one focused workspace.'),
  ],

  vault: [
    nav('practice', 'Practice', 'Your firm settings, team management, and practice operations hub.'),
    nav('vault', 'Case Vault', 'Secure document storage organized by case. Upload, tag, and share documents with your team.'),
    nav('document-hub', 'Document Hub', 'Collaborative document editing with version history and team access controls.'),
    nav('conflict-engine', 'Conflict Engine', 'Check for conflicts of interest before taking on new matters or clients.'),
    nav('firm-library', 'Firm Library', 'Your firm\'s shared templates, precedents, and knowledge base for the whole team.'),
    nav('legal-forms', 'Legal Forms', 'Standard legal forms and templates ready to fill and file directly.'),
  ],

  team: [
    { target: '[data-tour="settings-link"]', title: 'Team Management', content: 'Go to Settings to add junior advocates and office staff. Assign roles to control what each person can see and edit. You can also invite people who already have a LexAmplify account.', skipBeacon: true, placement: 'right' },
  ],

  settings: [
    { target: '[data-tour="settings-link"]', title: 'Settings', content: 'Configure your chamber: profile and billing, email notifications, contract checklists, security (IP allowlist & MFA), team permissions, and appearance. Everything to fine-tune your practice.', skipBeacon: true, placement: 'right' },
  ],
};

export const TOUR_SECTIONS = {
  full:        { label: 'Full Tutorial',      steps: STEPS.onboarding },
  onboarding:  { label: 'Getting Started',    steps: STEPS.onboarding },
  sidebar:     { label: 'Navigation',         steps: STEPS.sidebar },
  matters:     { label: 'Matters & Dashboard', steps: STEPS.matters },
  contracts:   { label: 'Contract Analyzer',  steps: STEPS.contracts },
  autodraft:   { label: 'Auto-Draft Studio',  steps: STEPS.autodraft },
  litigation:  { label: 'Litigation Tools',   steps: STEPS.litigation },
  vault:       { label: 'Practice & Vault',   steps: STEPS.vault },
  team:        { label: 'Team Management',    steps: STEPS.team },
  settings:    { label: 'Settings',           steps: STEPS.settings },
};

export default TOUR_SECTIONS;
