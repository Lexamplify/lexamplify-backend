import { memo } from 'react';

const DOC_ICONS = {
  notice: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
      <line x1="12" y1="18" x2="12" y2="12" /><line x1="12" y1="9" x2="12.01" y2="9" />
    </svg>
  ),
  court: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m14.5 12.5-8 8a2.12 2.12 0 0 1-3-3l8-8" /><path d="m16 16 6-6" />
      <path d="m8 8 6-6" /><path d="m9 7 8 8" />
    </svg>
  ),
  agreement: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  ),
  corporate: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
    </svg>
  ),
  property: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  default: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
      <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  ),
};

function pickIcon(category) {
  if (!category) return DOC_ICONS.default;
  const c = category.toLowerCase();
  if (c.includes('notice') || c.includes('legal')) return DOC_ICONS.notice;
  if (c.includes('court') || c.includes('petition') || c.includes('appeal') || c.includes('complaint') || c.includes('bail') || c.includes('writ')) return DOC_ICONS.court;
  if (c.includes('agreement') || c.includes('contract') || c.includes('lease') || c.includes('nda') || c.includes('mou')) return DOC_ICONS.agreement;
  if (c.includes('corporate') || c.includes('resolution') || c.includes('board')) return DOC_ICONS.corporate;
  if (c.includes('property') || c.includes('deed') || c.includes('sale') || c.includes('conveyance')) return DOC_ICONS.property;
  return DOC_ICONS.default;
}

const StarIcon = ({ filled }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

function TemplateCard({ template, isStarred, onStar, onUse }) {
  const category = template.category || template.id?.split('_')[0] || '';
  const sectionCount = template.sections?.length || 0;

  return (
    <div className="ads-tpl-card" onClick={() => onUse(template)}>
      <div className="ads-tpl-card__icon">
        {pickIcon(category)}
      </div>
      <div className="ads-tpl-card__name">{template.label || template.id}</div>
      {template.description && (
        <div className="ads-tpl-card__desc">{template.description}</div>
      )}
      <div className="ads-tpl-card__footer">
        {category && <span className="ads-tpl-card__badge">{category}</span>}
        {sectionCount > 0 && (
          <span className="ads-tpl-card__slots">{sectionCount} section{sectionCount !== 1 ? 's' : ''}</span>
        )}
      </div>
      <button
        className={`ads-tpl-card__star${isStarred ? ' starred' : ''}`}
        onClick={(e) => { e.stopPropagation(); onStar(template.id); }}
        title={isStarred ? 'Unstar' : 'Star this template'}
      >
        <StarIcon filled={isStarred} />
      </button>
    </div>
  );
}

export default memo(TemplateCard);
