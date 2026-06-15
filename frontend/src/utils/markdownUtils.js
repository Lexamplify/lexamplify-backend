export const MARKDOWN_CSS = `
  .md-body { width: 100%; }
  .md-p    { margin: 0 0 8px; }
  .md-p:last-child { margin-bottom: 0; }
  .md-h2   { font-size: 15px; font-weight: 800; color: var(--text-primary, white); margin: 12px 0 6px; }
  .md-h3   { font-size: 14px; font-weight: 700; color: #E2E8F0; margin: 10px 0 5px; }
  .md-h4   { font-size: 11.5px; font-weight: 800; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.6px; margin: 8px 0 4px; }
  .md-b    { font-weight: 700; color: #F1F5F9; }
  .md-i    { font-style: italic; color: #CBD5E1; }
  .md-code { background: rgba(59,130,246,0.12); padding: 2px 6px; border-radius: 4px; font-size: 12.5px; font-family: 'Fira Mono', monospace; color: #93C5FD; }
  .md-bullet { display: flex; gap: 9px; margin: 4px 0; align-items: flex-start; }
  .md-dot    { color: #3B82F6; flex-shrink: 0; margin-top: 2px; }
  .md-num    { display: flex; gap: 9px; margin: 4px 0; align-items: flex-start; }
  .md-num-n  { color: #3B82F6; flex-shrink: 0; font-weight: 700; min-width: 20px; }
`;

export const renderMarkdown = (raw) => {
  if (!raw) return '';
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const html = escaped
    .replace(/^### (.+)$/gm, '<h4 class="md-h4">$1</h4>')
    .replace(/^## (.+)$/gm,  '<h3 class="md-h3">$1</h3>')
    .replace(/^# (.+)$/gm,   '<h2 class="md-h2">$1</h2>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong class="md-b">$1</strong>')
    .replace(/\*([^*\n]+)\*/g,     '<em class="md-i">$1</em>')
    .replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>')
    .replace(/^[-•*]\s+(.+)$/gm, '<div class="md-bullet"><span class="md-dot">▸</span><span>$1</span></div>')
    .replace(/^(\d+)\.\s+(.+)$/gm, '<div class="md-num"><span class="md-num-n">$1.</span><span>$2</span></div>')
    .replace(/\n{2,}/g, '</p><p class="md-p">')
    .replace(/\n/g, '<br/>');

  return `<p class="md-p">${html}</p>`;
};
