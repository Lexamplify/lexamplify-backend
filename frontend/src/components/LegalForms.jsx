import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TEMPLATES, { CATEGORIES } from '../data/templateData.js';
import { escapeHtml } from '../tiptap/textToHtml.js';

const API_BASE = 'http://localhost:5000';
const FIELD_TOKEN_RE = /\{\{(\w+)\}\}/g;

// Pure string substitution — {{field_id}} is a plain token, not a templating
// engine, so there is no risk of arbitrary code execution from a template
// string. Values are HTML-escaped before insertion since they can come from
// free-typed user input OR the AI auto-filler; either could contain
// characters that would otherwise break the surrounding markup.
function fillTemplate(htmlTemplate, values) {
  return htmlTemplate.replace(FIELD_TOKEN_RE, (match, fieldId) => {
    const raw = values[fieldId];
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return `<span class="lf-placeholder">[${escapeHtml(fieldId)}]</span>`;
    }
    return escapeHtml(String(raw)).replace(/\n/g, '<br/>');
  });
}

const styles = `
  .lf-shell { padding: 24px 28px; max-width: 1400px; margin: 0 auto; }
  .lf-header { margin-bottom: 20px; }
  .lf-title { font-size: 22px; font-weight: 700; color: var(--text-dark-primary); margin: 0 0 4px; }
  .lf-subtitle { font-size: 13px; color: var(--text-dark-muted); margin: 0; }

  .lf-category-tabs { display: flex; gap: 8px; margin: 18px 0; flex-wrap: wrap; }
  .lf-category-tab {
    padding: 7px 14px; border-radius: 20px; font-size: 12.5px; font-weight: 600;
    background: rgba(255,255,255,0.04); border: 1px solid var(--border-dark-subtle);
    color: var(--text-dark-muted); cursor: pointer; transition: all 0.15s; font-family: inherit;
  }
  .lf-category-tab:hover { background: rgba(59,130,246,0.08); color: var(--text-dark-primary); }
  .lf-category-tab.active { background: rgba(59,130,246,0.15); border-color: rgba(59,130,246,0.45); color: #93C5FD; }

  .lf-template-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
  .lf-template-card {
    background: var(--bg-dark-panel); border: 1px solid var(--border-dark-subtle);
    border-radius: 12px; padding: 18px; cursor: pointer; transition: all 0.18s;
    display: flex; flex-direction: column; gap: 8px;
  }
  .lf-template-card:hover { border-color: rgba(59,130,246,0.4); transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.25); }
  .lf-template-card-cat { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #93C5FD; }
  .lf-template-card-title { font-size: 15px; font-weight: 600; color: var(--text-dark-primary); }
  .lf-template-card-meta { font-size: 11.5px; color: var(--text-dark-muted); }

  .lf-workspace { display: grid; grid-template-columns: 380px 1fr; gap: 20px; align-items: start; }
  @media (max-width: 900px) { .lf-workspace { grid-template-columns: 1fr; } }

  .lf-back-btn {
    background: transparent; border: none; color: #93C5FD; font-size: 12.5px;
    cursor: pointer; padding: 0; margin-bottom: 14px; font-family: inherit; display: inline-flex; align-items: center; gap: 5px;
  }
  .lf-back-btn:hover { text-decoration: underline; }

  .lf-form-panel, .lf-preview-panel {
    background: var(--bg-dark-panel); border: 1px solid var(--border-dark-subtle);
    border-radius: 12px; overflow: hidden; display: flex; flex-direction: column;
  }
  .lf-panel-head {
    padding: 14px 18px; border-bottom: 1px solid var(--border-dark-subtle);
    font-size: 12.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--text-dark-muted); display: flex; justify-content: space-between; align-items: center;
  }
  .lf-form-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 14px; max-height: 640px; overflow-y: auto; }

  .lf-field { display: flex; flex-direction: column; gap: 5px; }
  .lf-field-label { font-size: 12px; font-weight: 600; color: var(--text-dark-primary); }
  .lf-field-label .lf-required { color: #F87171; margin-left: 3px; }
  .lf-field-input {
    background: var(--bg-dark-app); border: 1px solid var(--border-dark-subtle);
    border-radius: 7px; padding: 8px 11px; color: var(--text-dark-primary);
    font-size: 13px; font-family: var(--font-sans); outline: none; transition: border-color 0.15s;
    box-sizing: border-box; width: 100%;
  }
  .lf-field-input:focus { border-color: var(--accent-primary); }
  textarea.lf-field-input { resize: vertical; min-height: 56px; }

  /* Auto-fill guardrail — translates the task's literal
     border-green-500/border-red-500 into real CSS (no Tailwind in this
     project; those class names compile to nothing). */
  .lf-field-input.lf-autofill-success { border-color: #22C55E; box-shadow: 0 0 0 1px rgba(34,197,94,0.25); }
  .lf-field-input.lf-autofill-error { border-color: #EF4444; box-shadow: 0 0 0 1px rgba(239,68,68,0.25); }

  .lf-autofill-btn {
    display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px;
    background: rgba(167,139,250,0.12); border: 1px solid rgba(167,139,250,0.35);
    color: #C4B5FD; border-radius: 7px; font-size: 12px; font-weight: 600; cursor: pointer;
    font-family: inherit; transition: all 0.15s;
  }
  .lf-autofill-btn:hover { background: rgba(167,139,250,0.2); }

  .lf-action-bar { padding: 12px 18px; border-top: 1px solid var(--border-dark-subtle); display: flex; gap: 8px; flex-wrap: wrap; }
  .lf-action-btn {
    flex: 1; min-width: 140px; padding: 9px 12px; border-radius: 7px; font-size: 12.5px; font-weight: 600;
    cursor: pointer; font-family: inherit; display: flex; align-items: center; justify-content: center; gap: 6px;
    border: 1px solid var(--border-dark-subtle); background: rgba(255,255,255,0.04); color: var(--text-dark-primary);
    transition: all 0.15s;
  }
  .lf-action-btn:hover { background: rgba(255,255,255,0.08); }
  .lf-action-btn.primary { background: rgba(59,130,246,0.15); border-color: rgba(59,130,246,0.4); color: #93C5FD; }
  .lf-action-btn.primary:hover { background: rgba(59,130,246,0.25); }
  .lf-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .lf-preview-scroll { flex: 1; overflow-y: auto; padding: 24px 32px; background: var(--bg-dark-app); max-height: 640px; }
  .lf-preview-doc { max-width: 680px; margin: 0 auto; font-family: Georgia, 'Times New Roman', serif; font-size: 14.5px; line-height: 1.75; color: var(--text-dark-primary); }
  .lf-preview-doc p { margin: 0 0 12px; }
  .lf-preview-doc .ProseMirror { outline: none; }
  .lf-placeholder { background: rgba(245,158,11,0.15); color: #FBBF24; padding: 0 4px; border-radius: 3px; font-style: italic; font-size: 0.92em; }

  .lf-modal-overlay { position: fixed; inset: 0; background: rgba(3,6,14,0.7); backdrop-filter: blur(3px); z-index: 2000; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .lf-modal { background: var(--bg-dark-panel); border: 1px solid var(--border-dark-subtle); border-radius: 12px; width: 100%; max-width: 560px; box-shadow: 0 25px 60px rgba(0,0,0,0.5); }
  .lf-modal-head { padding: 16px 20px; border-bottom: 1px solid var(--border-dark-subtle); display: flex; justify-content: space-between; align-items: center; }
  .lf-modal-title { font-size: 15px; font-weight: 700; color: var(--text-dark-primary); margin: 0; }
  .lf-modal-close { background: none; border: none; color: var(--text-dark-muted); font-size: 18px; cursor: pointer; line-height: 1; }
  .lf-modal-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; }
  .lf-modal-textarea {
    width: 100%; box-sizing: border-box; min-height: 160px; resize: vertical;
    background: var(--bg-dark-app); border: 1px solid var(--border-dark-subtle);
    border-radius: 8px; padding: 12px; color: var(--text-dark-primary); font-size: 13px; font-family: inherit; outline: none;
  }
  .lf-modal-footer { padding: 14px 20px; border-top: 1px solid var(--border-dark-subtle); display: flex; justify-content: flex-end; gap: 10px; }
`;

function FieldInput({ field, value, status, onChange }) {
  const commonProps = {
    id: `lf-field-${field.field_id}`,
    className: `lf-field-input${status === 'success' ? ' lf-autofill-success' : ''}${status === 'error' ? ' lf-autofill-error' : ''}`,
    value: value ?? '',
    onChange: (e) => onChange(field.field_id, e.target.value),
  };
  return (
    <div className="lf-field">
      <label className="lf-field-label" htmlFor={commonProps.id}>
        {field.label}
        {field.required && <span className="lf-required">*</span>}
      </label>
      {field.type === 'textarea' ? (
        <textarea {...commonProps} rows={3} />
      ) : (
        <input {...commonProps} type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'} />
      )}
    </div>
  );
}

function TemplatePreviewEditor({ html }) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: html,
    editable: false,
  }, []);

  // CRITICAL: this is the ONLY place setContent is called, and it fires at
  // most once per 300ms (debounced by the parent), never per keystroke.
  // editable=false means there is no live cursor/selection to destroy, so
  // a full setContent replace on every debounced update is safe and cheap
  // — the alternative the task explicitly warns against is wiring this same
  // setContent call directly to the form's onChange handlers.
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.commands.setContent(html);
    }
  }, [editor, html]);

  useEffect(() => () => editor?.destroy(), [editor]);

  if (!editor) return null;
  return <EditorContent editor={editor} />;
}

export default function LegalForms() {
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState('All');
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [fieldStatus, setFieldStatus] = useState({});
  const [debouncedHtml, setDebouncedHtml] = useState('');
  const [autofillOpen, setAutofillOpen] = useState(false);
  const [autofillFacts, setAutofillFacts] = useState('');
  const [autofillLoading, setAutofillLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const debounceRef = useRef(null);

  const selectedTemplate = useMemo(
    () => TEMPLATES.find((t) => t.id === selectedTemplateId) || null,
    [selectedTemplateId]
  );

  const visibleTemplates = useMemo(
    () => (activeCategory === 'All' ? TEMPLATES : TEMPLATES.filter((t) => t.category === activeCategory)),
    [activeCategory]
  );

  // Debounced live preview: re-run the string substitution 300ms after the
  // user stops typing, rather than on every keystroke. The preview editor
  // itself is read-only, so there's no cursor to preserve here either way —
  // the debounce exists purely to avoid re-rendering the whole preview pane
  // on every single character typed into a fast-typing user's form.
  useEffect(() => {
    if (!selectedTemplate) {
      setDebouncedHtml('');
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedHtml(fillTemplate(selectedTemplate.html_template, formValues));
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [selectedTemplate, formValues]);

  const openTemplate = (template) => {
    setSelectedTemplateId(template.id);
    setFormValues({});
    setFieldStatus({});
    setDebouncedHtml(fillTemplate(template.html_template, {}));
  };

  const backToLibrary = () => {
    setSelectedTemplateId(null);
    setFormValues({});
    setFieldStatus({});
  };

  const handleFieldChange = (fieldId, value) => {
    setFormValues((prev) => ({ ...prev, [fieldId]: value }));
    // Typing manually over an auto-filled value clears its guardrail
    // color — the color communicates provenance ("AI populated this, you
    // haven't reviewed it yet"), which stops being true once the human has
    // actually edited the field themselves.
    setFieldStatus((prev) => {
      if (!(fieldId in prev)) return prev;
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  };

  const handleAutofillSubmit = async () => {
    if (!selectedTemplate || !autofillFacts.trim()) return;
    setAutofillLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/contract/autofill-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facts: autofillFacts, schema: selectedTemplate.schema }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        alert(data.message || 'Auto-fill failed.');
        return;
      }
      const nextValues = { ...formValues };
      const nextStatus = {};
      selectedTemplate.schema.forEach((f) => {
        const val = data.fields ? data.fields[f.field_id] : null;
        const hasValue = val !== null && val !== undefined && String(val).trim() !== '';
        if (hasValue) {
          nextValues[f.field_id] = val;
          nextStatus[f.field_id] = 'success';
        } else if (f.required) {
          // Guardrail: null/missing on a REQUIRED field is flagged red to
          // force human review — it is never silently left blank.
          nextStatus[f.field_id] = 'error';
        }
      });
      setFormValues(nextValues);
      setFieldStatus(nextStatus);
      setAutofillOpen(false);
      setAutofillFacts('');
    } catch (err) {
      alert('Auto-fill failed: ' + err.message);
    } finally {
      setAutofillLoading(false);
    }
  };

  // NOTE: the spec named the npm package `html-to-docx` for this. Verified
  // live in the browser that it cannot work here — even its "ESM" build
  // does `import fs/http/crypto/path from "..."` directly, a Node-only
  // library with no real browser path; Vite bundling it throws "Class
  // extends value undefined is not a constructor" at runtime, not a fixable
  // import-shape issue. Generating the DOCX server-side with python-docx
  // instead — the same approach this codebase's other DOCX export already
  // uses successfully — achieves the same margins/bold/lists requirement
  // through a path that's actually proven to work.
  const handleDownloadDocx = async () => {
    if (!selectedTemplate) return;
    setDownloading(true);
    try {
      const res = await fetch(`${API_BASE}/api/contract/export-form-docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: debouncedHtml, title: selectedTemplate.title }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Export failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedTemplate.title.replace(/[^a-z0-9]+/gi, '_')}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[LegalForms] DOCX export failed:', err);
      alert('DOCX export failed: ' + (err.message || 'unknown error'));
    } finally {
      setDownloading(false);
    }
  };

  const handleOpenInAnalyzer = () => {
    if (!selectedTemplate) return;
    navigate('/contract-analyzer', { state: { importedDocument: debouncedHtml } });
  };

  return (
    <>
      <style>{styles}</style>
      <div className="lf-shell">
        {!selectedTemplate ? (
          <>
            <div className="lf-header">
              <h1 className="lf-title">📋 Legal Forms Library</h1>
              <p className="lf-subtitle">Pick a template, fill it in (or let AI draft a first pass from client facts), then export or hand it to the Contract Analyzer.</p>
            </div>

            <div className="lf-category-tabs">
              {['All', ...CATEGORIES].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`lf-category-tab${activeCategory === cat ? ' active' : ''}`}
                  onClick={() => setActiveCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="lf-template-grid">
              {visibleTemplates.map((t) => (
                <div key={t.id} className="lf-template-card" onClick={() => openTemplate(t)}>
                  <span className="lf-template-card-cat">{t.category}</span>
                  <span className="lf-template-card-title">{t.title}</span>
                  <span className="lf-template-card-meta">{t.schema.length} fields</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <button type="button" className="lf-back-btn" onClick={backToLibrary}>← Back to Library</button>
            <div className="lf-header">
              <h1 className="lf-title">{selectedTemplate.title}</h1>
              <p className="lf-subtitle">{selectedTemplate.category}</p>
            </div>

            <div className="lf-workspace">
              {/* LEFT PANE — dynamic form driven by schema */}
              <div className="lf-form-panel">
                <div className="lf-panel-head">
                  Form Fields
                  <button type="button" className="lf-autofill-btn" onClick={() => setAutofillOpen(true)}>
                    🪄 Auto-Fill with AI
                  </button>
                </div>
                <div className="lf-form-body">
                  {selectedTemplate.schema.map((field) => (
                    <FieldInput
                      key={field.field_id}
                      field={field}
                      value={formValues[field.field_id]}
                      status={fieldStatus[field.field_id]}
                      onChange={handleFieldChange}
                    />
                  ))}
                </div>
              </div>

              {/* RIGHT PANE — read-only TipTap live preview */}
              <div className="lf-preview-panel">
                <div className="lf-panel-head">Live Preview</div>
                <div className="lf-preview-scroll">
                  <div className="lf-preview-doc">
                    <TemplatePreviewEditor html={debouncedHtml} />
                  </div>
                </div>
                <div className="lf-action-bar">
                  <button type="button" className="lf-action-btn" onClick={handleDownloadDocx} disabled={downloading}>
                    {downloading ? 'Preparing…' : '⬇ Download DOCX'}
                  </button>
                  <button type="button" className="lf-action-btn primary" onClick={handleOpenInAnalyzer}>
                    📖 Open in Analyzer
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {autofillOpen && (
        <div className="lf-modal-overlay" onClick={() => !autofillLoading && setAutofillOpen(false)}>
          <div className="lf-modal" onClick={(e) => e.stopPropagation()}>
            <div className="lf-modal-head">
              <h3 className="lf-modal-title">🪄 Auto-Fill with AI</h3>
              <button type="button" className="lf-modal-close" onClick={() => setAutofillOpen(false)} disabled={autofillLoading}>✕</button>
            </div>
            <div className="lf-modal-body">
              <p style={{ fontSize: '12.5px', color: 'var(--text-dark-muted)', margin: 0 }}>
                Paste raw client facts below. Fields explicitly mentioned will be filled in and marked <strong style={{ color: '#22C55E' }}>green</strong>;
                anything not stated is left for you to fill and, if required, marked <strong style={{ color: '#EF4444' }}>red</strong>.
              </p>
              <textarea
                className="lf-modal-textarea"
                placeholder="e.g. My client Rohan Mehta lent Rs. 50,000 to Vikram Singh on 3 Jan 2025, due back by 3 Mar 2025. He hasn't paid..."
                value={autofillFacts}
                onChange={(e) => setAutofillFacts(e.target.value)}
                autoFocus
                disabled={autofillLoading}
              />
            </div>
            <div className="lf-modal-footer">
              <button type="button" className="lf-action-btn" onClick={() => setAutofillOpen(false)} disabled={autofillLoading} style={{ flex: 'none' }}>
                Cancel
              </button>
              <button
                type="button"
                className="lf-action-btn primary"
                style={{ flex: 'none' }}
                onClick={handleAutofillSubmit}
                disabled={autofillLoading || !autofillFacts.trim()}
              >
                {autofillLoading ? 'Extracting…' : 'Extract & Fill'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
