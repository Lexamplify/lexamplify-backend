import { useState, useMemo } from 'react';
import TemplateCard from './TemplateCard';

function TemplateLibrary({ types, starred, onStar, onUse, search }) {
  const [activeCat, setActiveCat] = useState('All');

  const categories = useMemo(() => {
    const cats = new Set();
    (types || []).forEach((t) => {
      const c = t.category || t.id?.split('_')[0] || '';
      if (c) cats.add(c);
    });
    return ['All', ...Array.from(cats).sort()];
  }, [types]);

  const filtered = useMemo(() => {
    let list = types || [];
    if (activeCat !== 'All') {
      list = list.filter((t) => {
        const c = t.category || t.id?.split('_')[0] || '';
        return c === activeCat;
      });
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((t) =>
        (t.label || t.id || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q) ||
        (t.category || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [types, activeCat, search]);

  return (
    <div>
      {categories.length > 2 && (
        <div className="ads-cats">
          {categories.map((cat) => (
            <button
              key={cat}
              className={`ads-cat-pill${activeCat === cat ? ' active' : ''}`}
              onClick={() => setActiveCat(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="ads-empty">
          <div className="ads-empty__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
          </div>
          <div className="ads-empty__title">No templates found</div>
          <div className="ads-empty__desc">Try a different search or category.</div>
        </div>
      ) : (
        <div className="ads-templates">
          {filtered.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              isStarred={starred.has(t.id)}
              onStar={onStar}
              onUse={onUse}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default TemplateLibrary;
