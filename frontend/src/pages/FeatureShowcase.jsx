import { useEffect, useRef, useState } from 'react';

/*
 * FeatureShowcase — pinned-scroll "feature-story" section for the landing page.
 * The left column pins a device-mock pane; the right column scrolls through 14
 * features. As each feature's heading becomes active, the left pane swaps to a
 * custom mini-animation that visually represents what that feature actually
 * does inside the app. No external deps — CSS keyframes + inline SVG only.
 */

const FEATURES = [
  { k: 'today', n: '01', t: 'Today', s: 'Open your day in one calm screen. Hearings, pending actions, matters that need you — all in order.' },
  { k: 'matters', n: '02', t: 'Matters', s: 'Every case your firm handles — fully filed, searchable, with hearings, parties, notes and documents in one place.' },
  { k: 'contract', n: '03', t: 'Contract Analyzer', s: 'Upload a contract. The engine reads it, flags risky clauses, cross-checks it against your firm playbook.' },
  { k: 'research', n: '04', t: 'Research', s: 'Search inside Indian case law. Cite verified judgments. No hallucinations.' },
  { k: 'draft', n: '05', t: 'Auto-Draft Studio', s: 'From facts to a court-ready draft in minutes. Collaborative, AI-assisted, your signature at the end.' },
  { k: 'court', n: '06', t: 'Court Resources', s: 'Supreme Court, every High Court, District Courts — judges, rosters, bar councils, bare acts, cause lists.' },
  { k: 'calendar', n: '07', t: 'Legal Calendar', s: 'Hearings, filings, limitation — synced across every matter. Hover any date to see the day in full.' },
  { k: 'courtroom', n: '08', t: 'Virtual Courtroom', s: 'Rehearse the hearing. The bench presses back. Every citation is verified — no made-up cases.' },
  { k: 'practice', n: '09', t: 'Practice', s: 'Run the firm. Clients, team, roles, audit log. One screen, your whole chambers.' },
  { k: 'vault', n: '10', t: 'Case Vault', s: 'Every file in one cabinet. Folders, sharing one person at a time, the full PDF right here.' },
  { k: 'dochub', n: '11', t: 'Document Hub', s: 'Every file your firm has ever touched — read, searchable inside the pages, filed by type.' },
  { k: 'conflict', n: '12', t: 'Conflict Engine', s: 'Clear the parties before you take the matter. Spot contradictions across the papers before you sign.' },
  { k: 'library', n: '13', t: 'Firm Library', s: '112 Indian dispute templates. Your own precedents. External case law. Draft from any of them.' },
  { k: 'forms', n: '14', t: 'Legal Forms', s: 'Pick a template, paste the facts, let AI fill the fields. Export .docx. Save to your library.' },
];

export default function FeatureShowcase() {
  const [active, setActive] = useState(0);
  const rowRefs = useRef([]);

  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting && e.intersectionRatio > 0.5) {
          const idx = Number(e.target.getAttribute('data-i'));
          setActive(idx);
        }
      });
    }, { rootMargin: '-30% 0px -40% 0px', threshold: [0, 0.5, 1] });
    rowRefs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <section className="fshow" id="features">
      <div className="fshow__inner">
        <header className="fshow__head">
          <span className="ph__eyebrow">§ 02 · Fourteen tools, one practice</span>
          <h2 className="fshow__h">Every tool you need, in one chambers.</h2>
          <p className="fshow__sub">Scroll through what Lexamplify actually does for Indian advocates. Not promises — the real workspace, in miniature.</p>
        </header>

        <div className="fshow__grid">
          {/* Left: pinned device mock showing the active feature's animation */}
          <aside className="fshow__pin">
            <div className="fshow__device">
              <div className="fshow__chrome">
                <span /><span /><span />
                <div className="fshow__chrome-title">{FEATURES[active].n} · {FEATURES[active].t}</div>
              </div>
              <div className="fshow__scene">
                {FEATURES.map((f, i) => (
                  <div key={f.k} className={`fsc fsc--${f.k} ${active === i ? 'is-on' : ''}`} aria-hidden={active !== i}>
                    <FeatureAnim k={f.k} on={active === i} />
                  </div>
                ))}
              </div>
            </div>
          </aside>

          {/* Right: scrollable list of features */}
          <ol className="fshow__list">
            {FEATURES.map((f, i) => (
              <li
                key={f.k}
                data-i={i}
                ref={(el) => (rowRefs.current[i] = el)}
                className={`fshow__row ${active === i ? 'is-on' : ''}`}
              >
                <div className="fshow__num">{f.n}</div>
                <h3 className="fshow__t">{f.t}</h3>
                <p className="fshow__s">{f.s}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────
   Per-feature mini animations. Each component is pure SVG + CSS
   keyframes (triggered when `on` is true via the `is-on` class on
   the wrapping .fsc div). Deliberately small, deliberately on-brand.
   ──────────────────────────────────────────────────────────── */
function FeatureAnim({ k, on }) {
  switch (k) {
    case 'today':      return <TodayAnim />;
    case 'matters':    return <MattersAnim />;
    case 'contract':   return <ContractAnim />;
    case 'research':   return <ResearchAnim />;
    case 'draft':      return <DraftAnim />;
    case 'court':      return <CourtAnim />;
    case 'calendar':   return <CalendarAnim />;
    case 'courtroom':  return <CourtroomAnim />;
    case 'practice':   return <PracticeAnim />;
    case 'vault':      return <VaultAnim />;
    case 'dochub':     return <DocHubAnim />;
    case 'conflict':   return <ConflictAnim />;
    case 'library':    return <LibraryAnim />;
    case 'forms':      return <FormsAnim />;
    default:           return null;
  }
}

/* ── Shared mini app-shell for rich scenes ─────────────── */
function Shell({ act, title, right, children }) {
  const nav = [
    ['today', 'Today'], ['matters', 'Matters'], ['draft', 'Draft'], ['contract', 'Contracts'],
    ['research', 'Research'], ['courtroom', 'Courtroom'], ['calendar', 'Calendar'],
    ['vault', 'Vault'], ['library', 'Library'], ['forms', 'Forms'],
  ];
  return (
    <div className="fsh">
      <aside className="fsh__side">
        <div className="fsh__brand"><span>L</span></div>
        {nav.map(([k, l]) => (
          <div key={k} className={`fsh__link ${act === k ? 'is-on' : ''}`}>
            <span className="fsh__dot" />{l}
          </div>
        ))}
      </aside>
      <main className="fsh__main">
        <header className="fsh__top">
          <div className="fsh__crumb">{title}</div>
          <div className="fsh__right">{right}</div>
        </header>
        <section className="fsh__body">{children}</section>
      </main>
    </div>
  );
}

/* ── 01. Today — stat cards + agenda + pending ─────────── */
function TodayAnim() {
  const stats = [
    { lbl: 'Clients', end: 42 },
    { lbl: 'Matters', end: 128 },
    { lbl: 'Hearings this week', end: 7 },
    { lbl: 'Pending actions', end: 3 },
  ];
  return (
    <Shell act="today" title="Today · Priya Mehta" right={<><span className="fsh__pill">Wed, 29 Oct</span></>}>
      <div className="todayGrid">
        <div className="todayStats">
          {stats.map((s, i) => (
            <div className="todayCard" key={s.lbl} style={{ animationDelay: `${i * 100}ms` }}>
              <Ticker to={s.end} delay={i * 100 + 200} />
              <div className="todayCard__lbl">{s.lbl}</div>
            </div>
          ))}
        </div>
        <div className="todayAg">
          <div className="todayAg__h">Upcoming hearings</div>
          {[
            { t: '10:30', c: 'Delhi HC', m: 'Sharma v. State' },
            { t: '14:00', c: 'NCLT',  m: 'Nexus Insolvency' },
            { t: 'EOD',   c: 'Office', m: 'File rejoinder — Mehta' },
          ].map((h, i) => (
            <div className="todayItem" key={i} style={{ animationDelay: `${300 + i * 110}ms` }}>
              <div className="todayItem__t">{h.t}</div>
              <div className="todayItem__body"><strong>{h.m}</strong><small>{h.c}</small></div>
              <div className="todayItem__dot" />
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}
function Ticker({ to, delay = 0 }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let f, start;
    const dur = 900;
    const run = (t) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / dur);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) f = requestAnimationFrame(run);
    };
    const t = setTimeout(() => { f = requestAnimationFrame(run); }, delay);
    return () => { clearTimeout(t); cancelAnimationFrame(f); };
  }, [to, delay]);
  return <div className="statc__n">{n}</div>;
}

/* ── 02. Matters — table with hearings + status chips ──── */
function MattersAnim() {
  const rows = [
    { t: 'Sharma v. State of Maharashtra', c: 'Delhi HC',  n: 'TEST-6200', nh: '30 Oct', s: 'Active' },
    { t: 'Nexus v. InfoSoft Insolvency',    c: 'NCLT',     n: 'IBC-412',   nh: '2 Nov',  s: 'Active' },
    { t: 'Mehta Industries — Advisory',     c: '—',        n: 'MI-01',     nh: '—',       s: 'Advisory' },
    { t: 'Rohit Sharma — Bail',             c: 'Bombay HC',n: 'CRL-342',   nh: 'Today',   s: 'Urgent' },
    { t: 'Vakalatnama — Anjali Singh',      c: 'District', n: 'VK-9',      nh: '—',       s: 'Done' },
  ];
  return (
    <Shell act="matters" title="Matters" right={<><span className="fsh__pill">+ New matter</span></>}>
      <table className="mtbl">
        <thead><tr><th>Matter</th><th>Court</th><th>Case no.</th><th>Next</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.n} style={{ animationDelay: `${i * 90}ms` }}>
              <td className="mtbl__t"><strong>{r.t}</strong></td>
              <td>{r.c}</td>
              <td className="mono">{r.n}</td>
              <td>{r.nh}</td>
              <td>
                <span className={`mchip ${r.s === 'Urgent' ? 'is-red' : r.s === 'Active' ? 'is-ok' : r.s === 'Done' ? 'is-mut' : ''}`}>{r.s}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

/* ── 03. Contract Analyzer — doc + risk panel + ring ──── */
function ContractAnim() {
  const lines = [
    { r: 0 }, { r: 2 }, { r: 0 }, { r: 0 }, { r: 1 },
    { r: 0 }, { r: 0 }, { r: 2 }, { r: 0 }, { r: 0 },
    { r: 1 }, { r: 0 }, { r: 0 },
  ];
  return (
    <Shell act="contract" title="Contract Analyzer / MSA_v2.pdf" right={<span className="fsh__pill is-amber">Scanning · 72%</span>}>
      <div className="ctScene">
        <div className="ctDoc">
          <div className="ctDoc__title" />
          {lines.map((l, i) => (
            <div key={i} className="ctDoc__ln" style={{ animationDelay: `${i * 55}ms` }}>
              <div className="ctDoc__tx" />
              {l.r > 0 && (
                <span className={`ctFlag ${l.r === 2 ? 'is-high' : 'is-mid'}`} style={{ animationDelay: `${500 + i * 55}ms` }}>
                  {l.r === 2 ? 'CRITICAL' : 'REVIEW'}
                </span>
              )}
            </div>
          ))}
          <div className="ctDoc__scan" />
        </div>
        <aside className="ctPanel">
          <div className="ctRingBox">
            <div className="ctRing">
              <svg viewBox="0 0 42 42">
                <circle cx="21" cy="21" r="18" fill="none" stroke="var(--rule)" strokeWidth="3" />
                <circle cx="21" cy="21" r="18" fill="none" stroke="var(--accent)" strokeWidth="3"
                  strokeDasharray="113" strokeDashoffset="40" strokeLinecap="round"
                  transform="rotate(-90 21 21)" className="ctRing__arc" />
              </svg>
              <span>65</span>
            </div>
            <div className="ctRing__lbl">Risk score</div>
          </div>
          <div className="ctRow"><span>Critical</span><strong>2</strong></div>
          <div className="ctRow"><span>Major</span><strong>5</strong></div>
          <div className="ctRow"><span>Missing</span><strong>3</strong></div>
          <button className="ctBtn">Open report ↗</button>
        </aside>
      </div>
    </Shell>
  );
}

/* ── 04. Research — type a query, results fade in ────────── */
function ResearchAnim() {
  const [typed, setTyped] = useState('');
  const query = 'Section 420 cheque bounce';
  useEffect(() => {
    let i = 0;
    const t = setInterval(() => {
      i += 1; setTyped(query.slice(0, i));
      if (i >= query.length) clearInterval(t);
    }, 55);
    return () => clearInterval(t);
  }, []);
  const results = [
    'Hridaya Ranjan Prasad Verma v. State of Bihar (2000) 4 SCC 168',
    'G. Sagar Suri v. State of U.P. (2000) 2 SCC 636',
    'Inder Mohan Goswami v. State of Uttaranchal (2007) 12 SCC 1',
  ];
  return (
    <div className="anim anim-research">
      <div className="search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <span>{typed}</span><span className="search__caret">|</span>
      </div>
      <div className="results">
        {results.map((r, i) => (
          <div key={i} className="result" style={{ animationDelay: `${1800 + i * 180}ms` }}>
            <div className="result__t">{r}</div>
            <div className="result__m">Supreme Court · cheating / mens rea</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 05. Auto-Draft — writing page + AI panel ──────────── */
function DraftAnim() {
  return (
    <Shell act="draft" title="Draft / Regular Bail — Rohit Sharma" right={<span className="fsh__pill is-amber">Saving…</span>}>
      <div className="drScene">
        <div className="drPage">
          <svg viewBox="0 0 460 240" className="drInk">
            <text x="30" y="40" className="k1">In the Court of Session at Mumbai</text>
            <text x="30" y="80" className="k2">APPLICATION FOR REGULAR BAIL</text>
            <text x="30" y="120" className="k3">under Section 483 BNSS, 2023</text>
            <text x="30" y="170" className="k4">The applicant respectfully submits that</text>
            <text x="30" y="200" className="k5">the ingredients of the offence are not</text>
            <text x="30" y="230" className="k6">made out on the facts of this case.</text>
          </svg>
        </div>
        <aside className="drAi">
          <div className="drAi__h"><span>✦</span> AI Assistant</div>
          <div className="drChip">Strengthen</div>
          <div className="drChip">Shorten</div>
          <div className="drChip is-on">Add clause ✓</div>
          <div className="drAi__input">Ask to edit…</div>
        </aside>
      </div>
    </Shell>
  );
}

/* ── 06. Court Resources — 3-column slot roll ────────────── */
function CourtAnim() {
  return (
    <div className="anim anim-court">
      <div className="slot">
        <div className="slot__col"><div className="slot__strip s1">
          <span>Supreme Court</span><span>High Courts</span><span>District Courts</span>
          <span>Tribunals</span><span>Supreme Court</span>
        </div></div>
        <div className="slot__col"><div className="slot__strip s2">
          <span>Judges</span><span>Rosters</span><span>Bar Councils</span>
          <span>Bare Acts</span><span>Judges</span>
        </div></div>
        <div className="slot__col"><div className="slot__strip s3">
          <span>Cause Lists</span><span>Fee Calculator</span><span>IP Tracker</span>
          <span>Legal Feed</span><span>Cause Lists</span>
        </div></div>
      </div>
    </div>
  );
}

/* ── 07. Legal Calendar — month grid, dates light, hearing badge ─ */
function CalendarAnim() {
  const cells = Array.from({ length: 30 }, (_, i) => i + 1);
  return (
    <div className="anim anim-cal">
      <div className="cal__h">October 2026</div>
      <div className="cal__grid">
        {cells.map((n) => (
          <div className={`cal__c ${n === 17 ? 'is-today' : ''} ${[7, 12, 17, 22, 28].includes(n) ? 'has-event' : ''}`}
               key={n} style={{ animationDelay: `${n * 20}ms` }}>
            {n}
          </div>
        ))}
      </div>
      <div className="cal__badge">Hearing · Delhi HC · 10:30</div>
    </div>
  );
}

/* ── 08. Virtual Courtroom — chat + authorities panel ──── */
function CourtroomAnim() {
  return (
    <Shell act="courtroom" title="Virtual Courtroom / Rohit Sharma v. State" right={<span className="fsh__pill is-red">● live</span>}>
      <div className="crScene">
        <div className="crChat">
          <div className="crMsg crMsg--adv" style={{ animationDelay: '200ms' }}>
            <div className="crRole">You · Appellant</div>
            <div className="crBody">Partial performance negates the dishonest intention required under s.415 IPC.</div>
          </div>
          <div className="crMsg crMsg--bench" style={{ animationDelay: '1200ms' }}>
            <div className="crRole">The Bench</div>
            <div className="crBody">
              The Court has considered <em>Hridaya Ranjan Prasad Verma v. State of Bihar</em><span className="crV">✓ verified</span>.
              You must still show absence of mens rea at inception.
            </div>
          </div>
          <div className="crMsg crMsg--adv" style={{ animationDelay: '2400ms' }}>
            <div className="crRole">You · Appellant</div>
            <div className="crBody">Bank statements show steady deliverables through February 2024…</div>
          </div>
        </div>
        <aside className="crAuth">
          <div className="crAuth__h">Authorities · 3</div>
          <div className="crAuth__i"><span className="ok">✓</span> Hridaya Ranjan Prasad Verma v. Bihar</div>
          <div className="crAuth__i"><span className="ok">✓</span> G. Sagar Suri v. State of U.P.</div>
          <div className="crAuth__i"><span className="ok">✓</span> Inder Mohan Goswami v. Uttaranchal</div>
          <div className="crAuth__f">India Kanoon · DuckDuckGo</div>
        </aside>
      </div>
    </Shell>
  );
}

/* ── 09. Practice — org tree drawing ────────────────────── */
function PracticeAnim() {
  return (
    <div className="anim anim-prac">
      <svg viewBox="0 0 460 220" className="org">
        <circle cx="230" cy="40" r="22" className="org__node is-senior" />
        <text x="230" y="46" className="org__lbl">S</text>
        <path d="M230 62 L120 130" className="org__line" style={{ animationDelay: '400ms' }} />
        <path d="M230 62 L230 130" className="org__line" style={{ animationDelay: '550ms' }} />
        <path d="M230 62 L340 130" className="org__line" style={{ animationDelay: '700ms' }} />
        <circle cx="120" cy="150" r="18" className="org__node" style={{ animationDelay: '800ms' }} />
        <text x="120" y="155" className="org__lbl">J</text>
        <circle cx="230" cy="150" r="18" className="org__node" style={{ animationDelay: '950ms' }} />
        <text x="230" y="155" className="org__lbl">J</text>
        <circle cx="340" cy="150" r="18" className="org__node" style={{ animationDelay: '1100ms' }} />
        <text x="340" y="155" className="org__lbl">S</text>
      </svg>
      <div className="org__legend">Senior · Juniors · Staff</div>
    </div>
  );
}

/* ── 10. Case Vault — tree + doc grid + share modal ────── */
function VaultAnim() {
  const docs = [
    { n: 'Spectrum_Artwork_QA_Report.pdf', t: 'PDF' },
    { n: 'NDA_Nexus_Ventures.pdf', t: 'PDF' },
    { n: 'Bail_Application_State_v_Irfan.docx', t: 'DOCX' },
    { n: 'FIR_118_2024.pdf', t: 'PDF' },
  ];
  return (
    <Shell act="vault" title="Case Vault / Mehta Industries" right={<span className="fsh__pill is-amber">↑ Upload</span>}>
      <div className="vtScene">
        <aside className="vtTree">
          <div className="vtFolder is-on">📁 Mehta Industries</div>
          <div className="vtFolder pad">▸ Agreements</div>
          <div className="vtFolder pad">▸ Pleadings</div>
          <div className="vtFolder">📁 Sharma v. State</div>
          <div className="vtFolder">📁 Nexus Ventures</div>
        </aside>
        <section className="vtGrid">
          {docs.map((d, i) => (
            <div className="vtDoc" key={d.n} style={{ animationDelay: `${i * 90}ms` }}>
              <div className="vtExt">{d.t}</div>
              <div className="vtName">{d.n}</div>
              <div className="vtMeta">11 KB · 2 d ago</div>
            </div>
          ))}
        </section>
        <div className="vtShare">
          <div className="vtShare__h"><span>↗</span> Share — Spectrum_Artwork</div>
          <div className="vtShare__row">
            <span className="vtAv">M</span>
            <div className="vtShare__who"><div>Meera Shah</div><small>meera@test.com</small></div>
            <span className="vtPerm">View only ✓</span>
          </div>
        </div>
      </div>
    </Shell>
  );
}

/* ── 11. Document Hub — files flying into bins ───────────── */
function DocHubAnim() {
  const files = ['Contract', 'Notice', 'Judgment', 'Affidavit'];
  return (
    <div className="anim anim-dochub">
      <div className="inbox">Inbox · 4</div>
      {files.map((f, i) => (
        <div key={f} className={`fly fly--${i}`} style={{ animationDelay: `${300 + i * 220}ms` }}>
          <div className="fly__card">{f}</div>
        </div>
      ))}
      <div className="bins">
        {files.map((f) => <div key={f} className="bin">{f}</div>)}
      </div>
    </div>
  );
}

/* ── 12. Conflict Engine — contradiction line between docs ─ */
function ConflictAnim() {
  return (
    <div className="anim anim-conflict">
      <div className="conflictWrap">
        <div className="cfdoc">
          <div className="cfdoc__h">nda_v1.txt</div>
          <div className="cfdoc__line" />
          <div className="cfdoc__line hl">Delhi courts</div>
          <div className="cfdoc__line" />
          <div className="cfdoc__line" />
        </div>
        <svg className="cflink" viewBox="0 0 60 200" preserveAspectRatio="none">
          <path d="M 0 90 Q 30 100, 60 110" className="cflink__p" />
        </svg>
        <div className="cfdoc">
          <div className="cfdoc__h">nda_v2.txt</div>
          <div className="cfdoc__line" />
          <div className="cfdoc__line" />
          <div className="cfdoc__line hl">Mumbai arbitration</div>
          <div className="cfdoc__line" />
        </div>
      </div>
      <div className="cflabel">Jurisdiction clash · Critical</div>
    </div>
  );
}

/* ── 13. Firm Library — bookshelf, one book slides out ──── */
function LibraryAnim() {
  const spines = Array.from({ length: 20 });
  return (
    <div className="anim anim-lib">
      <div className="shelf">
        {spines.map((_, i) => (
          <div key={i} className={`spine ${i === 7 ? 'is-pick' : ''}`} style={{ animationDelay: `${i * 25}ms` }} />
        ))}
      </div>
      <div className="shelf__base" />
      <div className="book">
        <div className="book__cover">Regular Bail — Section 483 BNSS 2023</div>
      </div>
    </div>
  );
}

/* ── 14. Legal Forms — AI fills fields one by one ────────── */
function FormsAnim() {
  const fields = [
    { lbl: 'Party A', val: 'Alpha Pharma Pvt Ltd' },
    { lbl: 'Party B', val: 'Beta Research LLP' },
    { lbl: 'Date', val: '01 January 2026' },
    { lbl: 'Jurisdiction', val: 'Delhi' },
    { lbl: 'Term', val: '3 years' },
  ];
  return (
    <div className="anim anim-forms">
      {fields.map((f, i) => (
        <div className="finp" key={f.lbl} style={{ animationDelay: `${i * 260}ms` }}>
          <div className="finp__lbl">
            {f.lbl}
            <span className="finp__ai">✦ AI</span>
          </div>
          <div className="finp__val"><span>{f.val}</span><span className="finp__chk">✓</span></div>
        </div>
      ))}
    </div>
  );
}
