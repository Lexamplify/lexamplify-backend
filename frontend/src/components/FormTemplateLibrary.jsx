import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TEMPLATES, { CATEGORIES } from '../data/legalTemplates.js';

const styles = `
  .ftl-shell { padding: 24px 28px; max-width: 1400px; margin: 0 auto; }
  .ftl-header { margin-bottom: 20px; }
  .ftl-title { font-size: 22px; font-weight: 700; color: var(--text-dark-primary); margin: 0 0 4px; }
  .ftl-subtitle { font-size: 13px; color: var(--text-dark-muted); margin: 0; }

  .ftl-category-tabs { display: flex; gap: 8px; margin: 18px 0; flex-wrap: wrap; }
  .ftl-category-tab {
    padding: 7px 14px; border-radius: 20px; font-size: 12.5px; font-weight: 600;
    background: rgba(255,255,255,0.04); border: 1px solid var(--border-dark-subtle);
    color: var(--text-dark-muted); cursor: pointer; transition: all 0.15s; font-family: inherit;
  }
  .ftl-category-tab:hover { background: rgba(59,130,246,0.08); color: var(--text-dark-primary); }
  .ftl-category-tab.active { background: rgba(59,130,246,0.15); border-color: rgba(59,130,246,0.45); color: #93C5FD; }

  .ftl-template-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
  .ftl-template-card {
    background: var(--bg-dark-panel); border: 1px solid var(--border-dark-subtle);
    border-radius: 12px; padding: 18px; cursor: pointer; transition: all 0.18s;
    display: flex; flex-direction: column; gap: 8px;
  }
  .ftl-template-card:hover { border-color: rgba(59,130,246,0.4); transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.25); }
  .ftl-template-card-cat { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #93C5FD; }
  .ftl-template-card-title { font-size: 15px; font-weight: 600; color: var(--text-dark-primary); }
  .ftl-template-card-meta { font-size: 11.5px; color: var(--text-dark-muted); }

  /* OVERRIDE FOR MOBILE OPTIMIZATIONS (FormTemplateLibrary) */
  @media (max-width: 768px) {
    .ftl-category-tabs { 
      display: flex !important;
      flex-wrap: nowrap !important;
      overflow-x: auto !important;
      overflow-y: hidden !important;
      -webkit-overflow-scrolling: touch !important;
      scrollbar-width: none !important;
      gap: 8px !important;
      padding-bottom: 4px !important;
      width: 100% !important;
    }
    .ftl-category-tabs::-webkit-scrollbar { display: none !important; }
    .ftl-category-tabs > * { flex-shrink: 0 !important; white-space: nowrap !important; }

    .ftl-shell {
      padding-bottom: 96px !important;
      overflow-x: hidden !important;
      width: 100% !important;
      box-sizing: border-box !important;
    }
  }
`;

// The single, canonical place a user picks a form template from — the
// Court Resources "Smart AI Templates" embed and any future duplicate entry
// point were removed rather than given their own copy of this grid.
// Selecting a card hands off straight to the drafting workspace at
// /firm-library/draft (same router-state contract already used by the
// Dashboard Quick Draft modal and Case Vault's context-aware flow), so
// LegalForms.jsx itself no longer needs to render a template picker.
export default function FormTemplateLibrary() {
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState('All');

  const visibleTemplates = activeCategory === 'All'
    ? TEMPLATES
    : TEMPLATES.filter((t) => t.category === activeCategory);

  const openTemplate = (template) => {
    navigate('/firm-library/draft', { state: { templateId: template.id } });
  };

  return (
    <div className="ftl-shell">
      <style>{styles}</style>
      <div className="ftl-header">
        <h1 className="ftl-title">📋 Legal Forms Library</h1>
        <p className="ftl-subtitle">Pick a template, fill it in (or let AI draft a first pass from client facts), then export or hand it to the Contract Analyzer.</p>
      </div>

      <div className="ftl-category-tabs">
        {['All', ...CATEGORIES].map((cat) => (
          <button
            key={cat}
            type="button"
            className={`ftl-category-tab${activeCategory === cat ? ' active' : ''}`}
            onClick={() => setActiveCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="ftl-template-grid">
        {visibleTemplates.map((t) => (
          <div key={t.id} className="ftl-template-card" onClick={() => openTemplate(t)}>
            <span className="ftl-template-card-cat">{t.category}</span>
            <span className="ftl-template-card-title">{t.title}</span>
            <span className="ftl-template-card-meta">{t.schema.length} fields</span>
          </div>
        ))}
      </div>
    </div>
  );
}
