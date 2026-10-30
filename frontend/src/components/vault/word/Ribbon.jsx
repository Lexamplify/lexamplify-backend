import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditorState } from '@tiptap/react';
import {
  Undo2, Redo2, Bold, Italic, Underline, Strikethrough, Subscript, Superscript, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, IndentIncrease, IndentDecrease, Highlighter, Baseline, RemoveFormatting, ChevronDown, Table as TableIcon,
  Image as ImageIcon, Minus, Link as LinkIcon, Search, ZoomIn, ZoomOut, CalendarDays, Omega, ArrowUpDown, Rows3, Columns3, Merge, Split,
  Trash2, Plus, Eye, SpellCheck, Maximize2,
} from 'lucide-react';

const FONTS = ['Times New Roman', 'Arial', 'Calibri', 'Cambria', 'Georgia', 'Garamond', 'Verdana', 'Tahoma', 'Courier New', 'Bookman Old Style', 'Nirmala UI'];
const SIZES = [8, 9, 10, 10.5, 11, 12, 13, 14, 16, 18, 20, 24, 28, 36, 48, 72];
const SPACING = [['1.0', '1'], ['1.15', '1.15'], ['1.5', '1.5'], ['2.0', '2'], ['2.5', '2.5']];
const PALETTE = ['#000000', '#434343', '#666666', '#999999', '#cccccc', '#ffffff', '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'];
const SYMBOLS = ['§', '¶', '₹', '©', '®', '™', '°', '±', '×', '÷', '–', '—', '“', '”', '‘', '’', '…', '•', '¹', '²', '³', '½', '¼', '¾', '≤', '≥', '≠', '→'];
const ICON = { size: 16, strokeWidth: 1.9 };

function Btn({ title, onClick, active, disabled, children, wide, label }) {
  return (
    <button
      type="button"
      className={`vw-btn${active ? ' on' : ''}${wide ? ' wide' : ''}`}
      title={title}
      aria-label={label || title}
      aria-pressed={active === undefined ? undefined : !!active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Group({ label, children }) {
  return (
    <div className="vw-group" role="group" aria-label={label}>
      <div className="vw-group-row">{children}</div>
      <div className="vw-group-label">{label}</div>
    </div>
  );
}

function Pop({ trigger, title, active, children, align = 'left', disabled }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 340)) });
    };
    place();
    const off = (e) => { if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return; setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    const scroll = (e) => { if (!menuRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', esc, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc, true); window.removeEventListener('resize', place); window.removeEventListener('scroll', scroll, true); };
  }, [open]);
  return (
    <div className="vw-pop">
      <button ref={btnRef} type="button" className={`vw-btn wide${active || open ? ' on' : ''}`} title={title} aria-label={title} aria-haspopup="true" aria-expanded={open}
        disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((v) => !v)}>
        {trigger}<ChevronDown size={12} strokeWidth={2.2} />
      </button>
      {open && createPortal(
        <div ref={menuRef} className="vw-float vw-menu" style={{ top: pos.top, left: pos.left }} onMouseDown={(e) => e.preventDefault()}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>,
        document.body
      )}
    </div>
  );
}

function ColorPop({ title, icon, current, onPick, onClear, clearLabel }) {
  return (
    <Pop title={title} trigger={<span className="vw-color-ico">{icon}<i style={{ background: current || 'transparent' }} /></span>}>
      {(close) => (
        <div className="vw-palette">
          <div className="vw-swatches">
            {PALETTE.map((c) => <button type="button" key={c} className="vw-swatch" style={{ background: c }} title={c} aria-label={c} onClick={() => { onPick(c); close(); }} />)}
          </div>
          <button type="button" className="vw-menu-item" onClick={() => { onClear(); close(); }}>{clearLabel}</button>
          <label className="vw-menu-item vw-custom">Custom colour…<input type="color" onChange={(e) => onPick(e.target.value)} /></label>
        </div>
      )}
    </Pop>
  );
}

function TableGrid({ onPick }) {
  const [hot, setHot] = useState({ r: 0, c: 0 });
  return (
    <div className="vw-tgrid-wrap">
      <div className="vw-tgrid" onMouseLeave={() => setHot({ r: 0, c: 0 })}>
        {Array.from({ length: 48 }, (_, i) => {
          const r = Math.floor(i / 8) + 1;
          const c = (i % 8) + 1;
          return <button type="button" key={i} aria-label={`${r} by ${c} table`} className={r <= hot.r && c <= hot.c ? 'hot' : ''} onMouseEnter={() => setHot({ r, c })} onFocus={() => setHot({ r, c })} onClick={() => onPick(r, c)} />;
        })}
      </div>
      <div className="vw-tgrid-cap">{hot.r ? `${hot.r} × ${hot.c} table` : 'Choose table size'}</div>
    </div>
  );
}

async function fileToDataUrl(file, maxW = 1200) {
  const raw = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return raw;
  const img = await new Promise((res, rej) => { const i = new window.Image(); i.onload = () => res(i); i.onerror = rej; i.src = raw; });
  if (img.width <= maxW) return raw;
  const canvas = document.createElement('canvas');
  canvas.width = maxW;
  canvas.height = Math.round((img.height * maxW) / img.width);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88);
}

export default function Ribbon({ editor, onFind, zoom, onZoom, onFit, fitting, guides, onGuides, spell, onSpell, onError }) {
  const [tab, setTab] = useState('home');
  const [collapsed, setCollapsed] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const fileRef = useRef(null);
  const s = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed) return {};
      const ts = ed.getAttributes('textStyle');
      const lh = ed.getAttributes('paragraph').lineHeight || ed.getAttributes('heading').lineHeight || '';
      return {
        bold: ed.isActive('bold'), italic: ed.isActive('italic'), underline: ed.isActive('underline'), strike: ed.isActive('strike'),
        sub: ed.isActive('subscript'), sup: ed.isActive('superscript'), bullet: ed.isActive('bulletList'), ordered: ed.isActive('orderedList'),
        align: ['center', 'right', 'justify'].find((a) => ed.isActive({ textAlign: a })) || 'left',
        block: [1, 2, 3, 4].map((l) => ed.isActive('heading', { level: l }) && `h${l}`).find(Boolean) || 'p',
        family: (ts.fontFamily || '').replace(/["']/g, '').split(',')[0].trim(), size: parseFloat(ts.fontSize) || null,
        color: ts.color || '', bg: ts.backgroundColor || '', lineHeight: lh, inTable: (() => { const { $from } = ed.state.selection; for (let d = $from.depth; d > 0; d -= 1) { if ($from.node(d).type.name === 'table') return true; } return false; })(), link: ed.isActive('link'),
        linkHref: ed.getAttributes('link').href || '', canUndo: ed.can().undo(), canRedo: ed.can().redo(),
      };
    },
  }) || {};
  useEffect(() => { if (tab === 'table' && !s.inTable) setTab('home'); }, [tab, s.inTable]);
  if (!editor) return <div className="vw-ribbon" aria-hidden="true" />;
  const run = (fn) => () => fn(editor.chain().focus()).run();
  const family = s.family || 'Times New Roman';
  const fonts = FONTS.includes(family) ? FONTS : [family, ...FONTS];
  const size = s.size || 12;
  const setSize = (n) => editor.chain().focus().setFontSize(`${Math.min(Math.max(n, 6), 120)}pt`).run();
  const stepSize = (dir) => {
    const idx = SIZES.findIndex((x) => x >= size - (dir < 0 ? 0.01 : -0.01));
    const next = dir > 0 ? SIZES.find((x) => x > size) ?? size + 2 : [...SIZES].reverse().find((x) => x < size) ?? size - 1;
    setSize(idx === -1 && dir > 0 ? size + 2 : next);
  };
  const T = ({ id, children }) => (
    <button type="button" role="tab" id={`vw-tab-${id}`} aria-selected={tab === id} className={`vw-tab${tab === id ? ' on' : ''}`} onClick={() => { setTab(id); setCollapsed(false); }} onDoubleClick={() => setCollapsed((v) => !v)}>{children}</button>
  );
  const onImage = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) { onError?.('Choose a picture file (PNG, JPG, GIF or SVG).'); return; }
    if (f.size > 8 * 1024 * 1024) { onError?.('That picture is larger than 8 MB.'); return; }
    try { editor.chain().focus().setImage({ src: await fileToDataUrl(f) }).run(); } catch { onError?.('That picture could not be read.'); }
  };

  return (
    <div className="vw-ribbon">
      <div className="vw-tabs" role="tablist" aria-label="Editor ribbon">
        <T id="home">Home</T><T id="insert">Insert</T><T id="review">Review</T><T id="view">View</T>
        {s.inTable && <T id="table">Table</T>}
        <button type="button" className="vw-tab vw-collapse" onClick={() => setCollapsed((v) => !v)} title={collapsed ? 'Show the toolbar' : 'Hide the toolbar for more room'} aria-label={collapsed ? 'Show the toolbar' : 'Hide the toolbar'} aria-pressed={collapsed}>{collapsed ? 'Show toolbar ▾' : 'Hide toolbar ▴'}</button>
      </div>
      <div className="vw-panel" hidden={collapsed} role="tabpanel" aria-labelledby={`vw-tab-${tab}`}>
        {tab === 'home' && (
          <>
            <Group label="Undo">
              <Btn title="Undo (Ctrl+Z)" disabled={!s.canUndo} onClick={run((c) => c.undo())}><Undo2 {...ICON} /></Btn>
              <Btn title="Redo (Ctrl+Y)" disabled={!s.canRedo} onClick={run((c) => c.redo())}><Redo2 {...ICON} /></Btn>
            </Group>
            <Group label="Font">
              <div className="vw-stack">
                <div className="vw-row">
                  <select className="vw-select vw-family" aria-label="Font" value={family} onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}>
                    {fonts.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
                  </select>
                  <Btn title="Smaller text" onClick={() => stepSize(-1)}><span className="vw-aa sm">A</span></Btn>
                  <select className="vw-select vw-size" aria-label="Font size" value={String(size)} onChange={(e) => setSize(parseFloat(e.target.value))}>
                    {(SIZES.includes(size) ? SIZES : [...SIZES, size].sort((a, b) => a - b)).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <Btn title="Larger text" onClick={() => stepSize(1)}><span className="vw-aa">A</span></Btn>
                </div>
                <div className="vw-row">
                  <Btn title="Bold (Ctrl+B)" active={s.bold} onClick={run((c) => c.toggleBold())}><Bold {...ICON} /></Btn>
                  <Btn title="Italic (Ctrl+I)" active={s.italic} onClick={run((c) => c.toggleItalic())}><Italic {...ICON} /></Btn>
                  <Btn title="Underline (Ctrl+U)" active={s.underline} onClick={run((c) => c.toggleUnderline())}><Underline {...ICON} /></Btn>
                  <Btn title="Strikethrough" active={s.strike} onClick={run((c) => c.toggleStrike())}><Strikethrough {...ICON} /></Btn>
                  <Btn title="Subscript" active={s.sub} onClick={run((c) => c.toggleSubscript())}><Subscript {...ICON} /></Btn>
                  <Btn title="Superscript" active={s.sup} onClick={run((c) => c.toggleSuperscript())}><Superscript {...ICON} /></Btn>
                  <ColorPop title="Text colour" icon={<Baseline {...ICON} />} current={s.color} onPick={(c) => editor.chain().focus().setColor(c).run()} onClear={() => editor.chain().focus().unsetColor().run()} clearLabel="Automatic" />
                  <ColorPop title="Highlight colour" icon={<Highlighter {...ICON} />} current={s.bg} onPick={(c) => editor.chain().focus().setBackgroundColor(c).run()} onClear={() => editor.chain().focus().unsetBackgroundColor().run()} clearLabel="No highlight" />
                  <Btn title="Clear formatting" onClick={run((c) => c.unsetAllMarks())}><RemoveFormatting {...ICON} /></Btn>
                </div>
              </div>
            </Group>
            <Group label="Paragraph">
              <div className="vw-stack">
                <div className="vw-row">
                  <Btn title="Bullets" active={s.bullet} onClick={run((c) => c.toggleBulletList())}><List {...ICON} /></Btn>
                  <Btn title="Numbering" active={s.ordered} onClick={run((c) => c.toggleOrderedList())}><ListOrdered {...ICON} /></Btn>
                  <Btn title="Decrease indent (Ctrl+[)" onClick={run((c) => c.indentLess())}><IndentDecrease {...ICON} /></Btn>
                  <Btn title="Increase indent (Ctrl+])" onClick={run((c) => c.indentMore())}><IndentIncrease {...ICON} /></Btn>
                  <Pop title="Line spacing" trigger={<ArrowUpDown {...ICON} />}>
                    {(close) => SPACING.map(([label, v]) => (
                      <button type="button" key={v} className={`vw-menu-item${(s.lineHeight || '1.15') === v ? ' on' : ''}`} onClick={() => { editor.chain().focus().setLineHeight(v === '1.15' ? null : v).run(); close(); }}>{label}</button>
                    ))}
                  </Pop>
                </div>
                <div className="vw-row">
                  <Btn title="Align left (Ctrl+Shift+L)" active={s.align === 'left'} onClick={run((c) => c.setTextAlign('left'))}><AlignLeft {...ICON} /></Btn>
                  <Btn title="Centre (Ctrl+Shift+E)" active={s.align === 'center'} onClick={run((c) => c.setTextAlign('center'))}><AlignCenter {...ICON} /></Btn>
                  <Btn title="Align right (Ctrl+Shift+R)" active={s.align === 'right'} onClick={run((c) => c.setTextAlign('right'))}><AlignRight {...ICON} /></Btn>
                  <Btn title="Justify (Ctrl+Shift+J)" active={s.align === 'justify'} onClick={run((c) => c.setTextAlign('justify'))}><AlignJustify {...ICON} /></Btn>
                </div>
              </div>
            </Group>
            <Group label="Styles">
              <select className="vw-select vw-style" aria-label="Paragraph style" value={s.block} onChange={(e) => {
                const v = e.target.value;
                const ch = editor.chain().focus();
                if (v === 'p') ch.setParagraph().run(); else ch.setHeading({ level: Number(v[1]) }).run();
              }}>
                <option value="p">Normal text</option>
                <option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="h4">Heading 4</option>
              </select>
            </Group>
            <Group label="Editing">
              <Btn wide title="Find and replace (Ctrl+F)" onClick={onFind}><Search {...ICON} /><span>Find</span></Btn>
            </Group>
          </>
        )}

        {tab === 'insert' && (
          <>
            <Group label="Tables">
              <Pop title="Insert table" trigger={<><TableIcon {...ICON} /><span>Table</span></>}>
                {(close) => <TableGrid onPick={(r, c) => { editor.chain().focus().insertTable({ rows: r, cols: c, withHeaderRow: false }).run(); close(); }} />}
              </Pop>
            </Group>
            <Group label="Illustrations">
              <Btn wide title="Insert picture" onClick={() => fileRef.current?.click()}><ImageIcon {...ICON} /><span>Picture</span></Btn>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onImage} aria-label="Choose a picture" />
            </Group>
            <Group label="Links">
              <Pop title="Link" active={s.link} trigger={<><LinkIcon {...ICON} /><span>Link</span></>}>
                {(close) => (
                  <form className="vw-link" onSubmit={(e) => {
                    e.preventDefault();
                    const url = (linkUrl || s.linkHref || '').trim();
                    if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: /^(https?:|mailto:)/i.test(url) ? url : `https://${url}` }).run();
                    close();
                  }}>
                    <input autoFocus placeholder="https://…" aria-label="Link address" defaultValue={s.linkHref} onChange={(e) => setLinkUrl(e.target.value)} />
                    <button type="submit" className="vw-mini primary">Apply</button>
                    {s.link && <button type="button" className="vw-mini" onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); close(); }}>Remove</button>}
                  </form>
                )}
              </Pop>
            </Group>
            <Group label="Text">
              <Btn wide title="Horizontal line" onClick={run((c) => c.setHorizontalRule())}><Minus {...ICON} /><span>Line</span></Btn>
              <Btn wide title="Insert today's date" onClick={() => editor.chain().focus().insertContent(new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })).run()}><CalendarDays {...ICON} /><span>Date</span></Btn>
              <Pop title="Symbols" trigger={<><Omega {...ICON} /><span>Symbol</span></>}>
                {(close) => <div className="vw-symbols">{SYMBOLS.map((c) => <button type="button" key={c} onClick={() => { editor.chain().focus().insertContent(c).run(); close(); }}>{c}</button>)}</div>}
              </Pop>
            </Group>
          </>
        )}

        {tab === 'table' && s.inTable && (
          <>
            <Group label="Rows">
              <Btn wide title="Insert row above" onClick={run((c) => c.addRowBefore())}><Rows3 {...ICON} /><span>Above</span></Btn>
              <Btn wide title="Insert row below" onClick={run((c) => c.addRowAfter())}><Plus {...ICON} /><span>Below</span></Btn>
              <Btn wide title="Delete row" onClick={run((c) => c.deleteRow())}><Trash2 {...ICON} /><span>Row</span></Btn>
            </Group>
            <Group label="Columns">
              <Btn wide title="Insert column left" onClick={run((c) => c.addColumnBefore())}><Columns3 {...ICON} /><span>Left</span></Btn>
              <Btn wide title="Insert column right" onClick={run((c) => c.addColumnAfter())}><Plus {...ICON} /><span>Right</span></Btn>
              <Btn wide title="Delete column" onClick={run((c) => c.deleteColumn())}><Trash2 {...ICON} /><span>Column</span></Btn>
            </Group>
            <Group label="Cells">
              <Btn wide title="Merge selected cells" onClick={run((c) => c.mergeCells())}><Merge {...ICON} /><span>Merge</span></Btn>
              <Btn wide title="Split cell" onClick={run((c) => c.splitCell())}><Split {...ICON} /><span>Split</span></Btn>
              <Btn wide title="Toggle header row" onClick={run((c) => c.toggleHeaderRow())}><span>Header row</span></Btn>
              <ColorPop title="Cell shading" icon={<Highlighter {...ICON} />} current="" onPick={(c) => editor.chain().focus().setCellAttribute('background', c).run()} onClear={() => editor.chain().focus().setCellAttribute('background', null).run()} clearLabel="No shading" />
            </Group>
            <Group label="Table">
              <Btn wide title="Delete table" onClick={run((c) => c.deleteTable())}><Trash2 {...ICON} /><span>Delete table</span></Btn>
            </Group>
          </>
        )}

        {tab === 'review' && (
          <>
            <Group label="Find">
              <Btn wide title="Find and replace (Ctrl+F)" onClick={onFind}><Search {...ICON} /><span>Find &amp; replace</span></Btn>
            </Group>
            <Group label="Proofing">
              <Btn wide title="Browser spell-check while you type" active={spell} onClick={() => onSpell(!spell)}><SpellCheck {...ICON} /><span>Spelling</span></Btn>
            </Group>
          </>
        )}

        {tab === 'view' && (
          <>
            <Group label="Zoom">
              <Btn title="Zoom out" onClick={() => onZoom(Math.max(0.5, +(zoom - 0.1).toFixed(2)))}><ZoomOut {...ICON} /></Btn>
              <span className="vw-zoomval" aria-live="polite">{Math.round(zoom * 100)}%</span>
              <Btn title="Zoom in" onClick={() => onZoom(Math.min(2, +(zoom + 0.1).toFixed(2)))}><ZoomIn {...ICON} /></Btn>
              <Btn wide title="Fit page to the window width" active={fitting} onClick={onFit}><Maximize2 {...ICON} /><span>Fit width</span></Btn>
            </Group>
            <Group label="Show">
              <Btn wide title="Dotted guides where pages break (approximate)" active={guides} onClick={() => onGuides(!guides)}><Eye {...ICON} /><span>Page guides</span></Btn>
            </Group>
          </>
        )}
      </div>
    </div>
  );
}
