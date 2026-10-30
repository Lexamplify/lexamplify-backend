import { useEffect, useRef, useState } from 'react';
import { WordCraftBridge } from '../../collab/wordcraftBridge.js';

const WORDCRAFT_BASE = `${import.meta.env.BASE_URL}wordcraft/index.html`;
const snapKey = (docId) => `lx-wcdoc-${docId}`;

// Decide the render backend before loading. WordCraft prefers WebGPU but falls back to WebGL2
// with the ?webgl flag. WebGL2 is near-universal; WebGPU is not (and a missing/again-failing
// adapter makes the editor hang on "Loading…"). So: use WebGPU only when an adapter is actually
// available, otherwise WebGL2.
async function pickSrc() {
  try {
    if (navigator.gpu && (await navigator.gpu.requestAdapter())) return WORDCRAFT_BASE;
  } catch { /* fall through */ }
  return WORDCRAFT_BASE + '?webgl';
}

export default function WordCraftEditor({ docId, seedHtml, onBridge, onReady, onChange }) {
  const iframeRef = useRef(null);
  const bridgeRef = useRef(null);
  const [src, setSrc] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const triedWebglRef = useRef(false);

  // Choose the backend once.
  useEffect(() => {
    let alive = true;
    pickSrc().then((s) => { if (alive) { if (s.includes('?webgl')) triedWebglRef.current = true; setSrc(s); } });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!src) return undefined;
    let cancelled = false;
    const iframe = iframeRef.current;
    if (!iframe) return undefined;

    const bridge = new WordCraftBridge(iframe);
    bridgeRef.current = bridge;
    let booted = false;

    function removeInnerLoader() {
      try { iframe.contentDocument?.getElementById('wordcraft_loading')?.remove(); } catch { /* ignore */ }
    }

    function boot() {
      if (booted) return;
      booted = true;
      bridge
        .whenReady(120000)
        .then(() => {
          if (cancelled) return;
          removeInnerLoader();
          let saved = null;
          try { saved = localStorage.getItem(snapKey(docId)); } catch { saved = null; }
          const html = saved || seedHtml || '';
          if (html) bridge.loadHtml(html);
          setStatus('ready');
          onReady?.();
          onBridge?.(bridge);
        })
        .catch(() => { if (!cancelled) setStatus('ready'); onBridge?.(bridge); });
    }

    if (iframe.contentWindow && bridge.api) boot();
    iframe.addEventListener('load', boot);
    const kick = setTimeout(boot, 400);

    // If WebGPU was chosen but never becomes ready, fall back to WebGL2 once (the wasm is cached
    // by URL, so reloading with ?webgl re-inits quickly without re-downloading).
    let fallback = null;
    if (!triedWebglRef.current) {
      fallback = setTimeout(() => {
        if (cancelled || bridge.isReady()) return;
        triedWebglRef.current = true;
        booted = false;
        setSrc(WORDCRAFT_BASE + '?webgl');
      }, 18000);
    }

    return () => { cancelled = true; iframe.removeEventListener('load', boot); clearTimeout(kick); if (fallback) clearTimeout(fallback); };
  }, [src, docId, seedHtml, onBridge, onReady]);

  // Ensure the draft lands once WordCraft is awake; retry until it has content.
  useEffect(() => {
    if (status !== 'ready') return undefined;
    const bridge = bridgeRef.current;
    let tries = 0;
    const id = setInterval(() => {
      tries += 1;
      if (!bridge.isReady()) return;
      try { iframeRef.current?.contentDocument?.getElementById('wordcraft_loading')?.remove(); } catch { /* ignore */ }
      const hasContent = (bridge.text() || '').trim().length > 0;
      if (hasContent || tries > 60) { clearInterval(id); return; }
      let saved = null;
      try { saved = localStorage.getItem(snapKey(docId)); } catch { saved = null; }
      const html = saved || seedHtml || '';
      if (html) bridge.loadHtml(html);
    }, 500);
    return () => clearInterval(id);
  }, [status, docId, seedHtml]);

  // Autosave: watch the revision; persist an HTML snapshot and report changes.
  useEffect(() => {
    if (status !== 'ready') return undefined;
    const bridge = bridgeRef.current;
    let lastRev = -1;
    const id = setInterval(() => {
      if (!bridge.isReady()) return;
      const rev = bridge.rev();
      if (rev === lastRev) return;
      lastRev = rev;
      const html = bridge.html();
      if (html) { try { localStorage.setItem(snapKey(docId), html); } catch { /* ignore */ } }
      onChange?.({ rev, html, text: bridge.text() });
    }, 1200);
    return () => clearInterval(id);
  }, [status, docId, onChange]);

  return (
    <div className="wce">
      {status !== 'ready' && (
        <div className="wce-overlay">
          <div className="wce-spinner" />
          <div className="wce-loadtext">Loading the editor…</div>
          <div className="wce-loadsub">First time can take a moment — it caches after that.</div>
        </div>
      )}
      {src && (
        <iframe
          ref={iframeRef}
          title="WordCraft editor"
          src={src}
          allow="fullscreen; clipboard-read; clipboard-write"
          className="wce-frame"
        />
      )}
    </div>
  );
}
