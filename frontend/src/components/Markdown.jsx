import React from 'react';

/*
 * A small, safe Markdown renderer for model answers. No dependency, and no raw HTML anywhere:
 * everything is built as React elements (React escapes all text), never with dangerouslySetInnerHTML.
 *
 * Supports: paragraphs, **bold**, *italic* / _italic_, bulleted lists (- * •), numbered lists (1. 1)),
 * [text](http(s)://link) and [S1]-style source tags. Anything else is shown as plain text.
 * Links: only http and https, always rel="noopener noreferrer". A javascript:, data: or other link shows its text only.
 * [S1] tags: a small button that jumps to the element with id "source-S1" when that source exists (props.sourceRefs);
 * a tag with no matching source stays plain text.
 */

const INLINE = [
  { kind: 'link', re: /\[([^\]\n]+)\]\(((?:[^\s()]|\([^\s()]*\))+)\)/ },
  { kind: 'cite', re: /\[S(\d+)\]/ },
  { kind: 'bold', re: /\*\*(.+?)\*\*/ },
  { kind: 'italic', re: /(?<![*\w])\*(?![\s*])([^*\n]+?)(?<![\s*])\*(?![*\w])/ },
  { kind: 'italic', re: /(?<![\w])_(?![\s_])([^_\n]+?)(?<![\s_])_(?![\w])/ },
];

export function safeHref(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

function goToSource(ref) {
  const el = document.getElementById(`source-${ref}`);
  if (!el) return;
  el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  el.focus?.({ preventScroll: true });
}

const CITE_STYLE = {
  font: 'inherit', fontSize: '0.7em', verticalAlign: 'super', lineHeight: 1, margin: '0 1px', padding: '1px 5px', cursor: 'pointer',
  border: '1px solid var(--accent)', borderRadius: 6, background: 'var(--accent-soft)', color: 'var(--accent)',
};

function inline(text, ctx, keyBase) {
  const out = [];
  let rest = text;
  let n = 0;
  while (rest) {
    let best = null;
    for (const { kind, re } of INLINE) {
      const m = re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { kind, m };
    }
    if (!best) { out.push(rest); break; }
    const { kind, m } = best;
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const key = `${keyBase}-${n++}`;
    if (kind === 'bold') out.push(<strong key={key}>{inline(m[1], ctx, key)}</strong>);
    else if (kind === 'italic') out.push(<em key={key}>{inline(m[1], ctx, key)}</em>);
    else if (kind === 'link') {
      const href = safeHref(m[2]);
      out.push(href
        ? <a key={key} href={href} target="_blank" rel="noopener noreferrer">{m[1]}</a>
        : m[1]);
    } else if (kind === 'cite') {
      const ref = `S${m[1]}`;
      out.push(ctx.refs.has(ref)
        ? <button key={key} type="button" className="md-cite" style={CITE_STYLE} aria-label={`Go to source ${ref}`} onClick={() => goToSource(ref)}>{ref}</button>
        : m[0]);
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

function blocks(text, ctx) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null;                         // { ordered, start, items: [] }
  let k = 0;

  const flushPara = () => {
    if (!para.length) return;
    const key = `p${k++}`;
    const kids = [];
    para.forEach((line, i) => {
      if (i) kids.push(<br key={`${key}-br${i}`} />);
      kids.push(...inline(line, ctx, `${key}-${i}`));
    });
    out.push(<p key={key} style={{ margin: '0 0 12px' }}>{kids}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const key = `l${k++}`;
    const items = list.items.map((it, i) => <li key={`${key}-${i}`}>{inline(it, ctx, `${key}-${i}`)}</li>);
    out.push(list.ordered
      ? <ol key={key} start={list.start} style={{ margin: '0 0 12px', paddingLeft: 24 }}>{items}</ol>
      : <ul key={key} style={{ margin: '0 0 12px', paddingLeft: 24 }}>{items}</ul>);
    list = null;
  };

  for (const line of lines) {
    const bullet = BULLET.exec(line);
    const number = NUMBER.exec(line);
    const heading = HEADING.exec(line);
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (bullet && !/^\s*\*\*/.test(line)) {
      flushPara();
      if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] }; }
      list.items.push(bullet[1]);
    } else if (number) {
      flushPara();
      if (!list || !list.ordered) { flushList(); list = { ordered: true, start: Number(number[1]), items: [] }; }
      list.items.push(number[2]);
    } else if (heading) {
      flushPara(); flushList();
      out.push(<p key={`h${k++}`} style={{ margin: '0 0 8px', fontWeight: 700 }}>{inline(heading[1], ctx, `h${k}`)}</p>);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return out;
}

export default function Markdown({ text, sourceRefs, className, style }) {
  const refs = sourceRefs instanceof Set ? sourceRefs : new Set(sourceRefs || []);
  return <div className={className} style={style}>{blocks(text, { refs })}</div>;
}
