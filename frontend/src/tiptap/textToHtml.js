// Preprocessing utility: raw contract text -> HTML for TipTap's setContent.
// Deliberately NOT an LLM call — this is pure string splitting so the
// editor's initial content is deterministic and instant.

export function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Splits on line breaks and wraps each line in its own <p>. Normalizes
// \r\n first — PDF/DOCX extraction on the backend can hand back either
// line-ending style, and a stray \r left inside a paragraph's text would
// silently break the risk-decoration text search later (positionMapping
// searches against doc.textBetween, which would include that \r).
//
// wrapAiGenerated: when true, each line's text is additionally wrapped in
// <span class="ai-generated-text">, tagging it with the aiGenerated mark
// (tiptap/aiGeneratedMark.js) on parse — used for the Auto-Draft Studio's
// freshly-synthesized content so it renders with the emerald "AI diff"
// styling immediately, without a second pass over the document.
export function rawTextToHtml(rawText, wrapAiGenerated = false) {
  const normalized = (rawText || '').replace(/\r\n/g, '\n');
  if (!normalized) return '<p></p>';

  const lines = normalized.split('\n');
  const html = lines
    .map((line) => {
      const escaped = escapeHtml(line);
      const inner = wrapAiGenerated ? `<span class="ai-generated-text">${escaped}</span>` : escaped;
      return `<p>${inner}</p>`;
    })
    .join('');
  return html || '<p></p>';
}
