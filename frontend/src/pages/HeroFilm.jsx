import { useEffect, useState, useRef } from 'react';

/*
 * HeroFilm — a cinematic 5-scene "product film" that acts like a 20-second
 * marketing video for the hero. Each scene renders a realistic app surface
 * (sidebar + top chrome + content panel + micro-interactions) instead of a
 * single floating element. Scenes crossfade with motion and a caption bar
 * narrates what the viewer is seeing. Loops forever.
 */

// Timeline — each scene owns a 3.6s beat with a short caption.
const FILM = [
  { k: 'draft',     cap: 'Draft a bail application from your matter file.', dur: 4200 },
  { k: 'contract',  cap: 'Review a contract for risk — in minutes, not hours.', dur: 4200 },
  { k: 'courtroom', cap: 'Rehearse your argument. The bench presses back.', dur: 4600 },
  { k: 'calendar',  cap: 'Every hearing, every deadline — synced across the firm.', dur: 4000 },
  { k: 'vault',     cap: 'Share one document with one person. Nothing more.', dur: 4000 },
];

export default function HeroFilm() {
  const [idx, setIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef(null);
  const startRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const dur = FILM[idx].dur;
    startRef.current = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - startRef.current) / dur);
      setProgress(p);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    timerRef.current = setTimeout(() => setIdx((i) => (i + 1) % FILM.length), dur);
    return () => { clearTimeout(timerRef.current); cancelAnimationFrame(rafRef.current); };
  }, [idx]);

  const scene = FILM[idx];
  return (
    <div className="hfilm">
      {/* Device shell */}
      <div className="hfilm__device">
        <div className="hfilm__chrome">
          <span /><span /><span />
          <div className="hfilm__chrome-url">
            <span className="dot" /> lexamplify.in<span className="dim"> / app</span>
          </div>
          <div className="hfilm__chrome-tabs">
            <span>Matters</span><span>Draft</span><span>Vault</span>
          </div>
        </div>

        {/* Stage with cross-fading scenes */}
        <div className="hfilm__stage">
          {FILM.map((s, i) => (
            <div key={s.k} className={`hfscene hfscene--${s.k} ${idx === i ? 'is-on' : ''}`} aria-hidden={idx !== i}>
              {idx === i && renderScene(s.k)}
            </div>
          ))}

          {/* Vignette for cinematic depth */}
          <div className="hfilm__vignette" />
        </div>

        {/* Caption bar + progress line */}
        <div className="hfilm__caption">
          <div className="hfilm__cap-left">
            <span className="hfilm__dot" />
            <span className="hfilm__cap">{scene.cap}</span>
          </div>
          <div className="hfilm__chapters">
            {FILM.map((_, i) => (
              <button key={i} className={i === idx ? 'is-on' : ''} onClick={() => setIdx(i)} aria-label={`Scene ${i + 1}`}>
                <span style={{ width: i === idx ? `${progress * 100}%` : (i < idx ? '100%' : '0%') }} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Floating accent tags */}
      <div className="hfilm__tag hfilm__tag--tl">14 features</div>
      <div className="hfilm__tag hfilm__tag--tr">Hosted in India</div>
      <div className="hfilm__tag hfilm__tag--bl">Audit trail · every change</div>
      <div className="hfilm__tag hfilm__tag--br">Citations · verified</div>
    </div>
  );
}

function renderScene(k) {
  if (k === 'draft')     return <DraftScene />;
  if (k === 'contract')  return <ContractScene />;
  if (k === 'courtroom') return <CourtroomScene />;
  if (k === 'calendar')  return <CalendarScene />;
  if (k === 'vault')     return <VaultScene />;
  return null;
}

/* Shared app-chrome: a sidebar + top bar inside the stage, so every scene
   looks like the real app. */
function AppShell({ sidebarActive, title, right, children }) {
  const nav = [
    { k: 'today', lbl: 'Today' },
    { k: 'matters', lbl: 'Matters' },
    { k: 'draft', lbl: 'Draft' },
    { k: 'contract', lbl: 'Contracts' },
    { k: 'courtroom', lbl: 'Courtroom' },
    { k: 'calendar', lbl: 'Calendar' },
    { k: 'vault', lbl: 'Case Vault' },
    { k: 'library', lbl: 'Library' },
  ];
  return (
    <div className="hfsh">
      <aside className="hfsh__side">
        <div className="hfsh__brand"><span>L</span><em>Lexamplify</em></div>
        {nav.map((n) => (
          <div key={n.k} className={`hfsh__link ${sidebarActive === n.k ? 'is-on' : ''}`}>
            <span className="hfsh__dot" />{n.lbl}
          </div>
        ))}
      </aside>
      <main className="hfsh__main">
        <header className="hfsh__top">
          <div className="hfsh__crumb">{title}</div>
          <div className="hfsh__right">{right}</div>
        </header>
        <section className="hfsh__body">{children}</section>
      </main>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   SCENE 1 — Draft (Auto-Draft Studio) with pen writing + AI side-panel
   ────────────────────────────────────────────────────────── */
function DraftScene() {
  return (
    <AppShell
      sidebarActive="draft"
      title="Draft / Regular Bail — Rohit Sharma v. State of Maharashtra"
      right={<span className="hfsh__pill is-saving">Saving…</span>}
    >
      <div className="hfdoc">
        <div className="hfdoc__page">
          <svg viewBox="0 0 460 240" className="hfdoc__ink">
            <text x="30" y="40" className="ink1">In the Court of Session at Mumbai</text>
            <text x="30" y="80" className="ink2">APPLICATION FOR REGULAR BAIL</text>
            <text x="30" y="120" className="ink3">under Section 483 BNSS, 2023</text>
            <text x="30" y="170" className="ink4">The applicant respectfully submits that</text>
            <text x="30" y="200" className="ink5">the ingredients of the offence are not</text>
            <text x="30" y="230" className="ink6">made out on the facts of this case.</text>
          </svg>
        </div>
        <aside className="hfdoc__ai">
          <div className="hfdoc__ai-head">
            <span className="hfdoc__spark">✦</span> AI Assistant
          </div>
          <div className="hfdoc__chip">Strengthen</div>
          <div className="hfdoc__chip">Shorten</div>
          <div className="hfdoc__chip hfdoc__chip--on">Add clause ✓</div>
          <div className="hfdoc__ai-input">Ask to edit…</div>
        </aside>
      </div>
    </AppShell>
  );
}

/* ──────────────────────────────────────────────────────────
   SCENE 2 — Contract Analyzer with scan + risk flags + score card
   ────────────────────────────────────────────────────────── */
function ContractScene() {
  const lines = [
    { r: 0 }, { r: 2 }, { r: 0 }, { r: 0 }, { r: 1 },
    { r: 0 }, { r: 0 }, { r: 2 }, { r: 0 }, { r: 0 },
    { r: 1 }, { r: 0 }, { r: 0 },
  ];
  return (
    <AppShell
      sidebarActive="contract"
      title="Contract Analyzer / MSA_v2.pdf"
      right={<span className="hfsh__pill is-scanning">Scanning · 72%</span>}
    >
      <div className="hfct">
        <div className="hfct__doc">
          <div className="hfct__title" />
          {lines.map((l, i) => (
            <div key={i} className="hfct__line" style={{ animationDelay: `${i * 55}ms` }}>
              <div className="hfct__text" />
              {l.r > 0 && (
                <span className={`hfct__flag ${l.r === 2 ? 'is-high' : 'is-mid'}`} style={{ animationDelay: `${500 + i * 55}ms` }}>
                  {l.r === 2 ? 'CRITICAL' : 'REVIEW'}
                </span>
              )}
            </div>
          ))}
          <div className="hfct__scan" />
        </div>
        <aside className="hfct__panel">
          <div className="hfct__score">
            <div className="hfct__ring">
              <svg viewBox="0 0 42 42">
                <circle cx="21" cy="21" r="18" fill="none" stroke="var(--rule)" strokeWidth="3" />
                <circle cx="21" cy="21" r="18" fill="none" stroke="var(--accent)" strokeWidth="3"
                  strokeDasharray="113" strokeDashoffset="40" strokeLinecap="round"
                  transform="rotate(-90 21 21)" className="hfct__ring-arc" />
              </svg>
              <span>65</span>
            </div>
            <div className="hfct__score-lbl">Risk score</div>
          </div>
          <div className="hfct__row"><span>Critical</span><strong>2</strong></div>
          <div className="hfct__row"><span>Major</span><strong>5</strong></div>
          <div className="hfct__row"><span>Missing</span><strong>3</strong></div>
          <button className="hfct__btn">Open report ↗</button>
        </aside>
      </div>
    </AppShell>
  );
}

/* ──────────────────────────────────────────────────────────
   SCENE 3 — Virtual Courtroom with layered chat + verified authorities
   ────────────────────────────────────────────────────────── */
function CourtroomScene() {
  return (
    <AppShell
      sidebarActive="courtroom"
      title="Virtual Courtroom / Rohit Sharma v. State of Maharashtra"
      right={<span className="hfsh__pill is-live">● live simulation</span>}
    >
      <div className="hfcr">
        <div className="hfcr__chat">
          <div className="hfcr__msg hfcr__msg--adv" style={{ animationDelay: '200ms' }}>
            <div className="hfcr__role">You · Appellant</div>
            <div className="hfcr__body">Partial performance negates the dishonest intention required under s.415 IPC.</div>
          </div>
          <div className="hfcr__msg hfcr__msg--bench" style={{ animationDelay: '1200ms' }}>
            <div className="hfcr__role">The Bench</div>
            <div className="hfcr__body">
              The Court has considered <em>Hridaya Ranjan Prasad Verma v. State of Bihar (2000) 4 SCC 168</em><span className="hfcr__v">✓ verified</span>.
              Partial performance is relevant, but you must still show absence of mens rea <em>at inception</em>.
            </div>
          </div>
          <div className="hfcr__msg hfcr__msg--adv" style={{ animationDelay: '2400ms' }}>
            <div className="hfcr__role">You · Appellant</div>
            <div className="hfcr__body">Bank statements show steady deliverables through February 2024…</div>
          </div>
        </div>
        <aside className="hfcr__authorities">
          <div className="hfcr__ah">Authorities · 3</div>
          <div className="hfcr__auth"><span className="ok">✓</span> Hridaya Ranjan Prasad Verma v. Bihar</div>
          <div className="hfcr__auth"><span className="ok">✓</span> G. Sagar Suri v. State of U.P.</div>
          <div className="hfcr__auth"><span className="ok">✓</span> Inder Mohan Goswami v. Uttaranchal</div>
          <div className="hfcr__auth-foot">India Kanoon · DuckDuckGo</div>
        </aside>
      </div>
    </AppShell>
  );
}

/* ──────────────────────────────────────────────────────────
   SCENE 4 — Legal Calendar with month grid + hover popup
   ────────────────────────────────────────────────────────── */
function CalendarScene() {
  const cells = Array.from({ length: 35 }, (_, i) => i + 1);
  return (
    <AppShell
      sidebarActive="calendar"
      title="Legal Calendar / October 2026"
      right={<><span className="hfsh__pill">Agenda</span><span className="hfsh__pill is-on">Month</span></>}
    >
      <div className="hfcal">
        <div className="hfcal__head">
          <h3>October 2026</h3>
          <div className="hfcal__nav"><span>‹</span><span>›</span></div>
        </div>
        <div className="hfcal__row">
          {['S','M','T','W','T','F','S'].map((d, i) => <div key={i} className="hfcal__dayh">{d}</div>)}
        </div>
        <div className="hfcal__grid">
          {cells.map((n) => (
            <div key={n} className={`hfcal__c ${n === 17 ? 'is-today' : ''} ${[3, 7, 12, 17, 22, 28].includes(n) ? 'has-ev' : ''}`}
                 style={{ animationDelay: `${n * 15}ms` }}>
              <span>{n <= 31 ? n : ''}</span>
            </div>
          ))}
        </div>
        <div className="hfcal__pop">
          <div className="hfcal__ph">Fri · 17 Oct · 3 events</div>
          <div className="hfcal__item"><span className="dot gold" />10:30 · Delhi HC · CRL.A. 342/25</div>
          <div className="hfcal__item"><span className="dot" />14:00 · Client meeting · Mehta Ind.</div>
          <div className="hfcal__item"><span className="dot red" />EOD · File rejoinder · Sharma matter</div>
        </div>
      </div>
    </AppShell>
  );
}

/* ──────────────────────────────────────────────────────────
   SCENE 5 — Case Vault with folder tree + document grid + share modal
   ────────────────────────────────────────────────────────── */
function VaultScene() {
  const docs = [
    { n: 'Spectrum_Artwork_QA_Report.pdf', t: 'PDF' },
    { n: 'NDA_Nexus_Ventures.pdf', t: 'PDF' },
    { n: 'Bail_Application_State_v_Irfan.docx', t: 'DOCX' },
    { n: 'FIR_118_2024.pdf', t: 'PDF' },
  ];
  return (
    <AppShell
      sidebarActive="vault"
      title="Case Vault / Mehta Industries"
      right={<span className="hfsh__pill is-up">↑ Upload</span>}
    >
      <div className="hfvt">
        <aside className="hfvt__tree">
          <div className="hfvt__folder is-on">📁 Mehta Industries</div>
          <div className="hfvt__folder pad">▸ Agreements</div>
          <div className="hfvt__folder pad">▸ Pleadings</div>
          <div className="hfvt__folder pad">▸ Correspondence</div>
          <div className="hfvt__folder">📁 Sharma v. State</div>
          <div className="hfvt__folder">📁 Nexus Ventures</div>
        </aside>
        <section className="hfvt__grid">
          {docs.map((d, i) => (
            <div className="hfvt__doc" key={d.n} style={{ animationDelay: `${i * 100}ms` }}>
              <div className="hfvt__ext">{d.t}</div>
              <div className="hfvt__name">{d.n}</div>
              <div className="hfvt__meta">11 KB · 2 d ago</div>
            </div>
          ))}
        </section>
        <div className="hfvt__share">
          <div className="hfvt__share-h"><span>↗</span> Share — Spectrum_Artwork</div>
          <div className="hfvt__share-row">
            <span className="hfvt__avatar">M</span>
            <div>
              <div>Meera Shah</div>
              <small>meera@test.com</small>
            </div>
            <span className="hfvt__perm">View only ✓</span>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
