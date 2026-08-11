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
  let text = (rawText || '').trim();
  if (!text) return '<p></p>';

  // Normalize line endings
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Rebuild the paragraphs from the raw text lines
  const rawLines = text.split('\n');
  const processedLines = [];
  
  for (let i = 0; i < rawLines.length; i++) {
    const current = rawLines[i].trim();
    if (!current) continue;
    
    // Check if the current line is a standalone list marker or number
    // and the next line is the beginning of the clause text.
    const isListMarker = /^(?:\d{1,2}\.|\b[a-zA-Z]\.|\b[IVXDivxd]+\.|\(\d{1,2}\)|\([a-zA-Z]\))$/.test(current);
    
    if (isListMarker && i + 1 < rawLines.length) {
      let nextLine = rawLines[i + 1].trim();
      while (!nextLine && i + 2 < rawLines.length) {
        i++;
        nextLine = rawLines[i + 1].trim();
      }
      if (nextLine) {
        processedLines.push(current + " " + nextLine);
        i++;
        continue;
      }
    }
    
    processedLines.push(current);
  }

  // Group consecutive lines that represent the same paragraph.
  const paragraphs = [];
  let currentPara = "";

  for (let i = 0; i < processedLines.length; i++) {
    const line = processedLines[i];
    
    if (!currentPara) {
      currentPara = line;
      continue;
    }

    // Determine if we should start a new paragraph:
    const startsWithMarker = /^(?:\d{1,2}\.|\b[a-zA-Z]\.|\(\d{1,2}\)|\([a-zA-Z]\))\s+/.test(line);
    const prevEndsWithPunct = /[.?!:]$/.test(currentPara);
    const prevIsShort = currentPara.length < 50;
    const startsWithCapital = /^[A-Z]/.test(line);

    if (startsWithMarker || prevIsShort || (prevEndsWithPunct && startsWithCapital)) {
      paragraphs.push(currentPara);
      currentPara = line;
    } else {
      currentPara += " " + line;
    }
  }
  
  if (currentPara) {
    paragraphs.push(currentPara);
  }

  // Format paragraphs as HTML, collapsing multiple spaces to a single space
  let lines = paragraphs.map(p => p.replace(/\s+/g, ' ').trim()).filter(p => p.length > 0);
  let truncated = false;
  if (lines.length > MAX_PARAGRAPHS) {
    lines = lines.slice(0, MAX_PARAGRAPHS);
    truncated = true;
  }

  const html = lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
    + (truncated ? '<p>[Content truncated — document exceeds the maximum supported length.]</p>' : '');
  return html || '<p></p>';
}
