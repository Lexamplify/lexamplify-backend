// Visual design of the vault's document workspace (ribbon, page canvas, assistant, save dialog). Uses the app's
// "Slate & Rust" tokens so it follows the light / dark theme; the sheet of paper itself is always white, like Word.
export const wordStyles = `
.vw-root { --vw-accent: var(--accent, #C8553D); --vw-accent-soft: var(--accent-soft, #F7E3DC); --vw-line: var(--rule, #E5E1D8); --vw-bg: var(--bg, #F4F1EA); --vw-surface: var(--paper, #FBFAF7); --vw-surface2: var(--paper-2, #F3F0E9); --vw-ink: var(--ink, #1B1D1F); --vw-soft: var(--ink-soft, #55595C); --vw-muted: var(--muted, #7A7E80);
  position: fixed; inset: 0; z-index: 10000; display: flex; flex-direction: column; background: var(--vw-bg); color: var(--vw-ink); font-family: 'IBM Plex Sans', 'Inter', system-ui, sans-serif; font-size: 13px; }
.vw-float { --vw-accent: var(--accent, #C8553D); --vw-accent-soft: var(--accent-soft, #F7E3DC); --vw-line: var(--rule, #E5E1D8); --vw-surface: var(--paper, #FBFAF7); --vw-surface2: var(--paper-2, #F3F0E9); --vw-ink: var(--ink, #1B1D1F); --vw-soft: var(--ink-soft, #55595C); --vw-muted: var(--muted, #7A7E80); font-family: 'IBM Plex Sans', 'Inter', system-ui, sans-serif; font-size: 13px; }
.vw-float.vw-menu { position: fixed; z-index: 10030; }
.vw-root *, .vw-modal-back *, .vw-float * { box-sizing: border-box; }
.vw-spin { animation: vw-spin 0.9s linear infinite; } @keyframes vw-spin { to { transform: rotate(360deg); } }

/* top bar */
.vw-top { display: flex; align-items: center; gap: 12px; height: 58px; padding: 0 14px; background: var(--vw-surface); border-bottom: 1px solid var(--vw-line); flex-shrink: 0; }
.vw-back { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; color: var(--vw-soft); font: inherit; font-weight: 600; padding: 7px 10px 7px 6px; border-radius: 9px; cursor: pointer; }
.vw-back:hover { background: var(--vw-surface2); color: var(--vw-ink); }
.vw-doc { display: flex; align-items: center; gap: 11px; min-width: 0; }
.vw-doc-ico { width: 34px; height: 34px; border-radius: 9px; background: var(--vw-accent-soft); color: var(--vw-accent); display: grid; place-items: center; flex-shrink: 0; }
.vw-doc-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.vw-doc-title { font-family: 'Source Serif 4', Georgia, serif; font-size: 16.5px; font-weight: 600; margin: 0; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: min(46vw, 560px); }
.vw-doc-sub { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--vw-muted); white-space: nowrap; overflow: hidden; }
.vw-state { display: inline-flex; align-items: center; gap: 5px; }
.vw-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vw-muted); }
.vw-dot.dirty { background: #E0A100; } .vw-dot.saved { background: #2E9E5B; }
.vw-linkchip { border: 0; background: transparent; color: var(--vw-accent); font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; padding: 0; max-width: 28ch; overflow: hidden; text-overflow: ellipsis; }
.vw-linkchip:hover { text-decoration: underline; }
.vw-spacer { flex: 1; }
.vw-action { display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 14px; border-radius: 9px; border: 1px solid var(--vw-line); background: var(--vw-surface); color: var(--vw-ink); font: inherit; font-weight: 600; cursor: pointer; }
.vw-action:hover:not(:disabled) { background: var(--vw-surface2); }
.vw-action.primary { background: var(--vw-accent); border-color: var(--vw-accent); color: #fff; }
.vw-action.primary:hover:not(:disabled) { filter: brightness(1.07); background: var(--vw-accent); }
.vw-action:disabled { opacity: .5; cursor: not-allowed; }
.vw-action.on { background: var(--vw-accent-soft); border-color: transparent; color: var(--vw-accent); }
.vw-split { position: relative; display: inline-flex; }
.vw-split > .vw-action:first-child { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.vw-split > .vw-action.caret { border-top-left-radius: 0; border-bottom-left-radius: 0; border-left: 1px solid rgba(255,255,255,.35); padding: 0 9px; }
.vw-split .vw-menu { right: 0; left: auto; top: calc(100% + 6px); min-width: 240px; }

/* ribbon */
.vw-ribbon { background: var(--vw-surface); border-bottom: 1px solid var(--vw-line); flex-shrink: 0; }
.vw-tabs { display: flex; gap: 2px; padding: 0 12px; }
.vw-tab { border: 0; background: transparent; color: var(--vw-soft); font: inherit; font-weight: 600; padding: 9px 14px 8px; cursor: pointer; border-bottom: 2px solid transparent; }
.vw-collapse { margin-left: auto; font-size: 12px; font-weight: 600; color: var(--vw-muted); }
.vw-panel[hidden] { display: none !important; }
.vw-tab:hover { color: var(--vw-ink); } .vw-tab.on { color: var(--vw-accent); border-bottom-color: var(--vw-accent); }
.vw-panel { display: flex; align-items: stretch; gap: 0; padding: 6px 10px 6px; border-top: 1px solid var(--vw-line); background: var(--vw-surface2); overflow-x: auto; min-height: 84px; }
.vw-group { display: flex; flex-direction: column; justify-content: space-between; padding: 0 12px; border-right: 1px solid var(--vw-line); flex-shrink: 0; }
.vw-group:last-child { border-right: 0; }
.vw-group-row { display: flex; align-items: center; gap: 3px; flex: 1; }
.vw-group-label { text-align: center; font-size: 10.5px; color: var(--vw-muted); letter-spacing: .02em; padding-top: 4px; }
.vw-stack { display: flex; flex-direction: column; gap: 4px; justify-content: center; }
.vw-row { display: flex; align-items: center; gap: 2px; }
.vw-btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 30px; height: 30px; padding: 0 6px; border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--vw-ink); cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 500; }
.vw-btn.wide { padding: 0 9px; }
.vw-btn:hover:not(:disabled) { background: var(--vw-surface); border-color: var(--vw-line); }
.vw-btn.on { background: var(--vw-accent-soft); color: var(--vw-accent); border-color: transparent; }
.vw-btn:disabled { opacity: .35; cursor: default; }
.vw-btn:focus-visible, .vw-select:focus-visible, .vw-tab:focus-visible, .vw-action:focus-visible { outline: 2px solid var(--vw-accent); outline-offset: 1px; }
.vw-root select.vw-select { height: 30px !important; min-height: 0 !important; margin: 0 !important; border: 1px solid var(--vw-line) !important; border-radius: 7px !important; background-color: var(--vw-surface) !important; color: var(--vw-ink) !important; font: inherit !important; font-size: 12.5px !important; line-height: 1.2 !important; padding: 0 6px !important; cursor: pointer; display: inline-block; box-shadow: none !important; width: auto; }
.vw-root select.vw-select.vw-family { width: 150px; } .vw-root select.vw-select.vw-size { width: 60px; } .vw-root select.vw-select.vw-style { width: 132px; height: 34px !important; } .vw-modal select.vw-select.block, .vw-modal-back select.vw-select.block { width: 100%; height: 38px !important; padding: 0 10px !important; border: 1px solid var(--vw-line) !important; border-radius: 9px !important; background-color: var(--vw-surface2) !important; color: var(--vw-ink) !important; font: inherit !important; line-height: 1.2 !important; }
.vw-aa { font-weight: 700; font-size: 15px; font-family: Georgia, serif; } .vw-aa.sm { font-size: 11px; }
.vw-color-ico { position: relative; display: inline-grid; place-items: center; }
.vw-color-ico i { position: absolute; left: 1px; right: 1px; bottom: -3px; height: 3px; border-radius: 2px; }
.vw-zoomval { min-width: 46px; text-align: center; font-weight: 600; font-variant-numeric: tabular-nums; }
.vw-pop { position: relative; display: inline-flex; }
.vw-menu { position: absolute; z-index: 30; top: calc(100% + 6px); min-width: 170px; background: var(--vw-surface); border: 1px solid var(--vw-line); border-radius: 12px; box-shadow: 0 16px 40px rgba(0,0,0,.28); padding: 6px; display: flex; flex-direction: column; }
.vw-menu.left { left: 0; } .vw-menu.right { right: 0; }
.vw-menu-item { display: flex; align-items: center; gap: 9px; width: 100%; text-align: left; border: 0; background: transparent; color: var(--vw-ink); font: inherit; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
.vw-menu-item:hover { background: var(--vw-surface2); } .vw-menu-item.on { color: var(--vw-accent); font-weight: 700; }
.vw-menu-item small { margin-left: auto; color: var(--vw-muted); font-size: 11px; }
.vw-menu-sep { height: 1px; background: var(--vw-line); margin: 5px 4px; }
.vw-menu-title { font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--vw-muted); padding: 6px 10px 3px; }
.vw-palette { width: 196px; } .vw-swatches { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; padding: 4px 4px 8px; }
.vw-swatch { width: 18px; height: 18px; border-radius: 4px; border: 1px solid rgba(127,127,127,.4); cursor: pointer; padding: 0; } .vw-swatch:hover { transform: scale(1.15); }
.vw-custom { position: relative; } .vw-custom input { position: absolute; right: 8px; top: 7px; width: 28px; height: 20px; border: 0; padding: 0; background: none; cursor: pointer; }
.vw-tgrid-wrap { padding: 6px; } .vw-tgrid { display: grid; grid-template-columns: repeat(8, 20px); gap: 3px; }
.vw-tgrid button { width: 20px; height: 20px; border: 1px solid var(--vw-line); border-radius: 3px; background: var(--vw-surface); cursor: pointer; padding: 0; } .vw-tgrid button.hot { background: var(--vw-accent-soft); border-color: var(--vw-accent); }
.vw-tgrid-cap { font-size: 11.5px; color: var(--vw-soft); text-align: center; padding-top: 7px; }
.vw-symbols { display: grid; grid-template-columns: repeat(7, 30px); gap: 2px; padding: 2px; } .vw-symbols button { height: 30px; border: 0; border-radius: 6px; background: transparent; color: var(--vw-ink); font-size: 15px; cursor: pointer; } .vw-symbols button:hover { background: var(--vw-surface2); }
.vw-link { display: flex; gap: 6px; padding: 4px; width: 330px; } .vw-link input { flex: 1; height: 32px; border: 1px solid var(--vw-line); border-radius: 8px; padding: 0 10px; background: var(--vw-surface2); color: var(--vw-ink); font: inherit; outline: none; } .vw-link input:focus { border-color: var(--vw-accent); }
.vw-mini { display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 30px; min-width: 30px; padding: 0 10px; border: 1px solid var(--vw-line); border-radius: 8px; background: var(--vw-surface); color: var(--vw-ink); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.vw-mini.icon { padding: 0; border-color: transparent; background: transparent; color: var(--vw-soft); } .vw-mini:hover:not(:disabled) { background: var(--vw-surface2); }
.vw-mini.primary { background: var(--vw-accent); border-color: var(--vw-accent); color: #fff; } .vw-mini:disabled { opacity: .45; cursor: default; }
.vw-find { background: var(--vw-surface); border-bottom: 1px solid var(--vw-line); padding: 8px 14px; display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
.vw-find-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.vw-find-input { height: 32px; width: 280px; max-width: 100%; border: 1px solid var(--vw-line); border-radius: 8px; padding: 0 10px; background: var(--vw-surface2); color: var(--vw-ink); font: inherit; outline: none; } .vw-find-input:focus { border-color: var(--vw-accent); }
.vw-find-count { min-width: 64px; font-size: 12px; color: var(--vw-muted); font-variant-numeric: tabular-nums; }
.vw-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--vw-soft); cursor: pointer; } .vw-check.block { margin-top: 2px; }

/* stage */
.vw-main { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); position: relative; }
.vw-main .vw-ai { position: absolute; top: 0; right: 0; bottom: 0; width: min(400px, 100%); z-index: 6; box-shadow: -18px 0 40px rgba(0,0,0,.3); }
.vw-main.noai { grid-template-columns: minmax(0, 1fr); }
.vw-stage { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.vw-desk { flex: 1; min-height: 0; overflow: auto; padding: 14px 18px 60px; background:
  radial-gradient(1200px 500px at 50% -10%, rgba(127,127,127,.10), transparent 60%), var(--vw-bg); }
.vw-sheet { width: 794px; margin: 0 auto; }
.vw-paper .ProseMirror { width: 794px; min-height: 1123px; background: #fff; color: #111; padding: 96px; border-radius: 3px; outline: none;
  box-shadow: 0 1px 2px rgba(0,0,0,.25), 0 18px 48px rgba(0,0,0,.22); font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.15; overflow-wrap: anywhere; caret-color: #111; }
.vw-paper.guides .ProseMirror { background-image: repeating-linear-gradient(to bottom, transparent 0, transparent 1121px, rgba(120,120,120,.35) 1121px, rgba(120,120,120,.35) 1123px); background-origin: border-box; }
.vw-paper .ProseMirror p { margin: 0 0 8pt; min-height: 1em; }
/* the page is always white paper: text stays dark in every app theme, unless the text carries its own colour */
.vw-paper .ProseMirror, .vw-paper .ProseMirror *:not([style*=" color:"]):not([style^="color:"]):not(a) { color: #111 !important; -webkit-text-fill-color: #111; }
.vw-paper .ProseMirror a { color: #0563c1 !important; -webkit-text-fill-color: #0563c1; }
.vw-paper .ProseMirror [style*=" color:"], .vw-paper .ProseMirror [style^="color:"] { -webkit-text-fill-color: currentColor; }
.vw-paper .ProseMirror h1 { font-size: 20pt; margin: 16pt 0 6pt; } .vw-paper .ProseMirror h2 { font-size: 16pt; margin: 14pt 0 6pt; } .vw-paper .ProseMirror h3 { font-size: 14pt; margin: 12pt 0 4pt; } .vw-paper .ProseMirror h4 { font-size: 12pt; margin: 10pt 0 4pt; }
.vw-paper .ProseMirror ul, .vw-paper .ProseMirror ol { margin: 0 0 8pt; padding-left: 30px; }
.vw-paper .ProseMirror ul { list-style: disc outside !important; } .vw-paper .ProseMirror ul ul { list-style: circle outside !important; } .vw-paper .ProseMirror ul ul ul { list-style: square outside !important; }
.vw-paper .ProseMirror ol { list-style: decimal outside !important; } .vw-paper .ProseMirror ol ol { list-style: lower-alpha outside !important; } .vw-paper .ProseMirror ol ol ol { list-style: lower-roman outside !important; }
.vw-paper .ProseMirror li { display: list-item; } .vw-paper .ProseMirror li::marker { color: inherit; } .vw-paper .ProseMirror li > p { margin-bottom: 3pt; }
.vw-paper .ProseMirror blockquote { margin: 0 0 8pt 24pt; padding-left: 12px; border-left: 3px solid #bbb; }
.vw-paper .ProseMirror hr { border: 0; border-top: 1px solid #888; margin: 12pt 0; }
.vw-paper .ProseMirror a { color: #0563c1; text-decoration: underline; }
.vw-paper .ProseMirror img { max-width: 100%; height: auto; }
.vw-paper .ProseMirror img.ProseMirror-selectednode { outline: 2px solid #2563eb; }
.vw-paper .ProseMirror .tableWrapper { overflow-x: auto; margin: 4pt 0 10pt; }
.vw-paper .ProseMirror table { border-collapse: collapse; table-layout: fixed; width: 100%; margin: 0; }
.vw-paper .ProseMirror td, .vw-paper .ProseMirror th { border: 1px solid #555; padding: 4px 7px; vertical-align: top; position: relative; min-width: 1em; box-sizing: border-box; }
.vw-paper .ProseMirror th { background: #efefef; font-weight: 700; text-align: left; } .vw-paper .ProseMirror td > p, .vw-paper .ProseMirror th > p { margin: 0 0 3pt; }
.vw-paper .ProseMirror .selectedCell::after { content: ''; position: absolute; inset: 0; background: rgba(37,99,235,.18); pointer-events: none; }
.vw-paper .ProseMirror .column-resize-handle { position: absolute; right: -2px; top: 0; bottom: -2px; width: 4px; background: #2563eb; pointer-events: none; }
.vw-paper .ProseMirror.resize-cursor { cursor: col-resize; }
.vw-paper .ProseMirror ::selection { background: rgba(37,99,235,.28); }
.vwe-find { background: #ffe58f; border-radius: 2px; } .vwe-find-cur { background: #ff9f43; }
.vw-statusbar { display: flex; align-items: center; gap: 16px; height: 30px; padding: 0 16px; background: var(--vw-surface); border-top: 1px solid var(--vw-line); font-size: 11.5px; color: var(--vw-soft); flex-shrink: 0; font-variant-numeric: tabular-nums; }
.vw-statusbar .vw-spacer { flex: 1; } .vw-statusbar input[type=range] { width: 120px; accent-color: var(--vw-accent); }
.vw-banner { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 16px; background: var(--vw-accent-soft); color: var(--vw-ink); border-bottom: 1px solid var(--vw-line); font-size: 12.5px; flex-shrink: 0; }
.vw-banner button { border: 0; background: transparent; color: var(--vw-accent); font: inherit; font-weight: 700; cursor: pointer; padding: 0; text-decoration: underline; }
.vw-banner .x { margin-left: auto; text-decoration: none; color: var(--vw-soft); }
.vw-loading { margin: auto; text-align: center; color: var(--vw-soft); max-width: 420px; padding: 40px 20px; line-height: 1.6; }
.vw-skeleton { width: 794px; max-width: 100%; margin: 0 auto; min-height: 700px; background: #fff; border-radius: 3px; box-shadow: 0 18px 48px rgba(0,0,0,.18); padding: 96px; display: flex; flex-direction: column; gap: 14px; }
.vw-skeleton i { display: block; height: 11px; border-radius: 6px; background: linear-gradient(90deg, #ececec, #f6f6f6, #ececec); background-size: 200% 100%; animation: vw-shimmer 1.3s linear infinite; } @keyframes vw-shimmer { to { background-position: -200% 0; } }
.vw-toast { position: fixed; left: 50%; bottom: 44px; transform: translateX(-50%); z-index: 10020; display: flex; align-items: center; gap: 12px; max-width: min(640px, 92vw); background: #1d2022; color: #f3f3f1; border-radius: 12px; padding: 11px 16px; box-shadow: 0 16px 40px rgba(0,0,0,.4); font-size: 13px; }
.vw-toast span { color: #f3f3f1 !important; line-height: 1.45; } .vw-toast.err { background: #5a1f1f; } .vw-toast button { border: 0; background: transparent; color: #ffb59f; font: inherit; font-weight: 700; cursor: pointer; }

/* assistant */
.vw-ai { display: flex; flex-direction: column; min-height: 0; background: var(--vw-surface); border-left: 1px solid var(--vw-line); }
.vw-ai-head { display: flex; align-items: center; gap: 10px; padding: 14px 14px 12px; border-bottom: 1px solid var(--vw-line); }
.vw-ai-mark { width: 32px; height: 32px; border-radius: 10px; background: linear-gradient(135deg, var(--vw-accent), #E39A6A); color: #fff; display: grid; place-items: center; flex-shrink: 0; }
.vw-ai-title { display: flex; flex-direction: column; min-width: 0; flex: 1; } .vw-ai-title b { font-size: 14px; } .vw-ai-title span { font-size: 11.5px; color: var(--vw-muted); line-height: 1.35; }
.vw-chat { flex: 1; min-height: 0; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.vw-ai-empty p { margin: 0 0 12px; color: var(--vw-soft); line-height: 1.55; } .vw-ai-tip { font-size: 11.5px; color: var(--vw-muted); margin-top: 14px !important; }
.vw-quick-label { font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--vw-muted); margin: 10px 0 6px; }
.vw-quick-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.vw-quick { display: flex; flex-direction: column; align-items: flex-start; gap: 7px; text-align: left; padding: 11px 12px; border: 1px solid var(--vw-line); border-radius: 12px; background: var(--vw-surface2); color: var(--vw-ink); font: inherit; font-weight: 600; font-size: 12.5px; cursor: pointer; line-height: 1.25; }
.vw-quick svg { color: var(--vw-accent); } .vw-quick:hover:not(:disabled) { border-color: var(--vw-accent); transform: translateY(-1px); } .vw-quick:disabled { opacity: .5; cursor: not-allowed; }
.vw-msg { font-size: 13px; line-height: 1.6; border-radius: 14px; padding: 10px 13px; word-break: break-word; max-width: 100%; }
.vw-msg.user { align-self: flex-end; background: var(--vw-accent); color: #fff; border-bottom-right-radius: 4px; max-width: 88%; }
.vw-msg.assistant { background: var(--vw-surface2); border: 1px solid var(--vw-line); border-bottom-left-radius: 4px; }
.vw-md p { margin: 0 0 8px; } .vw-md p:last-child { margin-bottom: 0; } .vw-md ul, .vw-md ol { margin: 4px 0 8px 18px; padding: 0; } .vw-md h1, .vw-md h2, .vw-md h3 { font-size: 13.5px; margin: 10px 0 4px; }
.vw-msg-actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.vw-msg-actions button { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--vw-line); background: var(--vw-surface); color: var(--vw-ink); border-radius: 8px; padding: 5px 9px; font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; } .vw-msg-actions button:hover { border-color: var(--vw-accent); color: var(--vw-accent); }
.vw-warn { font-size: 11px; color: var(--vw-muted); margin-top: 8px; } .vw-typing { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--vw-muted); }
.vw-compose { border-top: 1px solid var(--vw-line); padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 8px; }
.vw-sel { border: 1px solid var(--vw-accent); background: var(--vw-accent-soft); border-radius: 12px; padding: 8px 10px; }
.vw-sel-head b { display: block; font-weight: 500; font-size: 12px; color: var(--vw-ink); line-height: 1.4; max-height: 3.4em; overflow: hidden; font-style: italic; }
.vw-sel-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; } .vw-sel-chips button { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--vw-line); background: var(--vw-surface); color: var(--vw-ink); border-radius: 999px; padding: 4px 9px; font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; } .vw-sel-chips button:hover:not(:disabled) { border-color: var(--vw-accent); color: var(--vw-accent); }
.vw-compose-row { display: flex; align-items: flex-end; gap: 8px; border: 1px solid var(--vw-line); border-radius: 14px; background: var(--vw-surface2); padding: 6px 6px 6px 12px; } .vw-compose-row:focus-within { border-color: var(--vw-accent); }
.vw-compose-row textarea { flex: 1; resize: none; border: 0; background: transparent; color: var(--vw-ink); font: inherit; font-size: 13px; line-height: 1.5; padding: 6px 0; outline: none; max-height: 140px; }
.vw-send { width: 34px; height: 34px; border-radius: 10px; border: 0; background: var(--vw-accent); color: #fff; display: grid; place-items: center; cursor: pointer; flex-shrink: 0; } .vw-send:disabled { opacity: .4; cursor: default; }

/* dialogs */
.vw-modal-back { position: fixed; inset: 0; z-index: 10010; background: rgba(8,10,12,.55); backdrop-filter: blur(2px); display: grid; place-items: center; padding: 20px; font-family: 'IBM Plex Sans', 'Inter', system-ui, sans-serif; font-size: 13px;
  --vw-accent: var(--accent, #C8553D); --vw-accent-soft: var(--accent-soft, #F7E3DC); --vw-line: var(--rule, #E5E1D8); --vw-surface: var(--paper, #FBFAF7); --vw-surface2: var(--paper-2, #F3F0E9); --vw-ink: var(--ink, #1B1D1F); --vw-soft: var(--ink-soft, #55595C); --vw-muted: var(--muted, #7A7E80); }
.vw-modal { width: min(680px, 100%); max-height: min(780px, 94vh); display: flex; flex-direction: column; background: var(--vw-surface); color: var(--vw-ink); border: 1px solid var(--vw-line); border-radius: 18px; box-shadow: 0 30px 80px rgba(0,0,0,.5); overflow: hidden; }
.vw-modal.small { width: min(440px, 100%); }
.vw-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 18px 20px 12px; } .vw-modal-head h3 { margin: 0 0 3px; font-family: 'Source Serif 4', Georgia, serif; font-size: 20px; } .vw-modal-head p { margin: 0; color: var(--vw-soft); font-size: 12.5px; line-height: 1.5; }
.vw-modal-body { padding: 4px 20px 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
.vw-modal-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 20px 16px; border-top: 1px solid var(--vw-line); background: var(--vw-surface2); }
.vw-field { display: flex; flex-direction: column; gap: 7px; } .vw-field > span { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--vw-muted); font-weight: 600; }
.vw-name { display: flex; align-items: center; border: 1px solid var(--vw-line); border-radius: 10px; background: var(--vw-surface2); padding-right: 12px; } .vw-name:focus-within { border-color: var(--vw-accent); }
.vw-name input { flex: 1; height: 40px; border: 0; background: transparent; padding: 0 12px; font: inherit; font-size: 14px; color: var(--vw-ink); outline: none; } .vw-name em { font-style: normal; color: var(--vw-muted); font-weight: 600; }
.vw-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.vw-tile { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 5px; text-align: left; padding: 12px; border: 1.5px solid var(--vw-line); border-radius: 12px; background: var(--vw-surface); color: var(--vw-ink); font: inherit; cursor: pointer; }
.vw-tile b { font-size: 13.5px; } .vw-tile small { color: var(--vw-muted); font-weight: 600; } .vw-tile i { font-style: normal; font-size: 11.5px; color: var(--vw-soft); line-height: 1.35; } .vw-tile svg:first-child { color: var(--vw-accent); }
.vw-tile.on { border-color: var(--vw-accent); background: var(--vw-accent-soft); } .vw-tick { position: absolute; top: 10px; right: 10px; color: var(--vw-accent); }
.vw-dests { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.vw-dest { display: flex; align-items: center; gap: 11px; text-align: left; padding: 10px 12px; border: 1.5px solid var(--vw-line); border-radius: 12px; background: var(--vw-surface); color: var(--vw-ink); font: inherit; cursor: pointer; }
.vw-dest > svg { color: var(--vw-accent); flex-shrink: 0; } .vw-dest span { display: flex; flex-direction: column; min-width: 0; } .vw-dest b { font-size: 13px; } .vw-dest i { font-style: normal; font-size: 11.5px; color: var(--vw-soft); line-height: 1.3; }
.vw-dest.on { border-color: var(--vw-accent); background: var(--vw-accent-soft); } .vw-dest:disabled { opacity: .5; cursor: not-allowed; }
.vw-pick { border: 1px solid var(--vw-line); border-radius: 12px; overflow: hidden; background: var(--vw-surface); }
.vw-pick-search { display: flex; align-items: center; gap: 8px; padding: 0 12px; border-bottom: 1px solid var(--vw-line); color: var(--vw-muted); } .vw-pick-search input { flex: 1; height: 38px; border: 0; background: transparent; color: var(--vw-ink); font: inherit; outline: none; }
.vw-pick-list { max-height: 190px; overflow-y: auto; padding: 4px; display: flex; flex-direction: column; }
.vw-row-pick { display: flex; align-items: center; gap: 9px; text-align: left; border: 0; background: transparent; color: var(--vw-ink); font: inherit; padding: 8px 10px; border-radius: 8px; cursor: pointer; } .vw-row-pick:hover { background: var(--vw-surface2); } .vw-row-pick.on { background: var(--vw-accent-soft); color: var(--vw-accent); font-weight: 600; }
.vw-row-pick.two span { display: flex; flex-direction: column; min-width: 0; } .vw-row-pick.two b { font-weight: 600; } .vw-row-pick.two i { font-style: normal; font-size: 11.5px; color: var(--vw-soft); }
.vw-pick-empty { padding: 14px 10px; color: var(--vw-muted); font-size: 12.5px; display: flex; align-items: center; gap: 8px; }
.vw-inline { border-radius: 10px; padding: 9px 12px; background: var(--vw-surface2); color: var(--vw-soft); font-size: 12.5px; line-height: 1.5; } .vw-inline.err { background: rgba(198,40,40,.13); color: var(--vw-ink); }
.vw-confirm-body { padding: 4px 20px 16px; color: var(--vw-soft); line-height: 1.55; }

@media (max-width: 1020px) {
  .vw-main { grid-template-columns: minmax(0, 1fr); }
  .vw-ai { position: absolute; top: 0; right: 0; bottom: 0; width: min(420px, 100%); z-index: 6; box-shadow: -18px 0 40px rgba(0,0,0,.3); }
  .vw-doc-title { max-width: 32vw; } .vw-tiles, .vw-dests { grid-template-columns: 1fr; }
}
@media (min-width: 1200px) {
  .vw-main:not(.noai) { grid-template-columns: minmax(0, 1fr) 400px; }
  .vw-main .vw-ai { position: static; width: auto; box-shadow: none; }
}
@media (prefers-reduced-motion: reduce) { .vw-spin, .vw-skeleton i { animation: none; } .vw-quick { transition: none; } }
`;
