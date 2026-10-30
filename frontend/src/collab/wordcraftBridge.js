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
  selectText(text, occurrence) { this.exec('select.text', occurrence ? { text, occurrence } : { text }); }
  replaceAll(find, withText) { this.exec('edit.replaceAll', { text: find, with: withText }); }
  setText(text) { this.exec('document.setText', { text }); }
}
