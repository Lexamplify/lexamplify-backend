import { useState, useEffect, useRef } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

const FIELD = { display: 'block', marginBottom: 10 };
const LABEL = { fontSize: 12, color: 'var(--ink)', fontWeight: 600, marginBottom: 3, display: 'block' };
const HINT = { fontWeight: 400, color: 'var(--muted)', fontSize: 11 };
const INPUT = {
  width: '100%', height: 36, border: '1px solid var(--rule)', borderRadius: 8,
  padding: '0 10px', fontSize: 13, color: 'var(--ink)', background: 'var(--bg)',
};
const TEXTAREA = { ...INPUT, height: 'auto', padding: '8px 10px', fontFamily: 'inherit', resize: 'vertical' };

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
  const [mode, setMode] = useState(() => letterhead?.header_image ? 'upload' : 'fields');
  const [form, setForm] = useState({
    name: '', tagline: '', address: '', contact: '', footer: '',
    enrolment_number: '', bar_council: '', courts: '', qualifications: '',
    gstin: '', ref_format: '', accent_color: '#1A2E4A',
  });
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [headerFile, setHeaderFile] = useState(null);
  const [headerPreview, setHeaderPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const headerRef = useRef(null);

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
      });
      if (letterhead.logo_path) {
        setLogoPreview(`${API_BASE}/api/letterheads/${letterhead.id}/logo?t=${Date.now()}`);
      }
      if (letterhead.header_image) {
        setHeaderPreview(`${API_BASE}/api/letterheads/${letterhead.id}/header-image?t=${Date.now()}`);
        setMode('upload');
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
                Upload image
              </button>
            </div>

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
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 14 }}>
              Indian advocate compliance fields included. All fields except firm name are optional.
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
            <div className="ads-lhe__a4" style={{ '--lh-accent': accent }}>
              {/* Header — uploaded image or field-based */}
              {mode === 'upload' && headerPreview ? (
                <div className="ads-lhe__a4-header">
                  <img src={headerPreview} alt="Letterhead header" style={{ width: '100%', display: 'block', borderRadius: 2 }} />
                </div>
              ) : (
              <div className="ads-lhe__a4-header">
                {logoPreview && <img src={logoPreview} alt="" className="ads-lhe__a4-logo" />}
                <div className="ads-lhe__a4-firm" style={{ color: accent }}>{form.name || 'Firm Name'}</div>
                {form.tagline && <div className="ads-lhe__a4-tag">{form.tagline}</div>}
                {form.qualifications && <div className="ads-lhe__a4-small">{form.qualifications}</div>}
                {form.enrolment_number && (
                  <div className="ads-lhe__a4-small">
                    Enrolment: {form.enrolment_number}
                    {form.bar_council ? ` · ${form.bar_council}` : ''}
                  </div>
                )}
                {form.courts && <div className="ads-lhe__a4-small">Courts: {form.courts}</div>}
                {form.address && <div className="ads-lhe__a4-addr">{form.address}</div>}
                {form.contact && <div className="ads-lhe__a4-small">{form.contact}</div>}
                {form.gstin && <div className="ads-lhe__a4-small" style={{ fontSize: 7.5 }}>GSTIN: {form.gstin}</div>}
              </div>
              )}
              <div className="ads-lhe__a4-rule" style={{ borderColor: accent }} />
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
                <div className="ads-lhe__a4-rule" style={{ borderColor: accent }} />
                <div className="ads-lhe__a4-foot-row">
                  <span>{form.footer || form.name || 'Firm Name'}</span>
                  <span>Page 1 of 1</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
