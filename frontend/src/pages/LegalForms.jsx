import { useState, useMemo, useCallback } from 'react';
import * as Ic from '../icons.jsx';
import Modal from '../components/Modal.jsx';
import TEMPLATES, { CATEGORIES } from '../data/legalTemplates.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

// ---------------------------------------------------------------------------
// Small helpers — the template catalog ships with the app (src/data), so there
// is no catalog fetch. Only the two drafting actions touch the server.
// ---------------------------------------------------------------------------
function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Render the filled template to the HTML the DOCX exporter expects. Unfilled
// {{tokens}} fall back to a visible [Label] so nothing silently disappears.
function composeHtml(preview, fields, values) {
  const labels = new Map((fields || []).map((f) => [f.key, f.label]));
  return (preview || '')
    .split('\n\n')
    .map((para) => {
      const body = para
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\{\{(\w+)\}\}/g, (_, key) => {
          const v = values[key];
          if (v != null && String(v).trim() !== '') {
            return escapeHtml(String(v)).replace(/\n/g, '<br/>');
          }
          return `[${labels.get(key) || key}]`;
        })
        .replace(/\n/g, '<br/>');
      return `<p>${body}</p>`;
    })
    .join('');
}

const TOKEN_RE = /(\*\*[^*]+\*\*|\{\{\w+\}\})/g;
function renderLine(line, labels, values) {
  return line.split(TOKEN_RE).map((part, i) => {
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} style={{ color: 'var(--ink)' }}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('{{') && part.endsWith('}}')) {
      const key = part.slice(2, -2);
      const v = values[key];
      if (v != null && String(v).trim() !== '') {
        return <span key={i} style={{ color: 'var(--ink)', fontWeight: 600 }}>{v}</span>;
      }
      return (
        <span key={i} className="chip" style={{ fontSize: 11.5, verticalAlign: 'baseline' }}>
          {labels.get(key) || key}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function LivePreview({ preview, fields, values }) {
  const labels = useMemo(() => new Map((fields || []).map((f) => [f.key, f.label])), [fields]);
  const paragraphs = useMemo(() => (preview || '').split('\n\n'), [preview]);
  return (
    <div
      style={{
        background: 'var(--bg-card)', border: '1px solid var(--rule)', borderRadius: 12,
        padding: '24px 26px', fontFamily: 'var(--font-serif)', lineHeight: 1.85,
        fontSize: 13.5, color: 'var(--ink-soft)', maxHeight: '42vh', overflowY: 'auto',
      }}
    >
      {paragraphs.map((para, pi) => {
        const lines = para.split('\n');
        return (
          <p key={pi} style={{ margin: '0 0 14px' }}>
            {lines.map((line, li) => (
              <span key={li}>
                {renderLine(line, labels, values)}
                {li < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

const CAT_FILTERS = ['All', ...CATEGORIES];

// Supreme Court forms available via /api/forms/fetch-dynamic (whitelist mirrors
// the backend's _SC_TITLE_WHITELIST — titles here must contain one of those
// words so the server will serve the matching PDF from sci.gov.in).
// The `title` here is sent verbatim as the `form_title` query to the backend —
// the backend lower-cases it and does a substring match against each row's
// text on sci.gov.in/forms/, so SHORT exact phrases (as the SC Registry
// labels them on its page) match best. The second line (`desc`) is just UI.
const SC_FORMS = [
  { title: 'special leave petition', desc: 'Special Leave Petition form — Part IV of the SC Rules, 2013.' },
  { title: 'writ petition', desc: 'Writ Petition under Article 32 of the Constitution.' },
  { title: 'certified copy', desc: 'Form for applying for certified copies of orders / judgments.' },
  { title: 'listing proforma', desc: 'Required with every matter listed before the SC Registry.' },
  { title: 'mandatory points', desc: 'Mandatory points for hearing (Registry proforma).' },
  { title: 'check list', desc: 'Registry check-list filed with new matters.' },
  { title: 'mentioning matter', desc: 'For urgent mentioning before the Hon\'ble Bench.' },
  { title: 'specimen signature', desc: 'AoR specimen signature form.' },
  { title: 'advocate-on-record', desc: 'Advocate-on-Record engagement form.' },
];

export default function LegalForms() {
  const [mode, setMode] = useState('templates'); // 'templates' | 'court'
  const [tab, setTab] = useState('All');
  const [q, setQ] = useState('');
  const [active, setActive] = useState(null); // the template being filled

  const term = q.trim().toLowerCase();
  const visible = useMemo(
    () =>
      TEMPLATES.filter((t) => {
        if (tab !== 'All' && t.category !== tab) return false;
        if (!term) return true;
        return `${t.title} ${t.category}`.toLowerCase().includes(term);
      }),
    [tab, term]
  );

  const stats = useMemo(
    () => CATEGORIES.map((c) => ({ label: c, num: TEMPLATES.filter((t) => t.category === c).length })),
    []
  );

  return (
    <div className="lx-page lx-rise">
      <div className="lx-between ph" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 18 }}>
        <div>
          <span className="ph__eyebrow">Drafting</span>
          <h1 className="ph__title">Legal Forms</h1>
          <p className="ph__sub">Ready-to-file notices, agreements and petitions — fill the blanks, let AI draft a first pass, and export a clean Word document.</p>
        </div>
        <div className="lx-field" style={{ height: 42, maxWidth: 260 }}>
          <Ic.Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search forms…" style={{ fontSize: 14 }} />
        </div>
      </div>

      {/* Mode tabs */}
      <div className="tabs" style={{ marginBottom: 18 }}>
        <button className={mode === 'templates' ? 'is-on' : ''} onClick={() => setMode('templates')}>Firm templates</button>
        <button className={mode === 'court' ? 'is-on' : ''} onClick={() => setMode('court')}>Supreme Court forms</button>
      </div>

      {mode === 'court' && (
        <section className="lx-stack" style={{ gap: 14 }}>
          <div className="lx-muted" style={{ fontSize: 13 }}>
            Live-fetched directly from the Supreme Court's official forms page (<code style={{ fontSize: 12 }}>sci.gov.in/forms</code>) on each click.
            Opens the PDF in a new tab.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {SC_FORMS.map((f) => {
              const label = f.title.replace(/\b\w/g, (c) => c.toUpperCase());
              return (
                <a key={f.title} href={`${API_BASE}/api/forms/fetch-dynamic?form_title=${encodeURIComponent(f.title)}`}
                   target="_blank" rel="noopener noreferrer"
                   className="lx-card lx-card--pad" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="lx-row" style={{ gap: 10 }}>
                    <div className="lx-item__ico" style={{ width: 36, height: 36 }}><Ic.Doc size={16} /></div>
                    <span className="lx-item__meta" style={{ textTransform: 'uppercase', letterSpacing: '.07em', fontSize: 10 }}>Supreme Court</span>
                  </div>
                  <div style={{ fontFamily: 'var(--font-serif)', fontSize: 16, color: 'var(--ink)' }}>{label}</div>
                  <div className="lx-muted" style={{ fontSize: 12.5, lineHeight: 1.55 }}>{f.desc}</div>
                  <div className="lx-muted" style={{ fontSize: 11.5, marginTop: 'auto', color: 'var(--accent-ink)' }}>↗ Open PDF</div>
                </a>
              );
            })}
          </div>
        </section>
      )}

      {mode === 'templates' && (<>
      {/* Category counts */}
      <section className="lx-stats">
        <div className="lx-stat">
          <div className="lx-stat__ico"><Ic.Doc size={18} /></div>
          <div className="lx-stat__num">{TEMPLATES.length}</div>
          <div className="lx-stat__label">Templates</div>
          <div className="lx-stat__sub">Ready to draft</div>
        </div>
        {stats.map((s) => (
          <div className="lx-stat" key={s.label}>
            <div className="lx-stat__ico"><Ic.Contracts size={18} /></div>
            <div className="lx-stat__num">{s.num}</div>
            <div className="lx-stat__label">{s.label}</div>
            <div className="lx-stat__sub">In this library</div>
          </div>
        ))}
      </section>

      {/* Category filter */}
      <div className="lx-row lx-mt-l" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
        {CAT_FILTERS.map((c) => (
          <button key={c} onClick={() => setTab(c)} className="lx-btn lx-btn--sm"
            style={tab === c ? { background: 'var(--ink)', color: 'var(--paper)' } : { background: 'transparent', color: 'var(--ink-soft)', border: '1px solid var(--rule)' }}>
            {c}
          </button>
        ))}
      </div>

      {/* Template gallery */}
      {visible.length === 0 ? (
        <div className="lx-card lx-card--pad">
          <div className="lx-empty">
            <div className="lx-empty__ico"><Ic.Doc size={22} /></div>
            <h4>No forms match</h4>
            <p>Nothing matches your search or filter yet. Try a broader term.</p>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(268px, 1fr))', gap: 18 }}>
          {visible.map((t) => (
            <button
              key={t.id}
              type="button"
              className="lx-card lx-card--pad lx-forms-card"
              onClick={() => setActive(t)}
              style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 16, font: 'inherit', color: 'inherit' }}
            >
              <div className="lx-row" style={{ gap: 11 }}>
                <div className="lx-item__ico" style={{ width: 38, height: 38 }}><Ic.Contracts size={17} /></div>
                <span className="lx-item__meta" style={{ textTransform: 'uppercase', letterSpacing: '.07em', fontSize: 10 }}>{t.category}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 16.5, lineHeight: 1.35, color: 'var(--ink)', flex: 1 }}>
                {t.title}
              </div>
              <div className="lx-between" style={{ borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
                <span className="lx-item__meta">{(t.fields || []).length} fields</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-ink)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  Start <Ic.Arrow size={13} />
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
      </>)}

      {active && <FillModal template={active} onClose={() => setActive(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fill flow — a template opens into a field form with a live preview, an
// optional AI first-pass, and a real DOCX export.
// ---------------------------------------------------------------------------
function FillModal({ template, onClose }) {
  const fields = template.fields || [];
  const [values, setValues] = useState({});
  const [aiFilled, setAiFilled] = useState(() => new Set());

  const [factsOpen, setFactsOpen] = useState(false);
  const [facts, setFacts] = useState('');
  const [aiBusy, setAiBusy] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [savingLib, setSavingLib] = useState(false);

  const saveToLibrary = useCallback(async () => {
    setSavingLib(true); setError(''); setStatus('');
    try {
      const html = composeHtml(template.preview, fields, values);
      const defaultTitle = `${template.title} — ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`;
      const title = window.prompt('Save this filled form to Firm Library as:', defaultTitle);
      if (!title || !title.trim()) { setSavingLib(false); return; }
      const res = await fetch(`${API_BASE}/api/firm-library`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ title: title.trim(), category: template.category || 'Draft', html }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || (typeof d.error === 'string' ? d.error : 'Could not save to Firm Library.'));
      setStatus(`Saved to Firm Library — appears under “Your library” in the Library page.`);
    } catch (e) { setError(e.message); }
    finally { setSavingLib(false); }
  }, [template, fields, values]);

  const set = (key) => (e) => {
    const v = e.target.value;
    setValues((prev) => ({ ...prev, [key]: v }));
    setAiFilled((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev); next.delete(key); return next;
    });
  };

  const required = fields.filter((f) => f.required);
  const filledRequired = required.filter((f) => values[f.key] && String(values[f.key]).trim() !== '').length;
  const pct = required.length ? Math.round((filledRequired / required.length) * 100) : 100;
  const missing = required.length - filledRequired;

  // AI first pass — fills only empty fields, from the lawyer's pasted facts.
  const runAutofill = useCallback(async () => {
    if (!facts.trim()) return;
    setAiBusy(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/api/contract/autofill-template`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({
          facts,
          schema: fields.map((f) => ({ field_id: f.key, label: f.label, type: f.type, required: f.required })),
        }),
      });
      if (!res.ok) throw new Error(res.status === 401 ? 'Your session has expired. Please sign in again.' : 'autofill');
      const data = await res.json().catch(() => ({}));
      const extracted = data?.fields || {};
      setValues((prev) => {
        const next = { ...prev };
        const touched = new Set(aiFilled);
        fields.forEach((f) => {
          const has = prev[f.key] != null && String(prev[f.key]).trim() !== '';
          const v = extracted[f.key];
          if (!has && v != null && String(v).trim() !== '') {
            next[f.key] = String(v);
            touched.add(f.key);
          }
        });
        setAiFilled(touched);
        return next;
      });
      setFactsOpen(false);
      setStatus('AI filled the empty fields it could infer — review each one before exporting.');
    } catch (e) {
      setError(e.message === 'autofill' ? 'The AI draft could not be generated. You can still fill the fields in by hand.' : e.message);
    } finally {
      setAiBusy(false);
    }
  }, [facts, fields, aiFilled]);

  const exportDocx = useCallback(async () => {
    setExporting(true); setError(''); setStatus('Preparing your Word document…');
    try {
      const html = composeHtml(template.preview, fields, values);
      const res = await fetch(`${API_BASE}/api/contract/export-form-docx`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ html, title: template.title }),
      });
      if (!res.ok) throw new Error(res.status === 401 ? 'Your session has expired. Please sign in again.' : 'export');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${template.title.replace(/[^a-z0-9]+/gi, '_')}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus(`Downloaded “${template.title}.docx”.`);
    } catch (e) {
      setStatus('');
      setError(e.message === 'export' ? 'The document could not be exported. Please try again.' : e.message);
    } finally {
      setExporting(false);
    }
  }, [template, fields, values]);

  return (
    <Modal
      title={template.title}
      onClose={onClose}
      wide
      footer={(
        <>
          <button className="lx-btn lx-btn--ghost" onClick={onClose} disabled={exporting || aiBusy || savingLib}>Close</button>
          <button className="lx-btn lx-btn--ghost" onClick={saveToLibrary} disabled={exporting || aiBusy || savingLib}>
            <Ic.Library size={14} /> {savingLib ? 'Saving…' : 'Save to Firm Library'}
          </button>
          <button className="lx-btn lx-btn--primary" onClick={exportDocx} disabled={exporting || aiBusy || savingLib}>
            <Ic.Doc size={14} /> {exporting ? 'Preparing…' : 'Export DOCX'}
          </button>
        </>
      )}
    >
      <div className="lx-muted" style={{ fontSize: 12.5, marginTop: -4, marginBottom: 14, textTransform: 'uppercase', letterSpacing: '.06em' }}>
        {template.category}
      </div>

      {error && <div role="alert" style={{ marginBottom: 14, color: 'var(--risk)', fontSize: 13 }}>{error}</div>}

      {/* AI first pass */}
      <div className="lx-card lx-card--pad" style={{ marginBottom: 18, padding: 16 }}>
        <div className="lx-between" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: 'var(--accent-ink)', display: 'grid', placeItems: 'center' }}><Ic.Sparkle size={17} /></span>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 14 }}>Draft from facts</div>
              <div className="lx-item__meta">Paste client notes — AI fills the empty fields for you to review.</div>
            </div>
          </div>
          <button className="lx-btn lx-btn--gold lx-btn--sm" onClick={() => setFactsOpen((o) => !o)} disabled={aiBusy}>
            {factsOpen ? 'Hide' : 'Auto-fill with AI'}
          </button>
        </div>
        {factsOpen && (
          <div style={{ marginTop: 14 }}>
            <textarea
              className="inp"
              rows={4}
              value={facts}
              onChange={(e) => setFacts(e.target.value)}
              placeholder="Paste the client's facts, an email thread or your notes. Only empty fields are filled; anything you have typed is left untouched."
              disabled={aiBusy}
              style={{ resize: 'vertical', minHeight: 92 }}
            />
            <div className="lx-row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
              <button className="lx-btn lx-btn--primary lx-btn--sm" onClick={runAutofill} disabled={aiBusy || !facts.trim()}>
                {aiBusy ? 'Extracting…' : 'Extract & fill'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Progress */}
      <div style={{ marginBottom: 18 }}>
        <div className="lx-between" style={{ marginBottom: 7 }}>
          <span className="lx-item__meta">Required fields</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: pct === 100 ? 'var(--ok, var(--accent-ink))' : 'var(--ink-soft)' }}>{filledRequired} of {required.length}</span>
        </div>
        <div style={{ height: 5, background: 'var(--rule)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent-ink)', borderRadius: 3, transition: 'width .25s ease' }} />
        </div>
      </div>

      {/* Fields */}
      <div className="lx-stack" style={{ gap: 16 }}>
        {fields.map((f) => {
          const isAi = aiFilled.has(f.key) && !!values[f.key];
          return (
            <div key={f.key}>
              <label className="lbl" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>{f.label}{f.required ? <span style={{ color: 'var(--accent-ink)' }}> *</span> : <span className="lx-muted" style={{ fontWeight: 400 }}> (optional)</span>}</span>
                {isAi && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, color: 'var(--accent-ink)' }}><Ic.Sparkle size={11} /> AI filled</span>}
              </label>
              {(() => {
                // Tint AI-filled inputs so the lawyer visibly sees what to review.
                const aiStyle = isAi ? { borderColor: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 6%, transparent)' } : {};
                if (f.type === 'textarea') return <textarea className="inp" rows={3} value={values[f.key] || ''} onChange={set(f.key)} placeholder={f.label} style={{ resize: 'vertical', minHeight: 72, ...aiStyle }} />;
                if (f.type === 'date') return <input className="inp" type="date" value={values[f.key] || ''} onChange={set(f.key)} style={aiStyle} />;
                if (f.type === 'number') return <input className="inp" type="text" inputMode="numeric" value={values[f.key] || ''} onChange={set(f.key)} placeholder="0" style={aiStyle} />;
                return <input className="inp" type="text" value={values[f.key] || ''} onChange={set(f.key)} placeholder={f.label} style={aiStyle} />;
              })()}
            </div>
          );
        })}
      </div>

      {/* Live preview */}
      <div style={{ marginTop: 22 }}>
        <div className="lx-section-head" style={{ marginBottom: 12 }}><h3>Live preview</h3></div>
        <LivePreview preview={template.preview} fields={fields} values={values} />
        {missing > 0 && (
          <p className="lx-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            {missing} required field{missing === 1 ? '' : 's'} still empty — the export keeps a visible [placeholder] until each is filled.
          </p>
        )}
        {status && <p style={{ fontSize: 12.5, marginTop: 10, color: 'var(--ink-soft)', fontStyle: 'italic' }}>{status}</p>}
      </div>
    </Modal>
  );
}
