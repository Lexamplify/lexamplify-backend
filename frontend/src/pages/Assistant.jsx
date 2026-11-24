import { useEffect, useRef, useState } from 'react';

const STATE_COLORS = {
  COMPLETED: 'var(--accent)', FAILED: '#c0392b', CANCELLED: 'var(--muted)',
  WAITING_FOR_USER: '#b07b1a', WAITING_FOR_APPROVAL: '#b07b1a',
};

function StatePill({ state }) {
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', borderRadius: 999,
      padding: '2px 9px', color: '#fff', background: STATE_COLORS[state] || 'var(--ink-soft)',
    }}>{(state || '').replace(/_/g, ' ')}</span>
  );
}

function StepRow({ s }) {
  const v = s.verification || '';
  const ok = v.startsWith('VERIFIED_SUCCESS');
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.5, padding: '4px 0', borderTop: '1px solid var(--rule)' }}>
      <span style={{ color: 'var(--muted)', minWidth: 18 }}>{s.idx + 1}.</span>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5 }}>{s.tool}</span>
      <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: s.state === 'DONE' ? (ok ? 'var(--accent)' : '#b07b1a') : s.state === 'FAILED' ? '#c0392b' : 'var(--muted)' }}>
        {s.state}{s.state === 'DONE' && (ok ? ' ✓ verified' : ' (unverified)')}
      </span>
    </div>
  );
}

export default function Assistant() {
  const [tasks, setTasks] = useState([]);
  const [active, setActive] = useState(null);     // full task object
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const scrollRef = useRef(null);
  const recRef = useRef(null);

  async function toggleVoice() {
    if (recording) {
      recRef.current?.stop();
      return;
    }
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
        fd.append('audio', blob, 'speech.webm');
        fd.append('lang', 'auto');
        fd.append('kind', 'legal');
        try {
          const r = await fetch('/api/stt/transcribe', { method: 'POST', body: fd });
          const data = await r.json();
          if (r.ok && data.text) setInput((prev) => (prev ? prev + ' ' : '') + data.text);
        } catch { /* mic text just doesn't appear */ }
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch { /* permission denied — stay on typing */ }
  }

  async function refreshList() {
    try {
      const r = await fetch('/api/agent/tasks');
      if (r.ok) setTasks((await r.json()).tasks || []);
    } catch { /* ignore */ }
  }
  useEffect(() => { refreshList(); }, []);
  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [active, busy]);

  async function openTask(id) {
    const r = await fetch(`/api/agent/task/${id}`);
    if (r.ok) setActive((await r.json()).task);
  }

  async function submit(e) {
    e.preventDefault();
    const v = input.trim();
    if (!v || busy) return;
    setInput('');
    setBusy(true);
    try {
      let r, data;
      if (active && active.state === 'WAITING_FOR_USER') {
        r = await fetch(`/api/agent/task/${active.id}/reply`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: v }),
        });
      } else {
        r = await fetch('/api/agent/task', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instruction: v }),
        });
      }
      data = await r.json();
      if (r.ok) { setActive(data.task); refreshList(); }
      else alert(data.error || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision, stepIdx) {
    setBusy(true);
    try {
      const r = await fetch(`/api/agent/task/${active.id}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, step_idx: stepIdx }),
      });
      if (r.ok) { setActive((await r.json()).task); refreshList(); }
    } finally {
      setBusy(false);
    }
  }

  const pendingApproval = active?.state === 'WAITING_FOR_APPROVAL'
    ? active.steps.find((s) => s.state === 'PENDING' && s.risk === 'C')
    : null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 18, height: '100%', padding: 18 }}>
      {/* Task history */}
      <aside style={{ borderRight: '1px solid var(--rule)', paddingRight: 14, overflowY: 'auto' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 10 }}>Tasks</div>
        <button onClick={() => setActive(null)} style={{ width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: '1px dashed var(--rule)', background: 'transparent', color: 'var(--accent)', fontSize: 12.5, cursor: 'pointer', marginBottom: 10 }}>
          + New task
        </button>
        {tasks.map((t) => (
          <button key={t.id} onClick={() => openTask(t.id)} style={{
            width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, marginBottom: 6,
            border: '1px solid var(--rule)', cursor: 'pointer', fontSize: 12,
            background: active?.id === t.id ? 'color-mix(in srgb, var(--accent) 8%, var(--paper))' : 'var(--paper)',
            color: 'var(--ink)',
          }}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>{t.instruction}</div>
            <StatePill state={t.state} />
          </button>
        ))}
        {tasks.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>No tasks yet.</div>}
      </aside>

      {/* Conversation + timeline */}
      <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 17, color: 'var(--ink)' }}>Executive Assistant</h2>
          {active && <StatePill state={active.state} />}
        </div>

        <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', border: '1px solid var(--rule)', borderRadius: 12, padding: 14, background: 'var(--paper)' }}>
          {!active && (
            <div style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.7 }}>
              Tell me what to do and I'll plan it, run it, and verify it worked.<br />
              Try: <i>"create a matter titled Sharma vs Gupta"</i> or <i>"list my matters"</i>.
            </div>
          )}
          {active?.messages?.map((m, i) => (
            <div key={i} style={{
              margin: '8px 0', padding: '8px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.55, maxWidth: '85%',
              background: m.who === 'you' ? 'color-mix(in srgb, var(--accent) 10%, var(--paper))' : 'var(--paper-2)',
              marginLeft: m.who === 'you' ? 'auto' : 0, color: 'var(--ink)', border: '1px solid var(--rule)',
            }}>{m.text}</div>
          ))}

          {pendingApproval && (
            <div style={{ margin: '10px 0', padding: 14, borderRadius: 12, border: '1px solid #b07b1a', background: 'color-mix(in srgb, #b07b1a 6%, var(--paper))' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>Approval needed</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
                Step {pendingApproval.idx + 1}: <b>{pendingApproval.tool}</b> with {JSON.stringify(pendingApproval.inputs)}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button disabled={busy} onClick={() => decide('approve', pendingApproval.idx)} style={{ padding: '6px 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Approve</button>
                <button disabled={busy} onClick={() => decide('reject', pendingApproval.idx)} style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--muted)', fontSize: 12.5, cursor: 'pointer' }}>Reject</button>
              </div>
            </div>
          )}

          {active?.state === 'COMPLETED' && active.steps?.some((s) => s.output?.navigate_to) && (
            <button
              onClick={() => { window.location.hash = '#' + active.steps.find((s) => s.output?.navigate_to).output.navigate_to; }}
              style={{ margin: '8px 0', padding: '7px 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
              Open {active.steps.find((s) => s.output?.navigate_to).output.navigate_to} →
            </button>
          )}

          {active?.steps?.length > 0 && (
            <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--rule)', background: 'var(--paper-2)' }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.05em', marginBottom: 4 }}>
                EXECUTION TIMELINE
                {active?.result?.tokens_used > 0 && <span style={{ float: 'right', fontWeight: 500 }}>{active.result.tokens_used} tokens</span>}
              </div>
              {active.steps.map((s) => <StepRow key={s.idx} s={s} />)}
            </div>
          )}

          {busy && <div style={{ fontSize: 12.5, color: 'var(--muted)', fontStyle: 'italic', marginTop: 8 }}>Working…</div>}
        </div>

        <form onSubmit={submit} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            value={input} onChange={(e) => setInput(e.target.value)} disabled={busy}
            placeholder={active?.state === 'WAITING_FOR_USER' ? 'Answer the assistant…' : 'Describe a task — e.g. create a matter titled Sharma vs Gupta'}
            style={{ flex: 1, border: '1px solid var(--rule)', borderRadius: 10, padding: '10px 14px', fontSize: 13.5, background: 'var(--paper)', color: 'var(--ink)', outline: 'none' }}
          />
          <button type="button" onClick={toggleVoice} disabled={busy} title={recording ? 'Stop recording' : 'Dictate (voice is sent to the AI transcription service)'}
            style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--rule)', background: recording ? '#c0392b' : 'var(--paper)', color: recording ? '#fff' : 'var(--ink-soft)', fontSize: 13.5, cursor: 'pointer' }}>
            {recording ? '■' : '🎙'}
          </button>
          <button type="submit" disabled={busy || recording || !input.trim()} style={{ padding: '10px 22px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
            Send
          </button>
        </form>
        <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 6 }}>
          Voice input is transcribed by an AI service; audio is not stored. Consequential actions always ask for your approval first.
        </div>
      </section>
    </div>
  );
}
