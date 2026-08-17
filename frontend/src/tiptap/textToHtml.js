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

function sanitizeHtml(html) {
  if (typeof window !== 'undefined' && DOMPurify && typeof DOMPurify.sanitize === 'function') {
    return DOMPurify.sanitize(html);
  }
  return html;
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

