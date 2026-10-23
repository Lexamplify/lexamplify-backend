// WordCraft boot (external file so the strict CSP script-src 'self' allows it).
// On a brotli-serving host (Cloudflare Pages / Netlify) the server compresses this .wasm and the
// browser decompresses it natively (Content-Encoding: br) — the ~30 MB file transfers as ~7 MB
// with no client-side decoder. Standard streaming init is all that's needed.
import init, * as bindings from './wordcraft-web-d656851965f9f036.js';
const wasm = await init({ module_or_path: './wordcraft-web-12c248babe565607_bg.wasm' });
window.wasmBindings = bindings;
dispatchEvent(new CustomEvent("TrunkApplicationStarted", { detail: { wasm } }));
