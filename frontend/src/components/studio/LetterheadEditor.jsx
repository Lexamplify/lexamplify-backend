import { useState, useEffect, useRef } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

/** Visual preview of an uploaded .docx template. Hits the backend, which
 * uses Word COM on Windows (or LibreOffice headless) to rasterise page 1
 * to PNG. The first render is slow (~15–25s cold start) because Word has to
 * spin up — a spinner + hint explain the wait. The image is cached by both
 * the browser (10 min) and the backend (content-hashed). */
function TemplatePreview({ letterheadId, templateName, templateFile }) {
  const [state, setState] = useState('idle'); // idle | loading | ok | error
  const [pngUrl, setPngUrl] = useState(null);
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    // Nothing selected/saved → nothing to preview.
    if (!templateFile && (!letterheadId || !templateName)) {
      setState('idle'); setPngUrl(null); return;
    }
    let cancelled = false;
    setState('loading'); setPngUrl(null); setErrMsg('');
    (async () => {
      try {
        let res;
        if (templateFile) {
          // A file was just selected but not saved yet → POST it so the
          // user sees a preview immediately (before Save).
          const fd = new FormData();
          fd.append('template', templateFile);
          res = await fetch(`${API_BASE}/api/letterheads/template-preview.png`, {
            method: 'POST', credentials: 'include',
            headers: { 'X-CSRF-TOKEN': csrf() },
            body: fd,
          });
        } else {
          // Editing a saved letterhead with an already-stored template.
          const url = `${API_BASE}/api/letterheads/${letterheadId}/template-preview.png?t=${Date.now()}`;
          res = await fetch(url, { credentials: 'include' });
        }
        if (!res.ok) {
          let msg = `Preview unavailable (${res.status})`;
          try { const j = await res.json(); if (j?.message) msg = j.message; } catch {}
          if (!cancelled) { setState('error'); setErrMsg(msg); }
          return;
        }
        const blob = await res.blob();
        const obj = URL.createObjectURL(blob);
        if (cancelled) { URL.revokeObjectURL(obj); return; }
        setPngUrl(obj); setState('ok');
      } catch (e) {
        if (!cancelled) { setState('error'); setErrMsg(e.message || 'Preview failed.'); }
      }
    })();
    return () => { cancelled = true; if (pngUrl) URL.revokeObjectURL(pngUrl); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letterheadId, templateName, templateFile]);

  if (state === 'idle') return null;

  const wrap = {
    marginTop: 14, border: '1px solid var(--rule)', borderRadius: 10,
    overflow: 'hidden', background: 'var(--paper)',
  };
  const header = {
    fontSize: 11, fontWeight: 600, color: 'var(--ink-soft)', letterSpacing: 0.4,
    textTransform: 'uppercase', padding: '8px 12px', borderBottom: '1px solid var(--rule)',
    background: 'color-mix(in srgb, var(--accent) 4%, var(--paper))',
  };

  return (
    <div style={wrap}>
      <div style={header}>Live preview — page 1</div>
      <div style={{ padding: 12, minHeight: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {state === 'loading' && (
          <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
            <div className="ads-lhe__spinner" aria-hidden="true" />
            Rendering page 1… first open can take 15–25 s.
          </div>
        )}
        {state === 'error' && (
          <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', maxWidth: 320 }}>
            {errMsg}
            <div style={{ marginTop: 6, fontSize: 11 }}>
              Install <strong>LibreOffice</strong> or ensure <strong>MS Word</strong> is installed on the server for visual previews.
            </div>
          </div>
        )}
        {state === 'ok' && pngUrl && (
          <img src={pngUrl} alt="Template page 1 preview"
               style={{ maxWidth: '100%', height: 'auto', boxShadow: '0 2px 10px rgba(0,0,0,0.08)', borderRadius: 4 }} />
        )}
      </div>
    </div>
  );
}

const FIELD = { display: 'block', marginBottom: 10 };
const LABEL = { fontSize: 12, color: 'var(--ink)', fontWeight: 600, marginBottom: 3, display: 'block' };
const HINT = { fontWeight: 400, color: 'var(--muted)', fontSize: 11 };
const INPUT = {
  width: '100%', height: 36, border: '1px solid var(--rule)', borderRadius: 8,
  padding: '0 10px', fontSize: 13, color: 'var(--ink)', background: 'var(--bg)',
};
const TEXTAREA = { ...INPUT, height: 'auto', padding: '8px 10px', fontFamily: 'inherit', resize: 'vertical' };

const TEMPLATES = [
  { name: 'Classic Navy', accent: '#1A2E4A', design: 'classic', tagline: 'Advocates & Legal Consultants' },
  { name: 'Classic Burgundy', accent: '#6B1D2A', design: 'classic', tagline: 'Advocates, Solicitors & Notaries' },
  { name: 'Classic Green', accent: '#1B4332', design: 'classic', tagline: 'Legal Practitioners' },
  { name: 'Navy Band', accent: '#1A2E4A', design: 'band', tagline: 'Advocates & Legal Consultants' },
  { name: 'Burgundy Band', accent: '#6B1D2A', design: 'band', tagline: 'Advocates, Solicitors & Notaries' },
  { name: 'Charcoal Band', accent: '#2D3436', design: 'band', tagline: 'Law Offices' },
  { name: 'Teal Band', accent: '#0D4F4F', design: 'band', tagline: 'Advocates & Arbitrators' },
  { name: 'Modern Navy', accent: '#1A2E4A', design: 'border', tagline: 'Advocates & Legal Consultants' },
  { name: 'Modern Slate', accent: '#34495E', design: 'border', tagline: 'Advocates & Consultants' },
  { name: 'Modern Copper', accent: '#8B4513', design: 'border', tagline: 'Advocates & Mediators' },
  { name: 'Dual Navy', accent: '#1A2E4A', design: 'dual-tone', tagline: 'Advocates & Legal Consultants' },
  { name: 'Dual Burgundy', accent: '#6B1D2A', design: 'dual-tone', tagline: 'Advocates, Solicitors & Notaries' },
  { name: 'Dual Forest', accent: '#1B4332', design: 'dual-tone', tagline: 'Legal Practitioners' },
  { name: 'Dual Gold', accent: '#8B6914', design: 'dual-tone', tagline: 'Attorneys at Law' },
];

const BAR_COUNCILS = [
  'Bar Council of India',
  'Bar Council of Delhi', 'Bar Council of Maharashtra & Goa',
  'Bar Council of Tamil Nadu', 'Bar Council of Karnataka',
  'Bar Council of West Bengal', 'Bar Council of Uttar Pradesh',
  'Bar Council of Gujarat', 'Bar Council of Rajasthan',
  'Bar Council of Madhya Pradesh', 'Bar Council of Kerala',
  'Bar Council of Andhra Pradesh & Telangana',
  'Bar Council of Punjab & Haryana', 'Bar Council of Bihar',
  'Bar Council of Odisha', 'Bar Council of Jharkhand',
  'Bar Council of Assam, Nagaland, Meghalaya, Manipur, Tripura, Mizoram & Arunachal Pradesh',
  'Bar Council of Himachal Pradesh', 'Bar Council of Uttarakhand',
  'Bar Council of Chhattisgarh', 'Bar Council of Jammu & Kashmir & Ladakh',
  'Bar Council of Goa',
];

export default function LetterheadEditor({ letterhead, onSave, onClose }) {
  const isEdit = !!letterhead?.id;
  const [mode, setMode] = useState(() =>
    letterhead?.template_docx ? 'template' : letterhead?.header_image ? 'upload' : 'fields');
  const [form, setForm] = useState({
    name: '', tagline: '', address: '', contact: '', footer: '',
    enrolment_number: '', bar_council: '', courts: '', qualifications: '',
    gstin: '', ref_format: '', accent_color: '#1A2E4A', design: 'classic',
  });
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [headerFile, setHeaderFile] = useState(null);
  const [headerPreview, setHeaderPreview] = useState(null);
  const [templateFile, setTemplateFile] = useState(null);
  const [templateName, setTemplateName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const headerRef = useRef(null);
  const templateRef = useRef(null);

  useEffect(() => {
    if (letterhead) {
      setForm({
        name: letterhead.name || '',
        tagline: letterhead.tagline || '',
        address: letterhead.address || '',
        contact: letterhead.contact || '',
        footer: letterhead.footer || '',
        enrolment_number: letterhead.enrolment_number || '',
        bar_council: letterhead.bar_council || '',
        courts: letterhead.courts || '',
        qualifications: letterhead.qualifications || '',
        gstin: letterhead.gstin || '',
        ref_format: letterhead.ref_format || '',
        accent_color: letterhead.accent_color || '#1A2E4A',
        design: letterhead.design || 'classic',
      });
      if (letterhead.logo_path) {
        setLogoPreview(`${API_BASE}/api/letterheads/${letterhead.id}/logo?t=${Date.now()}`);
      }
      if (letterhead.header_image) {
        setHeaderPreview(`${API_BASE}/api/letterheads/${letterhead.id}/header-image?t=${Date.now()}`);
        setMode('upload');
      }
      if (letterhead.template_docx) {
        setTemplateName(letterhead.template_docx.split(/[\\/]/).pop() || 'template.docx');
        setMode('template');
      }
    }
  }, [letterhead]);

  function set(key, val) { setForm((f) => ({ ...f, [key]: val })); }

  function onLogoSelect(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { setError('Logo must be under 2 MB.'); return; }
    setLogoFile(f);
    setLogoPreview(URL.createObjectURL(f));
  }

  function onHeaderSelect(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { setError('Header image must be under 5 MB.'); return; }
    setHeaderFile(f);
    setHeaderPreview(URL.createObjectURL(f));
  }

  function onTemplateSelect(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.docx')) { setError('Please upload a Word .docx file.'); return; }
    if (f.size > 10 * 1024 * 1024) { setError('Template must be under 10 MB.'); return; }
    setError('');
    setTemplateFile(f);
    setTemplateName(f.name);
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Firm name is required.'); return; }
    setSaving(true); setError('');
    try {
      const url = isEdit ? `${API_BASE}/api/letterheads/${letterhead.id}` : `${API_BASE}/api/letterheads`;
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method, credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Save failed (${res.status})`);
      }
      const d = await res.json();
      let saved = d.letterhead || d;

      if (logoFile && saved.id) {
        const fd = new FormData();
        fd.append('logo', logoFile);
        const lr = await fetch(`${API_BASE}/api/letterheads/${saved.id}/logo`, {
          method: 'POST', credentials: 'include',
          headers: { 'X-CSRF-TOKEN': csrf() },
          body: fd,
        });
        if (lr.ok) {
          const ld = await lr.json();
          saved = ld.letterhead || saved;
        }
      }
      if (headerFile && saved.id) {
        const fd = new FormData();
        fd.append('header_image', headerFile);
        const hr = await fetch(`${API_BASE}/api/letterheads/${saved.id}/header-image`, {
          method: 'POST', credentials: 'include',
          headers: { 'X-CSRF-TOKEN': csrf() },
          body: fd,
        });
        if (hr.ok) {
          const hd = await hr.json();
          saved = hd.letterhead || saved;
        }
      }
      if (templateFile && saved.id) {
        const fd = new FormData();
        fd.append('template', templateFile);
        const tr = await fetch(`${API_BASE}/api/letterheads/${saved.id}/template-docx`, {
          method: 'POST', credentials: 'include',
          headers: { 'X-CSRF-TOKEN': csrf() },
          body: fd,
        });
        if (tr.ok) {
          const td = await tr.json();
          saved = td.letterhead || saved;
        } else {
          const tb = await tr.json().catch(() => ({}));
          throw new Error(tb.message || 'Template upload failed.');
        }
      }
      // When saving in 'fields' or 'upload' mode, clear any previously
      // uploaded Word template so the design/color fields actually win
      // on export. template_docx takes priority in the export engine.
      if (mode !== 'template' && saved.id && saved.template_docx) {
        try {
          const dr = await fetch(`${API_BASE}/api/letterheads/${saved.id}/template-docx`, {
            method: 'DELETE', credentials: 'include',
            headers: { 'X-CSRF-TOKEN': csrf() },
          });
          if (dr.ok) {
            const dd = await dr.json().catch(() => ({}));
            saved = dd.letterhead || { ...saved, template_docx: null };
          }
        } catch {}
      }
      onSave(saved);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const accent = form.accent_color || '#1A2E4A';

  return (
    <div className="ads-lhe-overlay" onClick={() => !saving && onClose()}>
      <div className="ads-lhe" onClick={(e) => e.stopPropagation()}>
        <div className="ads-lhe__cols">
          {/* Left: Form */}
          <div className="ads-lhe__form">
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)', marginBottom: 2 }}>
              {isEdit ? 'Edit letterhead' : 'Create firm letterhead'}
            </div>

            {/* Mode toggle */}
            <div className="ads-lhe__mode-tabs">
              <button type="button" className={`ads-lhe__mode-tab ${mode === 'fields' ? 'ads-lhe__mode-tab--active' : ''}`} onClick={() => setMode('fields')}>
                Build from fields
              </button>
              <button type="button" className={`ads-lhe__mode-tab ${mode === 'upload' ? 'ads-lhe__mode-tab--active' : ''}`} onClick={() => setMode('upload')}>
                Header image
              </button>
              <button type="button" className={`ads-lhe__mode-tab ${mode === 'template' ? 'ads-lhe__mode-tab--active' : ''}`} onClick={() => setMode('template')}>
                Word template
              </button>
            </div>

            {mode === 'template' && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 4, lineHeight: 1.5 }}>
                  Upload one Word <strong>.docx</strong> letterhead template. Design it once in Word — header, footer, logo, colours and page numbers — and it is used exactly as made. The drafted letter is poured into the body on export.
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.5, padding: '8px 10px', background: 'color-mix(in srgb, var(--accent) 6%, var(--paper))', borderRadius: 8 }}>
                  <strong>Tip:</strong> In Word, put your design in <em>Insert → Header</em> and <em>Insert → Footer</em> (not the page body). Leave the body empty — that is where your letter text goes.
                </div>
                <label style={FIELD}>
                  <span style={LABEL}>Firm / advocate name *</span>
                  <input style={INPUT} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Khare & Associates" autoFocus />
                </label>
                <div style={{ marginBottom: 10 }}>
                  <span style={LABEL}>Letterhead template <span style={HINT}>(.docx, max 10 MB)</span></span>
                  <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => templateRef.current?.click()}>
                      {templateName ? 'Change .docx' : 'Upload .docx template'}
                    </button>
                    <input ref={templateRef} type="file" accept=".docx" style={{ display: 'none' }} onChange={onTemplateSelect} />
                    {templateName && (
                      <span style={{ fontSize: 12, color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
                        {templateName}
                      </span>
                    )}
                  </div>
                </div>
                <TemplatePreview letterheadId={letterhead?.id} templateName={templateName} templateFile={templateFile} />
              </div>
            )}

            {mode === 'upload' && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 10 }}>
                  Upload your existing letterhead header as an image (PNG/JPG, max 5 MB). This will be used as-is in the document header.
                </div>
                <label style={FIELD}>
                  <span style={LABEL}>Firm / advocate name *</span>
                  <input style={INPUT} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Khare & Associates" autoFocus />
                </label>
                <div style={{ marginBottom: 10 }}>
                  <span style={LABEL}>Header image <span style={HINT}>(PNG/JPG, max 5 MB)</span></span>
                  <div style={{ marginTop: 6 }}>
                    <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => headerRef.current?.click()}>
                      {headerPreview ? 'Change image' : 'Upload header image'}
                    </button>
                    <input ref={headerRef} type="file" accept=".png,.jpg,.jpeg" style={{ display: 'none' }} onChange={onHeaderSelect} />
                  </div>
                  {headerPreview && (
                    <div style={{ marginTop: 10, border: '1px solid var(--rule)', borderRadius: 6, overflow: 'hidden' }}>
                      <img src={headerPreview} alt="Header preview" style={{ width: '100%', display: 'block' }} />
                    </div>
                  )}
                </div>
                <label style={FIELD}>
                  <span style={LABEL}>Footer text <span style={HINT}>(optional)</span></span>
                  <input style={INPUT} value={form.footer} onChange={(e) => set('footer', e.target.value)} placeholder="e.g. Confidential & privileged" />
                </label>
              </div>
            )}

            {mode === 'fields' && <>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 10 }}>
              Pick a style template or build your own. All fields except firm name are optional.
            </div>
            <div className="ads-lhe__templates">
              {TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  className={`ads-lhe__tpl${accent === t.accent && form.design === t.design ? ' ads-lhe__tpl--active' : ''}`}
                  onClick={() => { set('accent_color', t.accent); set('design', t.design); if (!form.tagline) set('tagline', t.tagline); }}
                  title={t.name}
                >
                  <span className={`ads-lhe__tpl-mini ads-lhe__tpl-mini--${t.design}`} style={{ '--ta': t.accent }}>
                    <span className="ads-lhe__tpl-mini-hdr" />
                    <span className="ads-lhe__tpl-mini-body" />
                    <span className="ads-lhe__tpl-mini-ftr" />
                  </span>
                  <span className="ads-lhe__tpl-name">{t.name}</span>
                </button>
              ))}
            </div>

            <div className="ads-lhe__section-label">Firm details</div>
            <label style={FIELD}>
              <span style={LABEL}>Firm / advocate name *</span>
              <input style={INPUT} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Khare & Associates" autoFocus />
            </label>
            <label style={FIELD}>
              <span style={LABEL}>Designation / tagline</span>
              <input style={INPUT} value={form.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="e.g. Advocates & Legal Consultants" />
            </label>
            <label style={FIELD}>
              <span style={LABEL}>Address <span style={HINT}>(newlines OK)</span></span>
              <textarea style={TEXTAREA} rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Chamber No. 7B, Tis Hazari Courts&#10;Delhi 110054" />
            </label>
            <label style={FIELD}>
              <span style={LABEL}>Phone / email</span>
              <input style={INPUT} value={form.contact} onChange={(e) => set('contact', e.target.value)} placeholder="+91 11 2345 6789 · contact@firm.com" />
            </label>

            <div className="ads-lhe__section-label" style={{ marginTop: 10 }}>Indian Bar Council compliance</div>
            <label style={FIELD}>
              <span style={LABEL}>Enrolment number</span>
              <input style={INPUT} value={form.enrolment_number} onChange={(e) => set('enrolment_number', e.target.value)} placeholder="e.g. D/1234/2015" />
            </label>
            <label style={FIELD}>
              <span style={LABEL}>State Bar Council</span>
              <select style={{ ...INPUT, cursor: 'pointer' }} value={form.bar_council} onChange={(e) => set('bar_council', e.target.value)}>
                <option value="">— Select —</option>
                {BAR_COUNCILS.map((bc) => <option key={bc} value={bc}>{bc}</option>)}
              </select>
            </label>
            <label style={FIELD}>
              <span style={LABEL}>Courts of practice <span style={HINT}>(comma-separated)</span></span>
              <input style={INPUT} value={form.courts} onChange={(e) => set('courts', e.target.value)} placeholder="Supreme Court, Delhi High Court, District Courts" />
            </label>
            <label style={FIELD}>
              <span style={LABEL}>Qualifications</span>
              <input style={INPUT} value={form.qualifications} onChange={(e) => set('qualifications', e.target.value)} placeholder="B.A. LL.B., LL.M. (Delhi University)" />
            </label>

            <div className="ads-lhe__section-label" style={{ marginTop: 10 }}>Optional</div>
            <label style={FIELD}>
              <span style={LABEL}>GSTIN</span>
              <input style={INPUT} value={form.gstin} onChange={(e) => set('gstin', e.target.value)} placeholder="22AAAAA0000A1Z5" />
            </label>
            <label style={FIELD}>
              <span style={LABEL}>Reference format</span>
              <input style={INPUT} value={form.ref_format} onChange={(e) => set('ref_format', e.target.value)} placeholder="e.g. KA/YYYY/NNNN" />
            </label>
            <label style={FIELD}>
              <span style={LABEL}>Footer text <span style={HINT}>(defaults to firm name)</span></span>
              <input style={INPUT} value={form.footer} onChange={(e) => set('footer', e.target.value)} placeholder="e.g. Confidential & privileged" />
            </label>

            <div className="ads-lhe__section-label" style={{ marginTop: 10 }}>Design</div>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <span style={LABEL}>Accent colour</span>
                <input type="color" value={accent} onChange={(e) => set('accent_color', e.target.value)} style={{ width: 32, height: 28, border: 'none', cursor: 'pointer', background: 'transparent' }} />
              </label>
            </div>
            <div style={{ marginBottom: 14 }}>
              <span style={LABEL}>Firm logo <span style={HINT}>(PNG/JPG/SVG, max 2 MB)</span></span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => fileRef.current?.click()}>
                  {logoPreview ? 'Change logo' : 'Upload logo'}
                </button>
                <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.svg" style={{ display: 'none' }} onChange={onLogoSelect} />
                {logoPreview && <img src={logoPreview} alt="logo" style={{ height: 28, borderRadius: 4 }} />}
              </div>
            </div>
            </>}

            {error && <div role="alert" style={{ color: 'var(--risk)', fontSize: 13, marginBottom: 8 }}>{error}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
              <button className="lx-btn lx-btn--ghost" onClick={() => !saving && onClose()} disabled={saving}>Cancel</button>
              <button className="lx-btn lx-btn--primary" onClick={handleSave} disabled={saving || !form.name.trim()}>
                {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Create letterhead')}
              </button>
            </div>
          </div>

          {/* Right: Live A4 preview */}
          <div className="ads-lhe__preview-wrap">
            <div className="ads-lhe__preview-label">Live preview</div>
            {mode === 'template' ? (
            <div className="ads-lhe__a4" style={{ '--lh-accent': accent, justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 12 }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h8M8 9h2"/></svg>
              <div style={{ fontSize: 13, fontWeight: 700, color: accent }}>{templateName || 'No template yet'}</div>
              <div style={{ fontSize: 10, color: '#777', lineHeight: 1.5, maxWidth: 200 }}>
                {templateName
                  ? 'Your Word template is used exactly as designed. Header, footer and page numbers come from the file; your letter fills the body.'
                  : 'Upload a .docx letterhead template to use it as-is for every exported draft.'}
              </div>
            </div>
            ) : (
            <div className="ads-lhe__a4" style={{ '--lh-accent': accent }}>
              {/* Header — uploaded image or design-based */}
              {mode === 'upload' && headerPreview ? (
                <img src={headerPreview} alt="Letterhead header" style={{ width: '100%', display: 'block', borderRadius: 2 }} />
              ) : form.design === 'band' ? (
                <div className="ads-lhe__a4-band" style={{ background: accent }}>
                  <div className="ads-lhe__a4-band-firm">{form.name || 'Firm Name'}</div>
                  {form.tagline && <div className="ads-lhe__a4-band-tag">{form.tagline}</div>}
                  {form.enrolment_number && <div className="ads-lhe__a4-band-detail">Enrolment No. {form.enrolment_number}{form.bar_council ? `   |   ${form.bar_council}` : ''}</div>}
                </div>
              ) : form.design === 'border' ? (
                <div className="ads-lhe__a4-lborder" style={{ borderLeftColor: accent }}>
                  <div className="ads-lhe__a4-firm" style={{ color: accent, textAlign: 'left' }}>{form.name || 'Firm Name'}</div>
                  {form.tagline && <div className="ads-lhe__a4-tag" style={{ textAlign: 'left' }}>{form.tagline}</div>}
                  {form.qualifications && <div className="ads-lhe__a4-small" style={{ textAlign: 'left' }}>{form.qualifications}</div>}
                  {form.enrolment_number && <div className="ads-lhe__a4-small" style={{ textAlign: 'left' }}>Enrolment No. {form.enrolment_number}{form.bar_council ? `   |   ${form.bar_council}` : ''}</div>}
                  {form.courts && <div className="ads-lhe__a4-small" style={{ textAlign: 'left' }}>Practising before: {form.courts}</div>}
                  {(form.address || form.contact) && <div className="ads-lhe__a4-contact" style={{ textAlign: 'left' }}>{[form.address ? form.address.split('\n').map(l => l.trim()).filter(Boolean).join('   ') : '', form.contact || ''].filter(Boolean).join('    |    ')}</div>}
                </div>
              ) : form.design === 'dual-tone' ? (<>
                <div className="ads-lhe__a4-band" style={{ background: accent }}>
                  <div className="ads-lhe__a4-band-firm">{form.name || 'Firm Name'}</div>
                  {form.tagline && <div className="ads-lhe__a4-band-tag">{form.tagline}</div>}
                </div>
                <div className="ads-lhe__a4-dualstrip" style={{ background: `color-mix(in srgb, ${accent} 70%, white)` }}>
                  <span style={{ color: '#fff', fontSize: 8 }}>{(form.address || '').split('\n').filter(Boolean).join('  ') || form.contact || ''}</span>
                </div>
              </>) : (<>
                <div className={`ads-lhe__a4-header${logoPreview ? ' ads-lhe__a4-header--with-logo' : ''}`}>
                  {logoPreview && <img src={logoPreview} alt="" className="ads-lhe__a4-logo" />}
                  <div className="ads-lhe__a4-info">
                    <div className="ads-lhe__a4-firm" style={{ color: accent }}>{form.name || 'Firm Name'}</div>
                    {form.tagline && <div className="ads-lhe__a4-tag">{form.tagline}</div>}
                    {form.qualifications && <div className="ads-lhe__a4-small">{form.qualifications}</div>}
                    {form.enrolment_number && (
                      <div className="ads-lhe__a4-small">
                        Enrolment No. {form.enrolment_number}
                        {form.bar_council ? `   |   ${form.bar_council}` : ''}
                      </div>
                    )}
                    {form.courts && <div className="ads-lhe__a4-small">Practising before: {form.courts}</div>}
                  </div>
                </div>
              </>)}

              {/* Contact details for classic & uploaded modes */}
              {!(mode === 'upload' && headerPreview) && form.design === 'classic' && <>
                <div className="ads-lhe__a4-rule" />
                {(form.address || form.contact) && (
                  <div className="ads-lhe__a4-contact">
                    {[
                      form.address ? form.address.split('\n').map(l => l.trim()).filter(Boolean).join('   ') : '',
                      form.contact || '',
                    ].filter(Boolean).join('    |    ')}
                  </div>
                )}
                {form.gstin && <div className="ads-lhe__a4-gstin">GSTIN: {form.gstin}</div>}
              </>}
              {/* Contact below band */}
              {form.design === 'band' && (form.address || form.contact) && (
                <div className="ads-lhe__a4-contact">{[form.address ? form.address.split('\n').map(l => l.trim()).filter(Boolean).join('   ') : '', form.contact || ''].filter(Boolean).join('    |    ')}</div>
              )}

              {/* Body placeholder */}
              <div className="ads-lhe__a4-body">
                {form.ref_format && <div style={{ fontSize: 8, color: '#888', marginBottom: 6 }}>Ref: {form.ref_format}</div>}
                <div className="ads-lhe__a4-line" style={{ width: '90%' }} />
                <div className="ads-lhe__a4-line" style={{ width: '100%' }} />
                <div className="ads-lhe__a4-line" style={{ width: '75%' }} />
                <div className="ads-lhe__a4-line" style={{ width: '95%' }} />
                <div className="ads-lhe__a4-line" style={{ width: '60%' }} />
              </div>

              {/* Footer */}
              <div className="ads-lhe__a4-footer">
                {(form.design === 'band' || form.design === 'dual-tone') ? (
                  <div className="ads-lhe__a4-foot-band" style={{ background: accent }}>
                    <span style={{ color: '#fff', fontWeight: 700, fontSize: 6.5 }}>PRIVILEGED &amp; CONFIDENTIAL</span>
                    <span style={{ color: '#ddd' }}>{form.footer || form.name || 'Firm Name'}</span>
                    <span style={{ color: '#fff' }}>Page 1 of 1</span>
                  </div>
                ) : form.design === 'border' ? (<>
                  <div className="ads-lhe__a4-foot-rule" />
                  <div className="ads-lhe__a4-foot-row" style={{ borderLeft: `3px solid ${accent}`, paddingLeft: 6 }}>
                    <span className="ads-lhe__a4-foot-conf">PRIVILEGED &amp; CONFIDENTIAL</span>
                    <span>{form.footer || form.name || 'Firm Name'}</span>
                    <span>Page 1 of 1</span>
                  </div>
                </>) : (<>
                  <div className="ads-lhe__a4-foot-rule" />
                  <div className="ads-lhe__a4-foot-row">
                    <span className="ads-lhe__a4-foot-conf">PRIVILEGED &amp; CONFIDENTIAL</span>
                    <span>{form.footer || form.name || 'Firm Name'}</span>
                    <span>Page 1 of 1</span>
                  </div>
                </>)}
              </div>
            </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
