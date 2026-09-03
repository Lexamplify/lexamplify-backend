import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Configure marked with GFM and breaks: true (preserves single legal line breaks without collapsing)
marked.setOptions({
  gfm: true,
  breaks: true,
});

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

export function sanitizeHtml(html) {
  if (typeof window !== 'undefined' && DOMPurify && typeof DOMPurify.sanitize === 'function') {
    return DOMPurify.sanitize(html);
  }
  return html;
}

// Detects whether a paragraph's first line reads as a clause/section
// heading — either "1. TITLE" / "1 TITLE" (top-level only: no sub-numbering
// like "1.1", and the text after the number is itself caps/punctuation
// only, not prose) or a standalone ALL-CAPS line like "FOR THE CLIENT".
// Deliberately excludes numbered sub-clauses ("5.2 Payment shall be made
// ...") — those have lowercase prose after the number and must stay as
// plain paragraphs, not headings.
function isHeadingLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 90) return false;
  const numbered = trimmed.match(/^(\d+(?:\.\d+)*)\.?\s+(.+)$/);
  if (numbered) {
    const [, num, rest] = numbered;
    return !num.includes('.') && /^[A-Z0-9][A-Z0-9\s,&/().'-]*$/.test(rest);
  }
  return /^[A-Z][A-Z0-9\s,&/().'-]{3,}$/.test(trimmed);
}

// Wraps bracketed placeholders ([Client Legal Name], [Amount], [Number]
// days, ...) in a real Tiptap Highlight mark. <mark> (with a data-color or
// inline background-color style) is what @tiptap/extension-highlight's
// own parseHTML() matches — verified against its source — so this survives
// being parsed into the editor's schema as an actual highlight mark, not
// just inert styling that gets stripped on parse.
function highlightPlaceholders(escapedText) {
  return escapedText.replace(
    /\[([^\]\n]{1,80})\]/g,
    (match, inner) =>
      `<mark data-color="rgba(59,130,246,0.16)" style="background-color: rgba(59,130,246,0.16); color: #1D4ED8; padding: 1px 4px; border-radius: 4px; font-weight: 600;">[${inner}]</mark>`
  );
}

// Turns raw extracted text (from an uploaded PDF/DOCX/TXT draft) into HTML
// with real headings and highlighted placeholders, instead of relying on
// rawTextToHtml's generic markdown pass — a plain extracted legal template
// has no markdown syntax of its own (no ### or **), so marked() would just
// wrap everything in flat <p> tags with no visual structure at all. Applied
// to the PLAIN TEXT before any HTML exists, per the same reasoning
// rawTextToHtml already follows: regex on raw text is safe and predictable;
// regex on HTML risks corrupting tags.
export function smartFormatUploadedText(text) {
  if (!text || !text.trim()) return '<p></p>';
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  const html = paragraphs.map((para) => {
    const firstLine = para.split('\n')[0];
    const escaped = highlightPlaceholders(escapeHtml(para)).replace(/\n/g, '<br>');
    return isHeadingLine(firstLine) ? `<h3>${escaped}</h3>` : `<p>${escaped}</p>`;
  }).join('');

  return html || '<p></p>';
}

export function rawTextToHtml(rawText) {
  if (rawText === null || rawText === undefined) return '<p></p>';
  let text = typeof rawText === 'string' ? rawText : String(rawText);
  text = text.trim();
  if (!text) return '<p></p>';

  // Normalize line endings
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // If text already contains block HTML tags, sanitize and return
  if (/<\/(?:p|h[1-6]|div|ul|ol|li|blockquote)>/i.test(text)) {
    return sanitizeHtml(text);
  }

  // Parse Markdown to HTML using marked with GFM & breaks enabled
  try {
    const parsed = marked.parse(text);
    const html = sanitizeHtml(parsed);
    if (html && html.trim()) {
      return html;
    }
  } catch (err) {
    console.warn('[rawTextToHtml] Marked parsing fallback:', err);
  }

  // Fallback formatting if needed
  const rawLines = text.split('\n').filter((l) => l.trim().length > 0);
  let lines = rawLines.slice(0, MAX_PARAGRAPHS);
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('') || '<p></p>';
}

