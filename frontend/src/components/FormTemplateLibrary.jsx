import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TEMPLATES, { CATEGORIES } from '../data/legalTemplates.js';

const CAT_ICONS = {
  'Legal Notices': (
    <svg className="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16v12H4Z" />
      <path d="M4 6l8 7 8-7" />
    </svg>
  ),
  'Contracts & NDAs': (
    <svg className="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3h5l5 5v13H8Z" />
      <path d="M13 3v5h5" />
      <path d="M11 13l1.5 1.5L16 11" />
    </svg>
  ),
  'Court Petitions': (
    <svg className="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="3" x2="12" y2="8" />
      <line x1="5" y1="8" x2="19" y2="8" />
      <line x1="5" y1="8" x2="5" y2="14" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <circle cx="5" cy="16" r="2.3" />
      <circle cx="19" cy="16" r="2.3" />
      <line x1="12" y1="8" x2="12" y2="20" />
      <line x1="8" y1="21" x2="16" y2="21" />
    </svg>
  ),
};

const styles = `
  .ftl-root {
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

  .dark .ftl-root, [data-theme="dark"] .ftl-root, body.theme-dark .ftl-root {
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

  .ftl-shell { max-width: 1280px; margin: 0 auto; }

  .ftl-header { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 24px; }
  .ftl-icon-badge {
    width: 44px; height: 44px; border-radius: 11px;
    background: var(--accent-soft); display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; margin-top: 2px; color: var(--accent);
  }
  .ftl-icon-badge svg { width: 22px; height: 22px; }
  .ftl-title { font-family: 'Fraunces', Georgia, serif; font-style: italic; font-weight: 600; font-size: 29px; color: var(--ink); margin: 0; }
  .ftl-sub { font-size: 13.5px; color: var(--muted); margin-top: 6px; max-width: 580px; line-height: 1.55; }

  .ftl-search-row { position: relative; margin: 24px 0 16px; max-width: 420px; }
  .ftl-search-row .ftl-search-icon {
    position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
    color: var(--muted); pointer-events: none; display: flex; align-items: center;
  }
  .ftl-search-input {
    width: 100%; border: 1px solid var(--rule); border-radius: 9px;
    padding: 11px 14px 11px 40px; font-family: inherit; font-size: 13px;
    background: var(--paper); color: var(--ink-soft); box-sizing: border-box;
    transition: border-color 0.15s; outline: none;
  }
  .ftl-search-input::placeholder { color: var(--muted); }
  .ftl-search-input:focus { border-color: var(--accent); }

  .ftl-filter-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 26px; }
  .ftl-filter-pill {
    font-size: 12px; color: var(--muted); background: var(--paper);
    border: 1px solid var(--rule); border-radius: 16px; padding: 6px 14px;
    cursor: pointer; transition: all 0.15s; font-family: inherit;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .ftl-filter-pill:hover { border-color: var(--accent); color: var(--ink); }
  .ftl-filter-pill.on, .ftl-filter-pill.active {
    color: var(--accent); border-color: var(--accent); background: var(--accent-soft); font-weight: 600;
  }
  .ftl-filter-pill .count { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; }

  .ftl-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 18px; }
  .ftl-tpl-card {
    border: 1px solid var(--rule); border-radius: 13px; background: var(--paper);
    padding: 20px; cursor: pointer; transition: border-color 0.18s, transform 0.18s, box-shadow 0.18s;
    display: flex; flex-direction: column; justify-content: space-between; text-align: left;
  }
  .ftl-tpl-card:hover {
    border-color: var(--accent); transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.08);
  }
  .dark .ftl-tpl-card:hover, [data-theme="dark"] .ftl-tpl-card:hover, body.theme-dark .ftl-tpl-card:hover {
    box-shadow: 0 8px 24px rgba(0,0,0,0.35);
  }

  .ftl-tpl-cat-row { display: flex; align-items: center; gap: 9px; margin-bottom: 14px; }
  .ftl-tpl-cat-icon {
    width: 30px; height: 30px; border-radius: 8px; background: var(--paper-2);
    display: flex; align-items: center; justify-content: center; color: var(--ink-soft); flex-shrink: 0;
  }
  .ftl-tpl-cat-label { font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 0.04em; color: var(--muted); text-transform: uppercase; }

  .ftl-tpl-title {
    font-family: 'Fraunces', Georgia, serif; font-weight: 600; font-size: 16.5px;
    color: var(--ink); line-height: 1.35; margin-bottom: 16px; min-height: 44px;
  }

  .ftl-tpl-footer { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--rule); padding-top: 12px; }
  .ftl-tpl-fields-count { font-size: 11.5px; color: var(--muted); font-family: 'IBM Plex Mono', monospace; }
  .ftl-tpl-go { font-size: 11.5px; color: var(--accent); font-weight: 600; opacity: 0; transition: opacity 0.15s; }
  .ftl-tpl-card:hover .ftl-tpl-go { opacity: 1; }

  .ftl-empty-state {
    grid-column: 1 / -1; text-align: center; padding: 60px 20px;
    color: var(--muted); font-family: 'Fraunces', Georgia, serif; font-style: italic; font-size: 16px;
  }

  /* Mobile optimizations */
  @media (max-width: 768px) {
    .ftl-root { padding: 16px 16px 80px; }
    .ftl-title { font-size: 22px; }
    .ftl-filter-row {
      flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch;
      scrollbar-width: none; padding-bottom: 4px;
    }
    .ftl-filter-row::-webkit-scrollbar { display: none; }
    .ftl-filter-pill { flex-shrink: 0; white-space: nowrap; }
    .ftl-tpl-go { opacity: 1; }
  }
`;

export default function FormTemplateLibrary() {
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchText, setSearchText] = useState('');

  const filterCategories = ['All', ...CATEGORIES];

  const visibleTemplates = TEMPLATES.filter((t) => {
    const matchesCategory = activeCategory === 'All' || t.category === activeCategory;
    const matchesSearch = !searchText || t.title.toLowerCase().includes(searchText.toLowerCase().trim());
    return matchesCategory && matchesSearch;
  });

  const openTemplate = (template) => {
    navigate('/firm-library/draft', { state: { templateId: template.id } });
  };

  return (
    <div className="ftl-root">
      <style>{styles}</style>
      <div className="ftl-shell">
        <div className="ftl-header">
          <div className="ftl-icon-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3h9l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
              <path d="M15 3v5h5" />
              <line x1="9" y1="13" x2="15" y2="13" />
              <line x1="9" y1="17" x2="13" y2="17" />
            </svg>
          </div>
          <div>
            <h1 className="ftl-title">Legal Forms Library</h1>
            <div className="ftl-sub">
              Pick a template, fill it in — or let AI draft a first pass from client facts — then export or hand it to the Contract Analyzer.
            </div>
          </div>
        </div>

        <div className="ftl-search-row">
          <span className="ftl-search-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.6" y2="16.6" />
            </svg>
          </span>
          <input
            id="tplSearch"
            className="ftl-search-input"
            type="text"
            placeholder="Search templates…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>

        <div className="ftl-filter-row">
          {filterCategories.map((cat) => {
            const count = cat === 'All' ? TEMPLATES.length : TEMPLATES.filter((t) => t.category === cat).length;
            const isSelected = activeCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                className={`ftl-filter-pill${isSelected ? ' on active' : ''}`}
                onClick={() => setActiveCategory(cat)}
              >
                <span>{cat}</span>
                <span className="count">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="ftl-card-grid">
          {visibleTemplates.length > 0 ? (
            visibleTemplates.map((t) => (
              <div key={t.id} className="ftl-tpl-card" onClick={() => openTemplate(t)}>
                <div>
                  <div className="ftl-tpl-cat-row">
                    <div className="ftl-tpl-cat-icon">
                      {CAT_ICONS[t.category] || (
                        <svg className="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        </svg>
                      )}
                    </div>
                    <span className="ftl-tpl-cat-label">{t.category}</span>
                  </div>
                  <div className="ftl-tpl-title">{t.title}</div>
                </div>
                <div className="ftl-tpl-footer">
                  <span className="ftl-tpl-fields-count">{(t.fields || t.schema || []).length} fields</span>
                  <span className="ftl-tpl-go">Start drafting →</span>
                </div>
              </div>
            ))
          ) : (
            <div className="ftl-empty-state">No templates match your search.</div>
          )}
        </div>
      </div>
    </div>
  );
}

