// Talks to the WordCraft WASM editor through the exports our patch adds
// (apps/wordcraft-web/src/bridge.rs). The editor runs in a same-origin iframe, so the parent
// page can reach `iframe.contentWindow.wasmBindings.*` directly.
//
//   wc_ready() -> bool
//   wc_load(name, base64)         open a doc from bytes (format from the name's extension)
//   wc_exec(id, paramsJson)       run any engine command
//   wc_text() / wc_html()         read the document out
//   wc_rev() / wc_doc_id()        change counter + which doc is open
//   wc_request_bytes(ext) + wc_take_bytes(ext)   export to bytes (docx/pdf/…)

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export class WordCraftBridge {
  constructor(iframe) { this.iframe = iframe; }

  get api() {
    try { return this.iframe?.contentWindow?.wasmBindings || null; } catch { return null; }
  }

  isReady() {
    const a = this.api;
    try { return !!(a && typeof a.wc_ready === 'function' && a.wc_ready()); } catch { return false; }
  }

  // Resolve once the WASM has booted and mounted its first document.
  whenReady(timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        if (this.isReady()) return resolve();
        if (Date.now() - t0 > timeoutMs) return reject(new Error('WordCraft did not become ready'));
        setTimeout(tick, 120);
        return undefined;
      };
      tick();
    });
  }

  load(name, content) { try { this.api?.wc_load(name, utf8ToBase64(content)); } catch (e) { console.warn('wc_load', e); } }
  // Load a draft and leave WordCraft showing the document (dismiss its File/Home start screen).
  loadHtml(html) { this.load('draft.html', html); this.showDocument(); }
  showDocument() { this.exec('ui.backstage', { value: false }); }

  exec(id, params = {}) { try { this.api?.wc_exec(id, JSON.stringify(params)); } catch (e) { console.warn('wc_exec', id, e); } }

  text() { try { return this.api?.wc_text() || ''; } catch { return ''; } }
  html() { try { return this.api?.wc_html() || ''; } catch { return ''; } }
  selection() { try { return this.api?.wc_selection?.() || ''; } catch { return ''; } }
  rev() { try { return this.api?.wc_rev() || 0; } catch { return 0; } }
  docId() { try { return this.api?.wc_doc_id() || 0; } catch { return 0; } }

  // Request a format, then poll for the bytes (produced on the next frame).
  async bytes(ext, timeoutMs = 4000) {
    const a = this.api;
    if (!a) return null;
    try { a.wc_request_bytes(ext); } catch { return null; }
    const t0 = Date.now();
    for (;;) {
      let out;
      try { out = a.wc_take_bytes(ext); } catch { out = null; }
      if (out && out.length) return out; // Uint8Array
      if (Date.now() - t0 > timeoutMs) return null;
      await new Promise((r) => setTimeout(r, 90));
    }
  }

  // --- document-editing commands (WordCraft's agent vocabulary) ---------------
  insertText(text) { this.exec('text.insert', { text }); }
  // Replace the current selection with text (text.insert types over the selection).
  replaceSelection(text) { this.exec('text.insert', { text }); }
  // select.text counts non-overlapping matches paragraph by paragraph, in document order.
  selectText(text, occurrence) { this.exec('select.text', occurrence ? { text, occurrence } : { text }); }
  collapseSelection(toEnd = true) { this.exec('select.collapse', { end: !!toEnd }); }
  replaceAll(find, withText) { this.exec('edit.replaceAll', { text: find, with: withText }); }
  setText(text) { this.exec('document.setText', { text }); }

  // --- character formatting (engine ids from crates/engine/src/cmd/format.rs) -------------
  // `value` makes these set rather than toggle, so re-applying never flips formatting off.
  bold(value = true) { this.exec('format.bold', { value: !!value }); }
  italic(value = true) { this.exec('format.italic', { value: !!value }); }
  underline(value = true) { this.exec('format.underline', { value: !!value }); }

  // Poll until `test()` is truthy (commands are applied on the editor's next frame).
  async waitFor(test, timeoutMs = 1500, stepMs = 30) {
    const t0 = Date.now();
    for (;;) {
      let ok = false;
      try { ok = !!test(); } catch { ok = false; }
      if (ok) return true;
      if (Date.now() - t0 > timeoutMs) return false;
      await new Promise((r) => setTimeout(r, stepMs));
    }
  }

  // Replace the selection with inline-formatted runs ([{text, bold, italic, underline}]), keeping
  // the formatting: insert the plain text, then re-select each formatted run inside the inserted
  // region and apply the engine's bold/italic/underline. Falls back to plain text on any trouble.
  // Returns {inserted, formatted, skipped}.
  async replaceSelectionWithRuns(runs) {
    const list = (Array.isArray(runs) ? runs : []).filter((r) => r && typeof r.text === 'string' && r.text.length);
    const plain = list.map((r) => r.text).join('');
    const before = this.text();
    const rev0 = this.rev();
    this.replaceSelection(plain);
    const changed = await this.waitFor(() => this.rev() !== rev0, 2000, 40);
    const out = { inserted: changed, formatted: 0, skipped: 0 };
    const wanted = list.filter((r) => r.bold || r.italic || r.underline);
    if (!changed || !plain || !wanted.length) return out;

    const after = this.text();
    const pos = insertionOffset(before, after, plain);
    if (pos < 0) { out.skipped = wanted.length; return out; }

    // Walk the runs in order so each formatted piece is located by its absolute offset.
    let rel = 0;
    let lastPiece = null;
    for (const run of list) {
      const pieces = run.text.split('\n');
      let inner = 0;
      for (const piece of pieces) {
        if (piece && (run.bold || run.italic || run.underline)) {
          const occ = occurrenceAt(after, piece, pos + rel + inner);
          let ok = false;
          if (occ > 0) {
            this.selectText(piece, occ);
            ok = await this.waitFor(() => this.selection() === piece, 1200);
          }
          if (ok) {
            if (run.bold) this.bold(true);
            if (run.italic) this.italic(true);
            if (run.underline) this.underline(true);
            out.formatted += 1;
            lastPiece = { piece, occ };
          } else {
            out.skipped += 1;
          }
        }
        inner += piece.length + 1; // the split-off newline
      }
      rel += run.text.length;
    }

    // Leave the rewritten text selected so a follow-up instruction can refine it again; when it
    // spans paragraphs (select.text cannot cross them) just park the caret after the last run.
    if (!plain.includes('\n')) {
      const occ = occurrenceAt(after, plain, pos);
      if (occ > 0) {
        this.selectText(plain, occ);
        await this.waitFor(() => this.selection() === plain, 800);
        return out;
      }
    }
    if (lastPiece) this.collapseSelection(true);
    return out;
  }
}

// Parse the inline HTML the rewrite AI returns (<strong>/<b>, <em>/<i>, <u>, <br>) into runs of
// text with flat formatting flags. Unknown tags contribute their text; <br> becomes a newline.
export function parseInlineRuns(html) {
  const el = document.createElement('div');
  el.innerHTML = String(html || '');
  const runs = [];
  const push = (text, f) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && last.bold === f.bold && last.italic === f.italic && last.underline === f.underline) last.text += text;
    else runs.push({ text, bold: f.bold, italic: f.italic, underline: f.underline });
  };
  const walk = (node, f) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) { push(child.nodeValue.replace(/\s+/g, ' '), f); continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === 'br') { push('\n', f); continue; }
      if (tag === 'script' || tag === 'style') continue;
      const next = {
        bold: f.bold || tag === 'strong' || tag === 'b',
        italic: f.italic || tag === 'em' || tag === 'i',
        underline: f.underline || tag === 'u',
      };
      walk(child, next);
      // Block-level tags in an "inline-only" answer still read as separate lines.
      if (/^(p|div|li|h[1-6])$/.test(tag)) push('\n', f);
    }
  };
  walk(el, { bold: false, italic: false, underline: false });
  // Trim the outer whitespace the model tends to add, keeping inner runs intact.
  if (runs.length) {
    runs[0].text = runs[0].text.replace(/^\s+/, '');
    runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, '');
  }
  return runs.filter((r) => r.text.length);
}

// Where `inserted` landed: the largest offset p within the unchanged prefix of before/after at
// which `after` continues with the inserted text. -1 when it cannot be located.
function insertionOffset(before, after, inserted) {
  let common = 0;
  const lim = Math.min(before.length, after.length);
  while (common < lim && before.charCodeAt(common) === after.charCodeAt(common)) common += 1;
  for (let p = Math.min(common, after.length - inserted.length); p >= 0; p -= 1) {
    if (after.startsWith(inserted, p)) return p;
  }
  return -1;
}

// 1-based occurrence number select.text needs to land on the match that starts at `target`,
// mirroring the engine's non-overlapping left-to-right scan; 0 when no match starts there.
function occurrenceAt(text, needle, target) {
  if (!needle) return 0;
  let count = 0;
  let i = text.indexOf(needle);
  while (i !== -1) {
    count += 1;
    if (i === target) return count;
    if (i > target) return 0;
    i = text.indexOf(needle, i + needle.length);
  }
  return 0;
}
