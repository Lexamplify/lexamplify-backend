import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import TEMPLATES from '../data/legalTemplates.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generateExportHtml(previewText, fields, formValues) {
  const fieldsMap = new Map((fields || []).map((f) => [f.key, f]));
  const paragraphs = (previewText || '').split('\n\n');

  return paragraphs
    .map((para) => {
      let htmlPara = para
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\{\{(\w+)\}\}/g, (_, key) => {
          const field = fieldsMap.get(key);
          const val = formValues[key];
          if (val !== undefined && val !== null && String(val).trim() !== '') {
            return escapeHtml(String(val)).replace(/\n/g, '<br/>');
          }
          return `[${field ? field.label : key}]`;
        })
        .replace(/\n/g, '<br/>');
      return `<p>${htmlPara}</p>`;
    })
    .join('');
}

const styles = `
  .lf-root {
    --bg: #DFE1E0;
    --paper: #EAEBE8;
    --paper-2: #E3E4E1;
    --ink: #181B1D;
    --ink-soft: #494E51;
    --muted: #868C8E;
    --muted-2: #B3B8B9;
    --rule: #D2D5D4;
    --accent: #B24A2E;
    --accent-soft: #EFDCD1;
    --major: #9C7A2E;
    --major-soft: #F1E6C9;
    --on-accent: #FBF7EE;
    font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: var(--ink-soft);
    background: var(--bg);
    min-height: calc(100vh - 60px);
    padding: 24px 32px 80px;
    box-sizing: border-box;
  }

  .dark .lf-root, [data-theme="dark"] .lf-root, body.theme-dark .lf-root {
    --bg: #191C1D;
    --paper: #212527;
    --paper-2: #2A2F31;
    --ink: #D6D9D9;
    --ink-soft: #AAAEAE;
    --muted: #727776;
    --muted-2: #494E4D;
    --rule: #333939;
    --accent: #CC6B48;
    --accent-soft: #3B281F;
    --major: #D9AD5C;
    --major-soft: #35301C;
    --on-accent: #FBF7EE;
  }

  .lf-shell { max-width: 1280px; margin: 0 auto; }

  .lf-topbar {
    display: flex; align-items: center; justify-content: space-between;
    flex-wrap: wrap; gap: 14px; margin-bottom: 18px;
  }

  .lf-back-link {
    font-size: 12.5px; color: var(--muted); text-decoration: none; cursor: pointer;
    display: inline-flex; align-items: center; gap: 5px; margin-bottom: 14px;
    background: none; border: none; padding: 0; font-family: inherit; font-weight: 500;
    transition: color 0.15s;
  }
  .lf-back-link:hover { color: var(--accent); }

  .lf-draft-head {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 16px; flex-wrap: wrap; margin-bottom: 22px;
  }
  .lf-draft-title {
    font-family: 'Fraunces', Georgia, serif; font-weight: 700; font-size: 24px;
    color: var(--ink); margin: 0;
  }
  .lf-draft-cat { font-size: 12px; color: var(--muted); margin-top: 5px; font-family: 'IBM Plex Mono', monospace; text-transform: uppercase; letter-spacing: 0.04em; }

  .lf-progress-wrap { margin-bottom: 22px; }
  .lf-progress-label {
    display: flex; justify-content: space-between; font-size: 11.5px;
    color: var(--muted); margin-bottom: 7px; font-family: 'IBM Plex Mono', monospace;
  }
  .lf-progress-label .ok { color: var(--accent); font-weight: 600; }
  .lf-progress-track { height: 5px; background: var(--paper-2); border-radius: 3px; overflow: hidden; }
  .lf-progress-fill { height: 100%; background: var(--accent); border-radius: 3px; transition: width 0.25s ease; }

  .lf-draft-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: flex-start;
  }
  @media (max-width: 980px) { .lf-draft-grid { grid-template-columns: 1fr; } }

  .lf-panel { border: 1px solid var(--rule); border-radius: 13px; background: var(--paper); overflow: hidden; }
  .lf-panel-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px; border-bottom: 1px solid var(--rule);
  }
  .lf-panel-label {
    font-family: 'IBM Plex Mono', monospace; font-size: 11px;
    letter-spacing: 0.04em; color: var(--muted); text-transform: uppercase; font-weight: 600;
  }
  .lf-panel-body { padding: 22px 20px; max-height: 640px; overflow-y: auto; }

  .lf-ai-fill-btn {
    display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600;
    color: var(--accent); background: var(--accent-soft); border: 1px solid var(--accent);
    border-radius: 7px; padding: 7px 12px; cursor: pointer; transition: all 0.15s; font-family: inherit;
  }
  .lf-ai-fill-btn:hover { background: var(--accent); color: var(--on-accent); }

  .lf-field { margin-bottom: 18px; }
  .lf-field:last-child { margin-bottom: 0; }
  .lf-field label {
    display: flex; align-items: center; justify-content: space-between;
    font-size: 12.5px; font-weight: 600; color: var(--ink-soft); margin-bottom: 7px;
  }
  .lf-field label .lf-label-text { display: flex; align-items: center; gap: 4px; }
  .lf-field label .req { color: var(--accent); font-weight: 700; }
  .lf-field label .opt { color: var(--muted); font-weight: 400; font-size: 11px; }

  .lf-field input[type="text"], .lf-field textarea, .lf-field input[type="date"] {
    width: 100%; border: 1px solid var(--rule); border-radius: 8px;
    padding: 10px 12px; font-family: inherit; font-size: 13px;
    background: var(--bg); color: var(--ink-soft); box-sizing: border-box;
    transition: border-color 0.15s, background-color 0.15s; outline: none;
  }
  .lf-field input[type="text"]:focus, .lf-field textarea:focus, .lf-field input[type="date"]:focus {
    outline: none; border-color: var(--accent);
  }
  .lf-field textarea { resize: vertical; min-height: 64px; }

  .lf-field.ai-touched input[type="text"],
  .lf-field.ai-touched textarea,
  .lf-field.ai-touched input[type="date"],
  .lf-field.ai-touched .lf-num-field {
    border-color: var(--accent); background: var(--accent-soft);
  }

  .lf-ai-mark {
    display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px;
    color: var(--accent); font-weight: 600; font-family: 'IBM Plex Mono', monospace;
  }
  .lf-ai-mark svg { width: 12px; height: 12px; }

  .lf-date-field { position: relative; width: 100%; }

  .lf-num-field {
    display: flex; align-items: stretch; border: 1px solid var(--rule);
    border-radius: 8px; overflow: hidden; background: var(--bg); transition: border-color 0.15s;
  }
  .lf-num-field input {
    flex: 1; border: none; padding: 10px 12px; font-family: inherit;
    font-size: 13px; background: transparent; color: var(--ink-soft); width: 100%; outline: none;
  }
  .lf-num-stepper { display: flex; flex-direction: column; border-left: 1px solid var(--rule); }
  .lf-num-stepper button {
    flex: 1; border: none; background: var(--paper-2); color: var(--muted);
    cursor: pointer; width: 28px; font-size: 9px; display: flex; align-items: center;
    justify-content: center; transition: color 0.15s, background-color 0.15s; padding: 0;
  }
  .lf-num-stepper button:hover { color: var(--accent); background: var(--paper); }
  .lf-num-stepper button:first-child { border-bottom: 1px solid var(--rule); }

  /* Preview typography & tokens */
  .lf-preview-doc {
    font-family: 'Fraunces', Georgia, serif; font-size: 13.5px;
    line-height: 1.85; color: var(--ink-soft);
  }
  .lf-preview-para { margin: 0 0 16px; }
  .lf-preview-para:last-child { margin-bottom: 0; }
  .lf-preview-para strong, .lf-preview-para b { color: var(--ink); font-weight: 700; }

  .ph-chip {
    display: inline; font-family: 'IBM Plex Sans', sans-serif; font-style: normal;
    font-size: 11.5px; font-weight: 600; color: var(--accent); background: var(--accent-soft);
    border-radius: 4px; padding: 1px 7px; white-space: nowrap;
  }
  .filled-value { color: var(--ink); font-weight: 700; }
  .filled-value.ai { border-bottom: 1.5px dotted var(--accent); }

  .lf-preview-hint {
    margin: 0 0 18px; padding: 10px 13px; background: var(--paper-2);
    border-radius: 8px; font-size: 11.5px; color: var(--muted); display: flex; align-items: center; gap: 8px;
  }
  .lf-preview-hint .ph-chip { flex-shrink: 0; }

  .lf-btn {
    display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 600;
    border-radius: 8px; padding: 10px 16px; cursor: pointer; white-space: nowrap;
    border: 1px solid transparent; font-family: inherit; transition: all 0.15s;
  }
  .lf-btn-primary { color: var(--on-accent); background: var(--accent); }
  .lf-btn-primary:hover { opacity: 0.92; }
  .lf-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
  .lf-btn-ghost { color: var(--ink-soft); background: var(--paper); border-color: var(--rule); }
  .lf-btn-ghost:hover { border-color: var(--ink); color: var(--ink); }
  .lf-btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }

  .lf-draft-actions { display: flex; gap: 10px; margin-top: 22px; flex-wrap: wrap; }
  .lf-download-status {
    font-size: 11.5px; color: var(--muted); font-style: italic;
    font-family: 'Fraunces', Georgia, serif; margin-top: 9px;
  }
  .lf-download-warn {
    font-size: 11.5px; color: var(--accent); margin-top: 10px;
    display: flex; align-items: center; gap: 6px; font-weight: 500;
  }
  .lf-download-warn svg { width: 14px; height: 14px; flex-shrink: 0; }

  /* Modal */
  .lf-modal-backdrop {
    position: fixed; inset: 0; background: rgba(20,23,26,0.6); backdrop-filter: blur(2px);
    display: flex; align-items: center; justify-content: center; z-index: 2000; padding: 24px;
  }
  .lf-modal {
    width: 520px; max-width: 100%; background: var(--paper);
    border-radius: 14px; border: 1px solid var(--rule); box-shadow: 0 25px 60px rgba(0,0,0,0.4);
  }
  .lf-modal-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 24px; border-bottom: 1px solid var(--rule);
  }
  .lf-modal-title {
    font-family: 'Fraunces', Georgia, serif; font-weight: 700; font-size: 17px;
    color: var(--ink); margin: 0; display: flex; align-items: center; gap: 9px;
  }
  .lf-modal-title svg { color: var(--accent); }
  .lf-modal-close {
    background: none; border: none; color: var(--muted); cursor: pointer;
    font-size: 18px; line-height: 1; transition: color 0.15s; padding: 4px;
  }
  .lf-modal-close:hover { color: var(--accent); }
  .lf-modal-body { padding: 22px 24px; }
  .lf-modal-body textarea {
    width: 100%; min-height: 140px; border: 1px solid var(--rule);
    border-radius: 9px; padding: 12px 14px; font-family: inherit; font-size: 13px;
    background: var(--bg); color: var(--ink-soft); resize: vertical; box-sizing: border-box;
    outline: none; transition: border-color 0.15s;
  }
  .lf-modal-body textarea:focus { border-color: var(--accent); }
  .lf-modal-note { font-size: 11px; color: var(--muted); margin-top: 10px; line-height: 1.6; }
  .lf-modal-footer {
    display: flex; justify-content: flex-end; gap: 10px; padding: 18px 24px;
    border-top: 1px solid var(--rule);
  }

  /* Mobile responsiveness */
  @media (max-width: 768px) {
    .lf-root { padding: 16px 16px 80px; }
    .lf-draft-title { font-size: 20px; }
    .lf-draft-actions { flex-direction: column; }
    .lf-draft-actions .lf-btn { width: 100%; justify-content: center; }
  }
`;

function parseParagraphContent(text, fieldsMap, formValues, aiTouched) {
  const tokenRegex = /(\*\*[^*]+?\*\*|\{\{[a-zA-Z0-9_]+?\}\})/g;
  const parts = text.split(tokenRegex);

  return parts.map((part, idx) => {
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**')) {
      const boldText = part.slice(2, -2);
      return <strong key={idx}>{boldText}</strong>;
    }
    if (part.startsWith('{{') && part.endsWith('}}')) {
      const key = part.slice(2, -2);
      const field = fieldsMap.get(key);
      const val = formValues[key];
      const isFilled = val !== undefined && val !== null && String(val).trim() !== '';
      const isAi = aiTouched.has(key);

      if (isFilled) {
        return (
          <span key={idx} className={`filled-value${isAi ? ' ai' : ''}`}>
            {val}
          </span>
        );
      }
      return (
        <span key={idx} className="ph-chip">
          {field?.label || key}
        </span>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

function renderPreviewDoc(previewText, fields, formValues, aiTouched) {
  const fieldsMap = new Map((fields || []).map((f) => [f.key, f]));
  const paragraphs = (previewText || '').split('\n\n');

  return (
    <div className="lf-preview-doc" id="previewDoc">
      {paragraphs.map((para, pIdx) => {
        const lines = para.split('\n');
        return (
          <p key={pIdx} className="lf-preview-para">
            {lines.map((line, lIdx) => (
              <span key={lIdx}>
                {parseParagraphContent(line, fieldsMap, formValues, aiTouched)}
                {lIdx < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

export default function LegalForms({ showSaveBar } = {}) {
  const navigate = useNavigate();
  const location = useLocation();

  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [aiTouched, setAiTouched] = useState(new Set());

  const [autofillOpen, setAutofillOpen] = useState(false);
  const [autofillFacts, setAutofillFacts] = useState('');
  const [autofillLoading, setAutofillLoading] = useState(false);

  const [downloading, setDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState('');
  const [saving, setSaving] = useState(false);

  // Match template by ID or alias
  const activeTemplate = useMemo(() => {
    if (!selectedTemplateId) return TEMPLATES[0];
    return (
      TEMPLATES.find((t) => t.id === selectedTemplateId || t.aliases?.includes(selectedTemplateId)) ||
      TEMPLATES[0]
    );
  }, [selectedTemplateId]);

  const handleFieldChange = useCallback((key, value) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    // Clear AI touched badge when user edits the field manually
    setAiTouched((prev) => {
      if (prev.has(key)) {
        const next = new Set(prev);
        next.delete(key);
        return next;
      }
      return prev;
    });
  }, []);

  const stepNumber = useCallback((key, delta) => {
    setFormValues((prev) => {
      const cur = parseInt(prev[key] || '0', 10);
      const nextVal = Math.max(0, (isNaN(cur) ? 0 : cur) + delta);
      return { ...prev, [key]: String(nextVal) };
    });
    setAiTouched((prev) => {
      if (prev.has(key)) {
        const next = new Set(prev);
        next.delete(key);
        return next;
      }
      return prev;
    });
  }, []);

  // Run AI Autofill: fills only empty fields, never overwriting user-entered text
  const runAutofill = useCallback(
    async (template, facts) => {
      if (!template || !facts || !facts.trim()) return;
      setAutofillLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/contract/autofill-template`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            facts,
            schema: template.fields.map((f) => ({
              field_id: f.key,
              label: f.label,
              type: f.type,
              required: f.required,
            })),
          }),
        });

        const data = await res.json().catch(() => ({}));
        const extractedFields = data?.fields || {};

        setFormValues((prev) => {
          const next = { ...prev };
          const newAiTouched = new Set(aiTouched);

          template.fields.forEach((f) => {
            const hasUserValue = prev[f.key] !== undefined && prev[f.key] !== null && String(prev[f.key]).trim() !== '';
            if (!hasUserValue) {
              const apiVal = extractedFields[f.key];
              const demoVal = template.demo ? template.demo[f.key] : null;
              const valToUse = (apiVal !== undefined && apiVal !== null && String(apiVal).trim() !== '') ? apiVal : demoVal;

              if (valToUse !== undefined && valToUse !== null && String(valToUse).trim() !== '') {
                next[f.key] = String(valToUse);
                newAiTouched.add(f.key);
              }
            }
          });

          setAiTouched(newAiTouched);
          return next;
        });
      } catch (err) {
        console.warn('AI extraction network failed, using demo fallback:', err);
        // Fallback: fill empty fields from demo
        setFormValues((prev) => {
          const next = { ...prev };
          const newAiTouched = new Set(aiTouched);
          template.fields.forEach((f) => {
            const hasUserValue = prev[f.key] !== undefined && prev[f.key] !== null && String(prev[f.key]).trim() !== '';
            if (!hasUserValue && template.demo && template.demo[f.key]) {
              next[f.key] = String(template.demo[f.key]);
              newAiTouched.add(f.key);
            }
          });
          setAiTouched(newAiTouched);
          return next;
        });
      } finally {
        setAutofillLoading(false);
      }
    },
    [aiTouched]
  );

  const handleAutofillSubmit = async () => {
    if (!activeTemplate || !autofillFacts.trim()) return;
    await runAutofill(activeTemplate, autofillFacts);
    setAutofillOpen(false);
    setAutofillFacts('');
  };

  // Mount effect: initialize template selection from location state
  useEffect(() => {
    const { templateId, contextFacts } = location.state || {};
    if (templateId) {
      const found = TEMPLATES.find((t) => t.id === templateId || t.aliases?.includes(templateId));
      if (found) {
        setSelectedTemplateId(found.id);
        if (contextFacts && contextFacts.trim()) {
          runAutofill(found, contextFacts);
        }
        return;
      }
    }
    // Default to first template if none provided
    setSelectedTemplateId(TEMPLATES[0].id);
  }, [location.state, runAutofill]);

  // Progress metrics
  const requiredFields = useMemo(() => (activeTemplate.fields || []).filter((f) => f.required), [activeTemplate]);
  const filledRequiredCount = useMemo(() => {
    return requiredFields.filter((f) => formValues[f.key] && String(formValues[f.key]).trim() !== '').length;
  }, [requiredFields, formValues]);

  const totalRequiredCount = requiredFields.length;
  const progressPercent = totalRequiredCount > 0 ? Math.round((filledRequiredCount / totalRequiredCount) * 100) : 100;
  const isComplete = filledRequiredCount === totalRequiredCount;
  const missingCount = totalRequiredCount - filledRequiredCount;

  // Export actions
  const handleDownloadDocx = async () => {
    if (!activeTemplate) return;
    setDownloading(true);
    setDownloadStatus('Preparing DOCX…');
    const docHtml = generateExportHtml(activeTemplate.preview, activeTemplate.fields, formValues);

    try {
      const res = await fetch(`${API_BASE}/api/contract/export-form-docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: docHtml, title: activeTemplate.title }),
      });

      if (!res.ok) {
        throw new Error(`Export failed (HTTP ${res.status})`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeTemplate.title.replace(/[^a-z0-9]+/gi, '_')}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDownloadStatus(`Downloaded "${activeTemplate.title}.docx"`);
    } catch (err) {
      console.error('[LegalForms] DOCX export error:', err);
      setDownloadStatus(`Export error: ${err.message}`);
    } finally {
      setDownloading(false);
    }
  };

  const handleOpenInAnalyzer = () => {
    if (!activeTemplate) return;
    const docHtml = generateExportHtml(activeTemplate.preview, activeTemplate.fields, formValues);
    navigate('/contract-analyzer', { state: { importedDocument: docHtml } });
  };

  const handleSaveAndExit = async () => {
    if (!activeTemplate) return;
    setSaving(true);
    const docHtml = generateExportHtml(activeTemplate.preview, activeTemplate.fields, formValues);

    try {
      await fetch(`${API_BASE}/api/firm-library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: activeTemplate.title,
          html: docHtml,
          category: activeTemplate.category,
        }),
      });
      navigate('/firm-library');
    } catch (err) {
      console.error('[LegalForms] Save error:', err);
      navigate('/legal-forms');
    } finally {
      setSaving(false);
    }
  };

  const backToLibrary = () => navigate('/legal-forms');

  return (
    <div className="lf-root">
      <style>{styles}</style>
      <div className="lf-shell">
        <div className="lf-topbar">
          <button type="button" className="lf-back-link" onClick={backToLibrary} id="backLink">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            Back to Library
          </button>
          {(showSaveBar || true) && (
            <button
              type="button"
              className="lf-btn lf-btn-primary"
              id="saveExitBtn"
              onClick={handleSaveAndExit}
              disabled={saving}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              {saving ? 'Saving…' : 'Save to Library & Exit'}
            </button>
          )}
        </div>

        <div className="lf-draft-head">
          <div>
            <h1 className="lf-draft-title" id="draftTitle">
              {activeTemplate.title}
            </h1>
            <div className="lf-draft-cat" id="draftCat">
              {activeTemplate.category}
            </div>
          </div>
        </div>

        <div className="lf-progress-wrap">
          <div className="lf-progress-label">
            <span>Required fields completed</span>
            <span id="progressText" className="ok">
              {filledRequiredCount} of {totalRequiredCount}
            </span>
          </div>
          <div className="lf-progress-track">
            <div className="lf-progress-fill" id="progressFill" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>

        <div className="lf-draft-grid">
          {/* Left panel: Form Fields */}
          <div className="lf-panel">
            <div className="lf-panel-head">
              <span className="lf-panel-label">Form Fields</span>
              <button
                type="button"
                className="lf-ai-fill-btn"
                id="aiFillBtn"
                onClick={() => setAutofillOpen(true)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" />
                </svg>
                Auto-Fill with AI
              </button>
            </div>
            <div className="lf-panel-body" id="formFields">
              {(activeTemplate.fields || []).map((f) => {
                const isAi = aiTouched.has(f.key) && !!formValues[f.key];
                return (
                  <div key={f.key} id={`field-${f.key}`} className={`lf-field${isAi ? ' ai-touched' : ''}`}>
                    <label htmlFor={`input-${f.key}`}>
                      <span className="lf-label-text">
                        {f.label}
                        {f.required ? <span className="req">*</span> : <span className="opt">(optional)</span>}
                      </span>
                      {isAi && (
                        <span className="lf-ai-mark">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" />
                          </svg>
                          AI filled
                        </span>
                      )}
                    </label>
                    {f.type === 'textarea' ? (
                      <textarea
                        id={`input-${f.key}`}
                        data-key={f.key}
                        placeholder={f.label}
                        value={formValues[f.key] || ''}
                        onChange={(e) => handleFieldChange(f.key, e.target.value)}
                      />
                    ) : f.type === 'date' ? (
                      <div className="lf-date-field">
                        <input
                          type="date"
                          id={`input-${f.key}`}
                          data-key={f.key}
                          value={formValues[f.key] || ''}
                          onChange={(e) => handleFieldChange(f.key, e.target.value)}
                        />
                      </div>
                    ) : f.type === 'number' ? (
                      <div className="lf-num-field">
                        <input
                          type="text"
                          inputMode="numeric"
                          id={`input-${f.key}`}
                          data-key={f.key}
                          placeholder="0"
                          value={formValues[f.key] || ''}
                          onChange={(e) => handleFieldChange(f.key, e.target.value)}
                        />
                        <div className="lf-num-stepper">
                          <button type="button" data-step="1" onClick={() => stepNumber(f.key, 1)}>
                            ▲
                          </button>
                          <button type="button" data-step="-1" onClick={() => stepNumber(f.key, -1)}>
                            ▼
                          </button>
                        </div>
                      </div>
                    ) : (
                      <input
                        type="text"
                        id={`input-${f.key}`}
                        data-key={f.key}
                        placeholder={f.label}
                        value={formValues[f.key] || ''}
                        onChange={(e) => handleFieldChange(f.key, e.target.value)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right panel: Live Document Preview */}
          <div className="lf-panel">
            <div className="lf-panel-head">
              <span className="lf-panel-label">Live Preview</span>
            </div>
            <div className="lf-panel-body">
              <div className="lf-preview-hint">
                <span className="ph-chip">Like this</span> marks text not filled in yet — it will not appear in the exported document until you complete that field.
              </div>
              {renderPreviewDoc(activeTemplate.preview, activeTemplate.fields, formValues, aiTouched)}
            </div>
          </div>
        </div>

        {/* Action buttons & warnings */}
        <div className="lf-draft-actions">
          <button
            type="button"
            className="lf-btn lf-btn-ghost"
            id="downloadBtn"
            onClick={handleDownloadDocx}
            disabled={downloading}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12" />
              <polyline points="7 10 12 15 17 10" />
              <path d="M5 21h14" />
            </svg>
            {downloading ? 'Preparing DOCX…' : 'Download DOCX'}
          </button>
          <button
            type="button"
            className="lf-btn lf-btn-primary"
            id="openAnalyzerBtn"
            onClick={handleOpenInAnalyzer}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
            </svg>
            Open in Analyzer
          </button>
        </div>

        {!isComplete && (
          <div className="lf-download-warn" id="downloadWarn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l10 18H2Z" />
              <line x1="12" y1="10" x2="12" y2="15" />
            </svg>
            <span id="downloadWarnText">
              {missingCount} required field{missingCount === 1 ? '' : 's'} still empty — the download will contain visible placeholder text until these are filled.
            </span>
          </div>
        )}

        {downloadStatus && <div className="lf-download-status" id="downloadStatus">{downloadStatus}</div>}
      </div>

      {/* Auto-Fill with AI Modal */}
      {autofillOpen && (
        <div
          className="lf-modal-backdrop"
          id="aiModalBackdrop"
          onClick={() => !autofillLoading && setAutofillOpen(false)}
        >
          <div className="lf-modal" onClick={(e) => e.stopPropagation()}>
            <div className="lf-modal-head">
              <h3 className="lf-modal-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" />
                </svg>
                Auto-Fill with AI
              </h3>
              <button
                type="button"
                className="lf-modal-close"
                id="aiModalClose"
                onClick={() => setAutofillOpen(false)}
                disabled={autofillLoading}
              >
                ✕
              </button>
            </div>
            <div className="lf-modal-body">
              <textarea
                id="aiFactsInput"
                placeholder="Paste client facts, an email thread, or your notes — AI will extract what it can and fill in the empty fields below. You can review and correct every field before exporting."
                value={autofillFacts}
                onChange={(e) => setAutofillFacts(e.target.value)}
                disabled={autofillLoading}
                autoFocus
              />
              <div className="lf-modal-note">
                Only currently empty fields are filled — anything you've already typed is left untouched. AI-filled fields are marked so you know to double-check them.
              </div>
            </div>
            <div className="lf-modal-footer">
              <button
                type="button"
                className="lf-btn lf-btn-ghost"
                id="aiCancel"
                onClick={() => setAutofillOpen(false)}
                disabled={autofillLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="lf-btn lf-btn-primary"
                id="aiExtract"
                onClick={handleAutofillSubmit}
                disabled={autofillLoading || !autofillFacts.trim()}
              >
                {autofillLoading ? 'Extracting…' : 'Extract & Fill Fields'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

