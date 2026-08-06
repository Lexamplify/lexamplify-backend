// Preprocessing utility: raw contract text -> HTML for TipTap's setContent.
// Deliberately NOT an LLM call — this is pure string splitting so the
// editor's initial content is deterministic and instant.

// Paragraph count cap — bounds the ProseMirror doc/DOM node count that
// rawTextToHtml can produce. A well-formed contract never needs anywhere
// near this many paragraphs; adversarial input like "\n".repeat(200000)
// otherwise generates 200,000 <p> elements with no truncation.
const MAX_PARAGRAPHS = 10000;

export function escapeHtml(str) {
  if (str === null || str === undefined || str === '') return '';
  const safe = typeof str === 'string' ? str : String(str);
  return safe
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
export function rawTextToHtml(rawText) {
  if (rawText !== null && rawText !== undefined && typeof rawText !== 'string') {
    rawText = String(rawText);
  }
  const normalized = (rawText || '').replace(/\r\n/g, '\n');
  if (!normalized) return '<p></p>';

  let lines = normalized.split('\n');
  let truncated = false;
  if (lines.length > MAX_PARAGRAPHS) {
    lines = lines.slice(0, MAX_PARAGRAPHS);
    truncated = true;
  }

  const html = lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
    + (truncated ? '<p>[Content truncated — document exceeds the maximum supported length.]</p>' : '');
  return html || '<p></p>';
}
