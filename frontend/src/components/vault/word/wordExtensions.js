// Tiptap extensions that make the vault editor behave like a word processor: paragraph indents / spacing that survive a
// DOCX or PDF round-trip, sub/superscript, tables, pictures, colours, and find & replace.
import { Extension, Mark } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle, FontFamily, FontSize, Color, BackgroundColor } from '@tiptap/extension-text-style';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';

const styleAttr = (name, prop) => ({
  default: null,
  parseHTML: (el) => el.style?.[name] || null,
  renderHTML: (attrs) => (attrs[name] ? { style: `${prop}: ${attrs[name]}` } : {}),
});

const ptOf = (v) => {
  const m = /(-?[\d.]+)\s*(pt|px|in)?/.exec(v || '');
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return m[2] === 'px' ? n * 0.75 : m[2] === 'in' ? n * 72 : n;
};

export const ParaStyle = Extension.create({
  name: 'paraStyle',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          marginLeft: styleAttr('marginLeft', 'margin-left'),
          textIndent: styleAttr('textIndent', 'text-indent'),
          lineHeight: styleAttr('lineHeight', 'line-height'),
          marginTop: styleAttr('marginTop', 'margin-top'),
          marginBottom: styleAttr('marginBottom', 'margin-bottom'),
        },
      },
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          background: {
            default: null,
            parseHTML: (el) => el.style?.backgroundColor || null,
            renderHTML: (attrs) => (attrs.background ? { style: `background-color: ${attrs.background}` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    const setBoth = (attrs) => ({ chain }) => chain().updateAttributes('paragraph', attrs).updateAttributes('heading', attrs).run();
    return {
      setLineHeight: (value) => setBoth({ lineHeight: value ? String(value) : null }),
      indentMore: () => ({ editor, commands, chain }) => {
        if (editor.isActive('listItem')) return commands.sinkListItem('listItem');
        const cur = ptOf(editor.getAttributes('paragraph').marginLeft || editor.getAttributes('heading').marginLeft);
        return chain().updateAttributes('paragraph', { marginLeft: `${Math.min(cur + 36, 360)}pt` }).updateAttributes('heading', { marginLeft: `${Math.min(cur + 36, 360)}pt` }).run();
      },
      indentLess: () => ({ editor, commands, chain }) => {
        if (editor.isActive('listItem')) return commands.liftListItem('listItem');
        const cur = ptOf(editor.getAttributes('paragraph').marginLeft || editor.getAttributes('heading').marginLeft);
        const next = Math.max(cur - 36, 0);
        const v = next ? `${next}pt` : null;
        return chain().updateAttributes('paragraph', { marginLeft: v }).updateAttributes('heading', { marginLeft: v }).run();
      },
    };
  },
  addKeyboardShortcuts() {
    return { 'Mod-]': () => this.editor.commands.indentMore(), 'Mod-[': () => this.editor.commands.indentLess() };
  },
});

const sub = (name, tag, excludes) => Mark.create({
  name,
  excludes,
  parseHTML() { return [{ tag }]; },
  renderHTML({ HTMLAttributes }) { return [tag, HTMLAttributes, 0]; },
  addCommands() {
    return { [`toggle${name[0].toUpperCase()}${name.slice(1)}`]: () => ({ commands }) => commands.toggleMark(name) };
  },
});
export const Subscript = sub('subscript', 'sub', 'superscript');
export const Superscript = sub('superscript', 'sup', 'subscript');

// ── find & replace ──────────────────────────────────────────────────────────────────────
export const searchKey = new PluginKey('vaultSearch');

function findAll(doc, term, caseSensitive) {
  const out = [];
  if (!term) return out;
  const needle = caseSensitive ? term : term.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = caseSensitive ? node.text : node.text.toLowerCase();
    let i = 0;
    while ((i = text.indexOf(needle, i)) > -1) {
      out.push({ from: pos + i, to: pos + i + term.length });
      i += Math.max(term.length, 1);
    }
  });
  return out;
}

export const SearchReplace = Extension.create({
  name: 'searchReplace',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: searchKey,
      state: {
        init: () => ({ term: '', cs: false, current: 0, matches: [] }),
        apply(tr, prev) {
          const meta = tr.getMeta(searchKey);
          let s = meta ? { ...prev, ...meta } : prev;
          if (meta || tr.docChanged) {
            const matches = findAll(tr.doc, s.term, s.cs);
            s = { ...s, matches, current: matches.length ? Math.min(s.current, matches.length - 1) : 0 };
          }
          return s;
        },
      },
      props: {
        decorations(state) {
          const s = searchKey.getState(state);
          if (!s || !s.matches.length) return DecorationSet.empty;
          return DecorationSet.create(state.doc, s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.current ? 'vwe-find vwe-find-cur' : 'vwe-find' })));
        },
      },
    })];
  },
  addCommands() {
    const go = (delta) => () => ({ state, tr, dispatch, view }) => {
      const s = searchKey.getState(state);
      if (!s?.matches.length) return false;
      const idx = (s.current + delta + s.matches.length) % s.matches.length;
      const m = s.matches[idx];
      if (dispatch) {
        tr.setMeta(searchKey, { current: idx });
        tr.setSelection(state.selection.constructor.create(tr.doc, m.from, m.to));
        dispatch(tr.scrollIntoView());
        view?.focus?.();
      }
      return true;
    };
    return {
      setSearch: (term, cs = false) => ({ tr, dispatch }) => { if (dispatch) dispatch(tr.setMeta(searchKey, { term, cs, current: 0 })); return true; },
      findNext: go(1),
      findPrev: go(-1),
      replaceCurrent: (text) => ({ state, tr, dispatch }) => {
        const s = searchKey.getState(state);
        const m = s?.matches[s.current];
        if (!m) return false;
        if (dispatch) dispatch(tr.insertText(text, m.from, m.to));
        return true;
      },
      replaceAll: (text) => ({ state, tr, dispatch }) => {
        const s = searchKey.getState(state);
        if (!s?.matches.length) return false;
        if (dispatch) {
          [...s.matches].reverse().forEach((m) => tr.insertText(text, m.from, m.to));
          dispatch(tr);
        }
        return true;
      },
    };
  },
});

export function searchInfo(editor) {
  const s = editor && !editor.isDestroyed ? searchKey.getState(editor.state) : null;
  return { count: s?.matches.length || 0, current: s?.matches.length ? s.current + 1 : 0, term: s?.term || '' };
}

export function wordExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false, autolink: false, HTMLAttributes: { rel: 'noopener noreferrer nofollow' } },
    }),
    TextAlign.configure({ types: ['paragraph', 'heading'] }),
    TextStyle, FontFamily, FontSize, Color, BackgroundColor,
    Subscript, Superscript, ParaStyle, SearchReplace,
    Table.configure({ resizable: true }), TableRow, TableHeader, TableCell,
    Image.configure({ inline: true, allowBase64: true }),
  ];
}
