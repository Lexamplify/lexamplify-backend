import { useEffect, useRef, useState } from 'react';

const STATE_COLORS = {
  COMPLETED: 'var(--accent)', VERIFYING: 'var(--accent)', EXECUTING: '#2f7d4f',
  PLANNING: '#2f7d4f', RECOVERING: '#b07b1a',
  WAITING_FOR_USER: '#b07b1a', WAITING_FOR_APPROVAL: '#b07b1a',
  FAILED: '#c0392b', CANCELLED: 'var(--muted)',
};
const SUGGESTIONS = [
  'List my matters',
  "What's on my calendar this week?",
  'Run a conflict check for Acme Corp',
  'Summarise this workspace',
];

/* ── tiny inline icons ─────────────────────────────────────── */
const Ic = {
  Sparkle: (p) => (<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2zM19 14l.9 2.6L22.5 17l-2.6.9L19 20.5l-.9-2.6L15.5 17l2.6-.9L19 14z"/></svg>),
  Panel: (p) => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/></svg>),
  Plus: (p) => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>),
  Edit: (p) => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>),
  Chevron: (p) => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="6 9 12 15 18 9"/></svg>),
  Check: (p) => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="20 6 9 17 4 12"/></svg>),
  Mic: (p) => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0014 0M12 17v4"/></svg>),
  Stop: (p) => (<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" {...p}><rect x="6" y="6" width="12" height="12" rx="2"/></svg>),
  Send: (p) => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>),
  User: (p) => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/></svg>),
  Arrow: (p) => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>),
};

function Pill({ state }) {
  if (!state) return null;
  return <span className="ea-pill" style={{ background: STATE_COLORS[state] || 'var(--ink-soft)' }}>{state.replace(/_/g, ' ')}</span>;
}

export default function Assistant() {
  const [tasks, setTasks] = useState([]);
  const [active, setActive] = useState(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('ea_sidebar_collapsed') === '1'; } catch { return false; }
  });
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches);

  const scrollRef = useRef(null);
  const recRef = useRef(null);
  const taRef = useRef(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)');
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Auto-grow the composer.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [input]);

  async function refreshList() {
    try {
      const r = await fetch('/api/agent/tasks');
      if (r.ok) setTasks((await r.json()).tasks || []);
    } catch { /* ignore */ }
  }
  useEffect(() => { refreshList(); }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [active, busy]);

  function toggleSidebar() {
    if (isMobile) { setDrawerOpen((o) => !o); return; }
    setCollapsed((c) => { const n = !c; try { localStorage.setItem('ea_sidebar_collapsed', n ? '1' : '0'); } catch { /* */ } return n; });
  }
  function newChat() { setActive(null); setStepsOpen(false); setDrawerOpen(false); setTimeout(() => taRef.current?.focus(), 0); }

  async function openTask(id) {
    const r = await fetch(`/api/agent/task/${id}`);
    if (r.ok) { setActive((await r.json()).task); setStepsOpen(false); setDrawerOpen(false); }
  }

  async function toggleVoice() {
    if (recording) { recRef.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        setRecording(false);
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        const fd = new FormData();
        fd.append('audio', blob, 'speech.webm'); fd.append('lang', 'auto'); fd.append('kind', 'legal');
        try {
          const r = await fetch('/api/stt/transcribe', { method: 'POST', body: fd });
          const data = await r.json();
          if (r.ok && data.text) setInput((prev) => (prev ? prev + ' ' : '') + data.text);
        } catch { /* mic text just doesn't appear */ }
      };
      recRef.current = rec; rec.start(); setRecording(true);
    } catch { /* permission denied */ }
  }

  async function submit(e) {
    e?.preventDefault?.();
    const v = input.trim();
    if (!v || busy) return;
    setInput(''); setBusy(true); setStepsOpen(false);
    try {
      let r;
      if (active && active.state === 'WAITING_FOR_USER') {
        r = await fetch(`/api/agent/task/${active.id}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: v }) });
      } else {
        r = await fetch('/api/agent/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instruction: v }) });
      }
      const data = await r.json();
      if (r.ok) { setActive(data.task); refreshList(); } else alert(data.error || data.message || 'Something went wrong');
    } finally { setBusy(false); }
  }

  async function decide(decision, stepIdx) {
    setBusy(true);
    try {
      const r = await fetch(`/api/agent/task/${active.id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, step_idx: stepIdx }) });
      if (r.ok) { setActive((await r.json()).task); refreshList(); }
    } finally { setBusy(false); }
  }

  function pickSuggestion(s) { setInput(s); setTimeout(() => taRef.current?.focus(), 0); }

  const pendingApproval = active?.state === 'WAITING_FOR_APPROVAL'
    ? active.steps?.find((s) => s.state === 'PENDING' && s.risk === 'C') : null;
  const steps = active?.steps || [];
  const doneSteps = steps.filter((s) => s.state === 'DONE').length;
  const allVerified = steps.length > 0 && steps.every((s) => s.state !== 'DONE' || (s.verification || '').startsWith('VERIFIED_SUCCESS'));
  const navStep = active?.state === 'COMPLETED' ? steps.find((s) => s.output?.navigate_to) : null;

  const rootCls = `ea${collapsed ? ' ea--collapsed' : ''}${isMobile && drawerOpen ? ' ea--drawer-open' : ''}`;

  return (
    <div className={rootCls}>
      {isMobile && drawerOpen && <div className="ea-scrim" onClick={() => setDrawerOpen(false)} />}

      {/* ── Conversations sidebar ── */}
      <aside className="ea-side">
        <div className="ea-side__top">
          <span className="ea-side__brand">Conversations{tasks.length > 0 && <span className="ea-side__count">{tasks.length}</span>}</span>
          <button className="ea-icon" onClick={toggleSidebar} aria-label="Collapse" style={{ width: 30, height: 30 }}><Ic.Panel /></button>
        </div>
        <button className="ea-newbtn" onClick={newChat}><Ic.Plus /> New chat</button>
        <div className="ea-side__list">
          {tasks.length === 0 && <div className="ea-side__empty">No conversations yet.<br />Start by describing a task.</div>}
          {tasks.map((t) => (
            <button key={t.id} className={`ea-conv${active?.id === t.id ? ' is-active' : ''}`} onClick={() => openTask(t.id)}>
              <span className="ea-conv__title">{t.instruction}</span>
              <span className="ea-conv__meta">
                <span className="ea-conv__dot" style={{ background: STATE_COLORS[t.state] || 'var(--muted)' }} />
                <span className="ea-conv__state">{(t.state || '').replace(/_/g, ' ')}</span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* ── Chat column ── */}
      <main className="ea-main">
        <header className="ea-top">
          <button className="ea-icon" onClick={toggleSidebar} aria-label="Toggle conversations"><Ic.Panel /></button>
          <div className="ea-top__title">
            <div className="ea-top__titles">
              <h1>Executive Assistant</h1>
              {!active && <div className="ea-top__sub">Plans, runs &amp; verifies tasks across your practice</div>}
            </div>
            {active && <Pill state={active.state} />}
          </div>
          <button className="ea-icon" onClick={newChat} aria-label="New chat"><Ic.Edit /></button>
        </header>

        <div className="ea-scroll" ref={scrollRef}>
          {!active ? (
            <div className="ea-empty">
              <span className="ea-empty__logo"><Ic.Sparkle width="26" height="26" /></span>
              <h2>How can I help?</h2>
              <p>Describe a task in plain words — I'll plan it, run it across your matters, calendar, drafts and vault, then verify it actually worked.</p>
              <div className="ea-chips">
                {SUGGESTIONS.map((s) => <button key={s} className="ea-chip" onClick={() => pickSuggestion(s)}>{s}</button>)}
              </div>
            </div>
          ) : (
            <div className="ea-thread">
              {active.messages?.map((m, i) => (
                <div key={i} className={`ea-msg ${m.who === 'you' ? 'ea-msg--you' : 'ea-msg--bot'}`}>
                  <span className="ea-msg__av">{m.who === 'you' ? <Ic.User /> : <Ic.Sparkle />}</span>
                  <div className="ea-msg__bubble">{m.text}</div>
                </div>
              ))}

              {steps.length > 0 && (
                <div className={`ea-steps${stepsOpen ? ' is-open' : ''}`}>
                  <button className="ea-steps__toggle" onClick={() => setStepsOpen((o) => !o)}>
                    <span className="ea-steps__ok">{allVerified ? <Ic.Check /> : null}</span>
                    {allVerified ? 'Verified' : 'Ran'} {doneSteps || steps.length} step{(doneSteps || steps.length) === 1 ? '' : 's'}
                    {active?.result?.tokens_used > 0 && <span className="ea-steps__tokens">· {active.result.tokens_used} tokens</span>}
                    <Ic.Chevron className="ea-steps__chev" />
                  </button>
                  {stepsOpen && (
                    <div className="ea-steps__body">
                      {steps.map((s) => {
                        const v = s.verification || '';
                        const cls = s.state === 'FAILED' ? 'bad' : s.state === 'DONE' ? (v.startsWith('VERIFIED_SUCCESS') ? 'ok' : 'warn') : 'run';
                        return (
                          <div key={s.idx} className="ea-step">
                            <span className="ea-step__n">{s.idx + 1}</span>
                            <span className="ea-step__tool">{s.tool}</span>
                            <span className={`ea-step__state ea-step__state--${cls}`}>
                              {s.state}{s.state === 'DONE' && (v.startsWith('VERIFIED_SUCCESS') ? ' · verified' : ' · unverified')}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {navStep && (
                <button className="ea-open-btn" onClick={() => { window.location.hash = '#' + navStep.output.navigate_to; }}>
                  Open {navStep.output.navigate_to} <Ic.Arrow />
                </button>
              )}

              {pendingApproval && (
                <div className="ea-approve">
                  <div className="ea-approve__h">⚠ Approval needed</div>
                  <div className="ea-approve__body">
                    Step {pendingApproval.idx + 1}: <b>{pendingApproval.tool}</b> with <code>{JSON.stringify(pendingApproval.inputs)}</code>
                  </div>
                  <div className="ea-approve__btns">
                    <button className="ea-btn ea-btn--primary" disabled={busy} onClick={() => decide('approve', pendingApproval.idx)}>Approve</button>
                    <button className="ea-btn" disabled={busy} onClick={() => decide('reject', pendingApproval.idx)}>Reject</button>
                  </div>
                </div>
              )}

              {busy && (
                <div className="ea-msg ea-msg--bot">
                  <span className="ea-msg__av"><Ic.Sparkle /></span>
                  <div className="ea-msg__bubble" style={{ padding: 0 }}><div className="ea-typing"><span /><span /><span /></div></div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="ea-composer">
          <form className="ea-composer__row" onSubmit={submit}>
            <textarea
              ref={taRef} rows={1} value={input} disabled={busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(e); } }}
              placeholder={active?.state === 'WAITING_FOR_USER' ? 'Answer the assistant…' : 'Message the assistant — e.g. create a matter titled Sharma vs Gupta'}
            />
            <button type="button" className={`ea-mic${recording ? ' is-rec' : ''}`} onClick={toggleVoice} disabled={busy}
              title={recording ? 'Stop recording' : 'Dictate'} aria-label="Voice input">
              {recording ? <Ic.Stop /> : <Ic.Mic />}
            </button>
            <button type="submit" className="ea-send" disabled={busy || recording || !input.trim()} aria-label="Send"><Ic.Send /></button>
          </form>
          <div className="ea-hint">Voice is transcribed by an AI service; audio isn't stored. Consequential actions always ask for your approval first.</div>
        </div>
      </main>
    </div>
  );
}
