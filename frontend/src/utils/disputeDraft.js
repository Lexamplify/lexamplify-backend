// Deterministic drafting for the Dispute Library.
//
// Everything in the document skeleton comes from (a) the curated catalog entry
// and (b) the facts the lawyer typed. Nothing here calls a model. The AI (see
// /api/disputes/draft) may only replace the narrative slots `facts_narrative`
// and `grounds`, and those come back already validated and guarded.

const STOP = new Set(('a an the and or of to in on for with by at from is are was were be been being this that these those it its as ' +
  'i me my we our you your he she they them their his her not no do does did have has had will would can could should may might ' +
  'about into over under after before against between during without within than then so if but also very more most some any ' +
  'want need needs please help file filing draft case matter client get got').split(' '));

export function tokens(text) {
  return (String(text || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length > 1 && !STOP.has(t));
}

/** Offline keyword ranking - mirrors utils/dispute_ai.py:score_disputes. */
export function matchDisputes(query, catalog, limit = 8) {
  const q = new Set(tokens(query));
  if (!q.size) return [];
  const out = [];
  for (const d of catalog.disputes) {
    const kw = new Set(tokens(d.keywords));
    const ti = new Set(tokens(d.title));
    const rest = new Set(tokens([d.blurb, d.doc, d.forum].join(' ')));
    let s = 0;
    q.forEach((t) => {
      if (kw.has(t)) s += 3;
      if (ti.has(t)) s += 2;
      if (rest.has(t)) s += 1;
      if (/^\d+$/.test(t) && d.statutes.some((x) => x.ref.toLowerCase().includes(t))) s += 2;
    });
    if (s > 0) out.push({ id: d.id, score: s });
  }
  out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  return out.slice(0, limit);
}

export function searchDisputes(list, query, cat) {
  const inCat = list.filter((d) => !cat || cat === 'all' || d.cat === cat);
  const q = String(query || '').trim();
  if (!q) return inCat;
  const qt = new Set(tokens(q));
  if (!qt.size) return inCat;
  const scored = inCat.map((d) => {
    const hay = tokens([d.title, d.blurb, d.keywords, d.doc, d.statutes.map((s) => s.ref).join(' ')].join(' '));
    const hs = new Set(hay);
    let s = 0;
    qt.forEach((t) => {
      if (hs.has(t)) s += 2;
      else if (hay.some((h) => h.startsWith(t) && t.length >= 3)) s += 1;
    });
    return { d, s };
  }).filter((x) => x.s > 0);
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.d);
}

// ───────────── helpers ─────────────
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const MARK_BLUE = 'background-color: rgba(59,130,246,0.16); color: #1D4ED8; padding: 1px 4px; border-radius: 4px; font-weight: 600;';
const MARK_AMBER = 'background-color: rgba(217,119,6,0.18); color: #B45309; padding: 1px 4px; border-radius: 4px; font-weight: 600;';

/** Wrap [placeholders] (and [verify: ...] tags) in the same <mark> markup the editor already keeps. */
export function highlight(escaped) {
  return escaped.replace(/\[([^\]\n]{1,300})\]/g, (m, inner) => {
    const verify = /^verify\b|removed - verify/i.test(inner.trim());
    const color = verify ? 'rgba(217,119,6,0.18)' : 'rgba(59,130,246,0.16)';
    return `<mark data-color="${color}" style="${verify ? MARK_AMBER : MARK_BLUE}">${m}</mark>`;
  });
}

const P1 = (d) => d.parties[0];
const P2 = (d) => d.parties[1];

export function fieldLabel(f, dispute) {
  return String(f.label || '')
    .replace('{P1}', P1(dispute).replace(/ \/ .*$/, ''))
    .replace('{P2}', P2(dispute).replace(/ \/ .*$/, ''));
}

export function formFields(dispute, bases) {
  const base = (bases[dispute.kind] || []).map((f) => ({ ...f, label: fieldLabel(f, dispute), group: 'setup' }));
  const extra = (dispute.facts || []).map((f) => ({ ...f, group: 'matter' }));
  return { setup: base, matter: extra };
}

function ph(label) {
  return `[${label}]`;
}

// Indian court documents read dd.mm.yyyy; the date inputs give yyyy-mm-dd.
const fmtVal = (v) => String(v ?? '').replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3.$2.$1');

/** Substitute {{key}} with the typed value, or a [placeholder] naming the field. */
export function fill(text, dispute, facts, bases) {
  const labels = {};
  [...(bases[dispute.kind] || []), ...(dispute.facts || [])].forEach((f) => { labels[f.key] = fieldLabel(f, dispute); });
  return String(text || '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, k) => {
    const v = fmtVal(facts[k]).trim();
    return v || ph(labels[k] || k);
  });
}

const val = (facts, k, label) => (fmtVal(facts[k]).trim() || ph(label));
const oneLine = (s) => String(s).replace(/\s*\n\s*/g, ', ');

function partyLine(name, desc) {
  const n = String(name || '').trim();
  const dsc = String(desc || '').trim();
  return `${n || ph('Name')}${dsc ? `, ${oneLine(dsc)}` : `, ${ph('description and address')}`}`;
}

const roman = (n) => {
  const map = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  let x = n;
  for (const [v, s] of map) while (x >= v) { out += s; x -= v; }
  return out;
};
const letter = (i) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : '');

// Block model -> html + text
const ALIGN_MARK = { center: '>>c ', right: '>>r ', justify: '>>j ' };

function render(blocks, md = false) {
  const html = [];
  const text = [];
  for (const b of blocks) {
    const t = b.text ?? '';
    if (b.t === 'spacer') { text.push(''); continue; }
    const inner = highlight(esc(t)).replace(/\n/g, '<br>');
    const wrapped = b.b ? `<strong>${b.u ? `<u>${inner}</u>` : inner}</strong>` : (b.u ? `<u>${inner}</u>` : inner);
    const align = b.align ? ` style="text-align: ${b.align}"` : '';
    html.push(`<p${align}>${wrapped}</p>`);
    // md mode (Legal Forms): keep alignment + bold as light markers the form preview understands.
    text.push(md ? `${ALIGN_MARK[b.align] || ''}${b.b ? t.split('\n').map((l) => (l.trim() ? `**${l}**` : l)).join('\n') : t}` : t);
  }
  return { html: html.join(''), text: text.join('\n\n') };
}

const NO_LIMIT = /^(no limitation|not applicable)/i;

// ───────────── main builder ─────────────
/**
 * @param dispute  catalog entry
 * @param facts    typed values keyed by field key
 * @param bases    catalog.bases
 * @param slots    optional { facts_narrative: string[], grounds: string[] } from the validated AI endpoint
 */
export function buildDisputeDoc(dispute, facts = {}, bases, slots = null, opts = {}) {
  const F = (t) => fill(t, dispute, facts, bases);
  const blocks = [];
  const kind = dispute.kind;
  const p1 = P1(dispute).replace(/ \/ .*$/, '');
  const p2 = P2(dispute).replace(/ \/ .*$/, '');
  let n = 0;
  const num = (text) => { n += 1; blocks.push({ t: 'p', text: `${n}.  ${text}`, align: 'justify' }); };
  const factParas = () => {
    if (slots && Array.isArray(slots.facts_narrative) && slots.facts_narrative.length) {
      slots.facts_narrative.forEach((p) => num(p));
      return;
    }
    // No AI: the outline becomes fill-in prompts, and any typed matter facts are shown verbatim.
    (dispute.outline || []).forEach((o) => num(ph(o)));
    (dispute.facts || []).forEach((f) => {
      const v = fmtVal(facts[f.key]).trim();
      if (v) num(`${f.label}: ${oneLine(v)}.`);
    });
  };
  const groundParas = (label = 'GROUNDS') => {
    const src = slots && Array.isArray(slots.grounds) && slots.grounds.length
      ? dispute.grounds.map((g, i) => (slots.grounds[i] && slots.grounds[i].trim() ? slots.grounds[i] : g)).concat(slots.grounds.slice(dispute.grounds.length))
      : dispute.grounds;
    if (!src.length) return;
    blocks.push({ t: 'p', text: label, b: true, u: true, align: 'center' });
    src.forEach((g, i) => blocks.push({ t: 'p', text: `${letter(i)}.  ${F(g)}`, align: 'justify' }));
  };
  const provisions = () => {
    if (!dispute.statutes.length) return;
    blocks.push({ t: 'p', text: 'PROVISIONS OF LAW RELIED ON', b: true, u: true, align: 'center' });
    dispute.statutes.forEach((s, i) => blocks.push({ t: 'p', text: `${i + 1}.  ${s.ref}`, align: 'justify' }));
  };
  const prayers = (lead, style = 'alpha') => {
    if (!dispute.prayers.length) return;
    blocks.push({ t: 'p', text: lead, align: 'justify' });
    dispute.prayers.forEach((p, i) => blocks.push({
      t: 'p', text: `${style === 'alpha' ? `(${String.fromCharCode(97 + i)})` : `${i + 1}.`}  ${F(p)}`, align: 'justify',
    }));
  };
  const signature = (who, through = true) => {
    blocks.push({ t: 'spacer' });
    blocks.push({ t: 'p', text: `Place: ${val(facts, 'place', 'Place')}\nDate: ${val(facts, 'date', 'Date')}`, align: 'left' });
    blocks.push({ t: 'p', text: `${who}${through ? '\nThrough Counsel' : ''}\n${oneLine(val(facts, 'advocate', 'Advocate name and enrolment no.'))}`, b: true, align: 'right' });
  };

  if (kind === 'petition') {
    blocks.push({ t: 'p', text: `IN THE ${String(facts.court || '').trim().toUpperCase() || ph('COURT / FORUM')}`, b: true, align: 'center' });
    blocks.push({ t: 'p', text: String(facts.case_no || '').trim() ? `Case / Ref. No. ${fmtVal(facts.case_no)}` : ph('Case / FIR / Diary No. - blank for fresh filing'), align: 'center' });
    blocks.push({ t: 'p', text: `${partyLine(facts.p1_name, facts.p1_desc)}\n... ${p1}`, align: 'left' });
    blocks.push({ t: 'p', text: 'VERSUS', b: true, align: 'center' });
    blocks.push({ t: 'p', text: `${partyLine(facts.p2_name, facts.p2_desc)}\n... ${p2}`, align: 'left' });
    blocks.push({ t: 'p', text: F(dispute.doc).toUpperCase(), b: true, u: true, align: 'center' });
    blocks.push({ t: 'p', text: `The ${p1} above named most respectfully submits as under:`, align: 'justify' });
    blocks.push({ t: 'p', text: 'FACTS', b: true, u: true, align: 'center' });
    factParas();
    (dispute.sections || []).forEach((s) => {
      blocks.push({ t: 'p', text: s.h, b: true, u: true, align: 'center' });
      num(F(s.b));
    });
    if (dispute.limitation && !NO_LIMIT.test(dispute.limitation)) {
      blocks.push({ t: 'p', text: 'LIMITATION', b: true, u: true, align: 'center' });
      num(ph(`State how this filing is within time. Library note: ${dispute.limitation}`));
    }
    provisions();
    groundParas();
    blocks.push({ t: 'p', text: 'PRAYER', b: true, u: true, align: 'center' });
    prayers(`In the premises, it is most respectfully prayed that this Hon'ble Court/Forum may be pleased to:`);
    signature(p1);
    const factCount = n;
    if (dispute.verification === 'affidavit') {
      blocks.push({ t: 'spacer' });
      blocks.push({ t: 'p', text: 'AFFIDAVIT', b: true, u: true, align: 'center' });
      blocks.push({ t: 'p', text: `I, ${val(facts, 'p1_name', 'Deponent name')}, ${oneLine(val(facts, 'p1_desc', 'deponent description and address'))}, do hereby solemnly affirm and state on oath as under:`, align: 'justify' });
      blocks.push({ t: 'p', text: `1.  That I am the ${p1} in the above matter and am well acquainted with its facts.`, align: 'justify' });
      blocks.push({ t: 'p', text: `2.  That the contents of paragraphs 1 to ${factCount} of the above document are true and correct to my knowledge and belief, and nothing material has been concealed.`, align: 'justify' });
      blocks.push({ t: 'p', text: 'DEPONENT', b: true, align: 'right' });
      blocks.push({ t: 'p', text: `VERIFICATION: Verified at ${val(facts, 'place', 'Place')} on ${val(facts, 'date', 'Date')} that the contents of the above affidavit are true and correct to my knowledge and belief; no part of it is false and nothing material has been concealed.`, align: 'justify' });
      blocks.push({ t: 'p', text: 'DEPONENT', b: true, align: 'right' });
    } else if (dispute.verification === 'verification') {
      blocks.push({ t: 'spacer' });
      blocks.push({ t: 'p', text: 'VERIFICATION', b: true, u: true, align: 'center' });
      blocks.push({ t: 'p', text: `I, ${val(facts, 'p1_name', 'Name')}, do hereby verify that the contents of paragraphs 1 to ${factCount} above are true and correct to my knowledge, and that the remaining paragraphs are based on information believed by me to be true. Nothing material has been concealed. Verified at ${val(facts, 'place', 'Place')} on ${val(facts, 'date', 'Date')}.`, align: 'justify' });
      blocks.push({ t: 'p', text: p1.toUpperCase(), b: true, align: 'right' });
    }
    if (dispute.annex.length) {
      blocks.push({ t: 'spacer' });
      blocks.push({ t: 'p', text: 'LIST OF DOCUMENTS / ANNEXURES', b: true, u: true, align: 'center' });
      dispute.annex.forEach((a, i) => blocks.push({ t: 'p', text: `Annexure A-${i + 1}:  ${a}`, align: 'left' }));
    }
  } else if (kind === 'notice' || kind === 'reply') {
    const isReply = kind === 'reply';
    blocks.push({ t: 'p', text: `Date: ${val(facts, 'date', 'Date of ' + (isReply ? 'reply' : 'notice'))}`, align: 'left' });
    if (!isReply) blocks.push({ t: 'p', text: `BY ${String(facts.mode || '').trim().toUpperCase() || ph('MODE OF SERVICE - Registered Post A.D. / Speed Post / Email')}`, b: true, align: 'left' });
    blocks.push({ t: 'p', text: `To,\n${partyLine(facts.p2_name, facts.p2_desc)}`, align: 'left' });
    blocks.push({ t: 'p', text: `Subject: ${F(dispute.doc)}`, b: true, align: 'left' });
    if (isReply) {
      blocks.push({ t: 'p', text: `Ref: Your notice dated ${val(facts, 'notice_date', 'date of notice')}${String(facts.notice_ref || '').trim() ? `, ${facts.notice_ref}` : ''}`, align: 'left' });
      blocks.push({ t: 'p', text: `Sir / Madam,\nUnder instructions from and on behalf of my client ${partyLine(facts.p1_name, facts.p1_desc)}, I reply to your above notice as under:`, align: 'justify' });
    } else {
      blocks.push({ t: 'p', text: `Sir / Madam,\nUnder instructions from and on behalf of my client ${partyLine(facts.p1_name, facts.p1_desc)}, I hereby serve upon you the following legal notice:`, align: 'justify' });
    }
    factParas();
    if (dispute.grounds.length) {
      const src = slots && Array.isArray(slots.grounds) && slots.grounds.length
        ? dispute.grounds.map((g, i) => (slots.grounds[i] && slots.grounds[i].trim() ? slots.grounds[i] : g))
        : dispute.grounds;
      src.forEach((g) => num(F(g)));
    }
    if (dispute.statutes.length) num(`My client relies on ${dispute.statutes.map((s) => s.ref).join('; ')}.`);
    if (dispute.prayers.length) {
      blocks.push({ t: 'p', text: isReply ? 'My client therefore calls upon you to:' : 'You are hereby called upon to:', align: 'justify' });
      dispute.prayers.forEach((p, i) => blocks.push({ t: 'p', text: `(${roman(i + 1)})  ${F(p)}`, align: 'justify' }));
    }
    if (!dispute.prayers.some((p) => /failing which/i.test(p))) {
      blocks.push({ t: 'p', text: `Take notice that if you fail to comply within ${val(facts, 'notice_days', 'number of').replace(/^(\d+)$/, '$1')} days of receipt of this ${isReply ? 'reply' : 'notice'}, my client shall be constrained to take appropriate legal proceedings against you at your risk as to costs and consequences.`, align: 'justify' });
    }
    blocks.push({ t: 'p', text: 'A copy of this document has been retained in my office for record.', align: 'justify' });
    blocks.push({ t: 'spacer' });
    blocks.push({ t: 'p', text: `Place: ${val(facts, 'place', 'Place')}`, align: 'left' });
    blocks.push({ t: 'p', text: `${oneLine(val(facts, 'advocate', 'Advocate name, enrolment no. and address'))}\nAdvocate for the ${isReply ? 'noticee' : 'sender'}`, b: true, align: 'right' });
  } else if (kind === 'rti') {
    blocks.push({ t: 'p', text: `To,\nThe Public Information Officer\n${val(facts, 'authority', 'Public authority')}\n${oneLine(val(facts, 'pio', 'Address of the PIO'))}`, align: 'left' });
    blocks.push({ t: 'p', text: 'Subject: Request for information under Section 6(1) of the Right to Information Act, 2005', b: true, align: 'left' });
    blocks.push({ t: 'p', text: 'Sir / Madam,', align: 'left' });
    blocks.push({ t: 'p', text: `I, ${val(facts, 'p1_name', 'Applicant name')}, resident of ${oneLine(val(facts, 'p1_desc', 'postal address, email and phone'))}, request the following information under the Right to Information Act, 2005:`, align: 'justify' });
    const infoRaw = String(facts.information || '').trim();
    if (infoRaw) {
      infoRaw.split(/\n+/).map((l) => l.replace(/^\s*(?:\(?\d{1,2}[.)]|[-*•])\s*/, '').trim()).filter(Boolean)
        .forEach((l) => num(l));
    } else {
      num(ph('Information sought - one specific question per numbered item; ask for copies of records, file notings, orders, dates'));
    }
    if (String(facts.period || '').trim()) num(`Period to which the information relates: ${facts.period}.`);
    num(`I am enclosing the application fee as follows: ${val(facts, 'fee_mode', 'fee payment details, or BPL certificate no.')}.`);
    num('If any part of the information is held by another public authority, please transfer this application under Section 6(3) and inform me.');
    num('I state that the information sought does not fall within the exemptions of Section 8 of the Act, and to the best of my knowledge it pertains to your public authority.');
    blocks.push({ t: 'spacer' });
    blocks.push({ t: 'p', text: `Place: ${val(facts, 'place', 'Place')}\nDate: ${val(facts, 'date', 'Date')}`, align: 'left' });
    blocks.push({ t: 'p', text: `${val(facts, 'p1_name', 'Applicant name')}\nApplicant`, b: true, align: 'right' });
    if (dispute.annex.length) blocks.push({ t: 'p', text: `Enclosures: ${dispute.annex.join('; ')}`, align: 'left' });
  }

  const out = render(blocks, !!opts.md);
  // Upper-casing (court name, document title) also upper-cases {{keys}}; keys are lower-case by construction.
  if (opts.md) out.text = out.text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m) => m.toLowerCase());
  return { ...out, paragraphs: n };
}

// ───────────── citations (mirror of utils/dispute_ai.py) ─────────────
const ROMAN_RE = '[IVXLCDM]{1,8}';
const CITE_RE = new RegExp(
  `(\\bSections?\\b|\\bSec\\.|\\bss?\\.|\\bArticles?\\b|\\bArt\\.|\\bOrder\\b)\\s*((?:${ROMAN_RE}|\\d+[A-Za-z]?)(?:\\([0-9A-Za-z]+\\))*(?:\\s*(?:,|and|to|&|-)\\s*(?:\\d+[A-Za-z]?)(?:\\([0-9A-Za-z]+\\))*)*)`, 'g',
);
const family = (k) => {
  const x = k.toLowerCase().replace(/\.$/, '');
  if (x.startsWith('art')) return 'article';
  if (x === 'order') return 'order';
  return 'section';
};

export function citationPairs(text) {
  const out = new Set();
  const re = new RegExp(CITE_RE.source, 'g');
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const fam = family(m[1]);
    m[2].split(/\s*(?:,|and|to|&|-)\s*/).forEach((raw) => {
      const base = raw.replace(/\(.*/, '').trim().toUpperCase();
      if (base) out.add(`${fam}:${base}`);
    });
  }
  return out;
}

export function entryCorpus(d) {
  const bits = [d.doc, d.forum, d.limitation, d.blurb];
  d.statutes.forEach((s) => bits.push(`${s.ref} ${s.note || ''}`));
  ['pre', 'outline', 'grounds', 'prayers', 'cautions', 'annex'].forEach((k) => bits.push(...(d[k] || [])));
  (d.sections || []).forEach((s) => bits.push(`${s.h} ${s.b}`));
  return bits.join('\n');
}

// ───────────── deterministic review ─────────────
/** Checks the CURRENT editor text - it never asks a model. */
export function reviewDraft(dispute, facts, bases, docText) {
  const items = [];
  const text = String(docText || '');
  const add = (level, title, detail = '') => items.push({ level, title, detail });

  if (!text.trim()) return [{ level: 'info', title: 'Nothing to review yet', detail: 'Generate the skeleton first.' }];

  const missing = ((bases[dispute.kind] || [])).concat(dispute.facts || [])
    .filter((f) => !String(facts[f.key] ?? '').trim())
    .map((f) => fieldLabel(f, dispute));
  if (missing.length) add('warn', `${missing.length} field${missing.length > 1 ? 's' : ''} left blank`, missing.slice(0, 8).join('; ') + (missing.length > 8 ? '; …' : ''));

  const open = (text.match(/\[[^\]\n]{2,300}\]/g) || []).filter((t) => !/^\[verify/i.test(t) && !/case reference removed/i.test(t));
  if (open.length) add('warn', `${open.length} open placeholder${open.length > 1 ? 's' : ''} in the text`, 'Highlighted in blue - replace each with the real detail before filing.');
  else add('ok', 'No open placeholders left');

  const flagged = (text.match(/\[verify[^\]]*\]|\[case reference removed[^\]]*\]/gi) || []);
  if (flagged.length) add('warn', `${flagged.length} item${flagged.length > 1 ? 's' : ''} flagged "verify"`, 'The AI wrote something that is not in the library entry or your facts. Confirm it or delete it.');

  const allowed = citationPairs(entryCorpus(dispute));
  const used = citationPairs(text);
  const stray = [...used].filter((p) => !allowed.has(p)).map((p) => { const [f, n] = p.split(':'); return `${f.charAt(0).toUpperCase()}${f.slice(1)} ${n}`; });
  if (stray.length) add('warn', 'Provisions in the text that are not in this library entry', `${stray.join(', ')} - not necessarily wrong, but the library did not supply them. Check on India Code.`);
  else add('ok', 'Every provision cited is one the library entry supplies');

  if (/\b[A-Z][\w.&'-]*\s+(?:v\.|vs\.?|versus)\s+[A-Z]/.test(text) || /\bAIR\s+\d{4}|\bSCC\b/.test(text)) {
    add('warn', 'A case citation appears in the text', 'This tool does not supply case law. Verify the citation and the proposition on a case-law database before relying on it.');
  }

  if (dispute.limitation && !NO_LIMIT.test(dispute.limitation)) add('info', 'Limitation', dispute.limitation);
  (dispute.pre || []).forEach((p) => add('info', 'Before filing', p));
  (dispute.cautions || []).forEach((c) => add('info', 'Caution', c));
  if (dispute.annex && dispute.annex.length) add('info', 'Documents to attach', dispute.annex.join('; '));
  return items;
}
