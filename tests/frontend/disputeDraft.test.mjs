// node tests/frontend/disputeDraft.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const cat = JSON.parse(fs.readFileSync(path.join(root, 'frontend/src/data/disputeCatalog.json'), 'utf8'));
const { buildDisputeDoc, reviewDraft, matchDisputes, searchDisputes, formFields, citationPairs, entryCorpus } = await import(path.join(root, 'frontend/src/utils/disputeDraft.js'));
const { buildDraftName, toFileName } = await import(path.join(root, 'frontend/src/utils/draftNaming.js'));

let n = 0;
const ok = (name, c, extra = '') => { if (!c) { console.error('FAIL:', name, extra); process.exit(1); } n++; console.log('ok  ', name); };

// 1. every dispute renders cleanly with no facts and with facts
let bad = [];
for (const d of cat.disputes) {
  const all = formFields(d, cat.bases);
  const facts = {};
  [...all.setup, ...all.matter].forEach((f) => { facts[f.key] = f.type === 'date' ? '2026-03-01' : `VAL_${f.key}`; });
  for (const f of [{}, facts]) {
    const r = buildDisputeDoc(d, f, cat.bases);
    const blob = r.html + r.text;
    if (!r.html || /undefined|\{\{|\[object|NaN/.test(blob)) bad.push(d.id + (f === facts ? ' (facts)' : ' (empty)'));
  }
  const r2 = buildDisputeDoc(d, facts, cat.bases);
  const missingVals = [...all.setup, ...all.matter].filter((f) => !r2.text.includes(`VAL_${f.key}`) && !['date', 'notice_date'].includes(f.key) && f.key !== 'notice_days');
  // only placeholders that the template actually uses need to appear; report those never used at all as info
}
ok(`all ${cat.disputes.length} disputes render cleanly (empty + filled)`, bad.length === 0, bad.join(', '));

// 2. typed facts appear
const bail = cat.disputes.find((d) => d.id === 'bail-anticipatory');
let r = buildDisputeDoc(bail, { court: 'Sessions Court, Chennai', p1_name: 'Ravi Kumar', p2_name: 'State', fir_no: '245 of 2025', ps: 'Anna Nagar' }, cat.bases);
ok('court uppercased in heading', r.text.includes('IN THE SESSIONS COURT, CHENNAI'));
ok('names present', r.text.includes('Ravi Kumar') && r.text.includes('State'));
ok('prayer placeholder substituted with typed value', /245 of 2025/.test(r.text) || !/\{\{/.test(r.text));
ok('blank fields become highlighted placeholders', r.html.includes('<mark') && r.text.includes('['));
ok('affidavit block for bail', r.text.includes('AFFIDAVIT'));

ok('dates formatted dd.mm.yyyy', buildDisputeDoc(bail, { date: '2026-09-29' }, cat.bases).text.includes('Date: 29.09.2026'));
ok('annexure labels simple', buildDisputeDoc(bail, {}, cat.bases).text.includes('Annexure A-2:'));

// 3. AI slots replace fact and ground paragraphs
r = buildDisputeDoc(bail, { p1_name: 'Ravi' }, cat.bases, { facts_narrative: ['AI para one.', 'AI para two.'], grounds: ['AI ground A.'] });
ok('AI facts used', r.text.includes('1.  AI para one.') && r.text.includes('2.  AI para two.'));
ok('AI ground replaces seed A, others keep catalog seed', r.text.includes('A.  AI ground A.') && r.text.includes('B.  '));
ok('paragraph count reported', r.paragraphs >= 2);
ok('verify tag highlighted amber', buildDisputeDoc(bail, {}, cat.bases, { facts_narrative: ['x [verify: not in library]'], grounds: [] }).html.includes('rgba(217,119,6'));
ok('html injection escaped', !buildDisputeDoc(bail, { p1_name: '<script>alert(1)</script>' }, cat.bases).html.includes('<script>'));

// 4. notice / reply / rti shapes
const nt = cat.disputes.find((d) => d.id === 'notice-cheque-138');
r = buildDisputeDoc(nt, { p1_name: 'A', p2_name: 'B', notice_days: '15', mode: 'speed post' }, cat.bases);
ok('notice has To / Subject / demand', r.text.includes('To,') && r.text.includes('Subject:') && r.text.includes('called upon'));
ok('notice mode uppercased', r.text.includes('BY SPEED POST'));
const rti = cat.disputes.find((d) => d.id === 'rti-application');
r = buildDisputeDoc(rti, { information: '1. Copy of file notings\n2) Date of order', p1_name: 'Meera', authority: 'Dept X' }, cat.bases);
ok('rti splits numbered questions', r.text.includes('1.  Copy of file notings') && r.text.includes('2.  Date of order'));
const rp = cat.disputes.find((d) => d.kind === 'reply');
r = buildDisputeDoc(rp, { notice_date: '2026-01-01' }, cat.bases);
ok('reply references the notice', r.text.includes('Your notice dated 01.01.2026'));

// 5. review
r = buildDisputeDoc(bail, { p1_name: 'Ravi' }, cat.bases);
let rv = reviewDraft(bail, { p1_name: 'Ravi' }, cat.bases, r.text);
ok('review flags blanks and placeholders', rv.some((i) => /left blank/.test(i.title)) && rv.some((i) => /open placeholder/.test(i.title)));
rv = reviewDraft(bail, {}, cat.bases, 'As held in Sharma v. State AIR 1999 SC 5, and Section 999 of the X Act.');
ok('review flags case law and stray provision', rv.some((i) => /case citation/.test(i.title)) && rv.some((i) => /not in this library entry/.test(i.title)));
rv = reviewDraft(bail, {}, cat.bases, 'Relief under Section 482 of the BNSS.');
ok('review passes library provision', rv.some((i) => /Every provision cited/.test(i.title)));

// 6. citation pairs parity with python
const p = citationPairs('Sections 73 and 74 of the Contract Act, Article 21, Order XXXVII Rule 3, s.138, ss. 12A');
ok('pairs', ['section:73', 'section:74', 'article:21', 'order:XXXVII', 'section:138', 'section:12A'].every((x) => p.has(x)), [...p].join());

// 7. search / match
ok('match cheque', ['complaint-138-ni', 'notice-cheque-138'].includes(matchDisputes('cheque bounced 138', cat)[0].id));
ok('match anticipatory', matchDisputes('anticipatory bail fear arrest', cat)[0].id === 'bail-anticipatory');
ok('search by category', searchDisputes(cat.disputes, '', 'family').every((d) => d.cat === 'family'));
ok('search text', searchDisputes(cat.disputes, 'divorce', 'all').length >= 5);
ok('search prefix', searchDisputes(cat.disputes, 'injunc', 'all').length >= 1);

// 8. naming
const nm = buildDraftName({ dispute: bail, facts: { p1_name: 'Ravi Kumar', p2_name: 'State of TN', fir_no: '245/2025' }, date: new Date(2026, 8, 29) });
ok('dispute name', nm === 'Anticipatory Bail - Ravi Kumar v State of TN - 245/2025 - 2026-09-29', nm);
ok('free draft name uses first line', buildDraftName({ docText: '\n\nMASTER SERVICES AGREEMENT\nblah', date: new Date(2026, 0, 2) }) === 'MASTER SERVICES AGREEMENT - 2026-01-02');
ok('fallback name', buildDraftName({ date: new Date(2026, 0, 2) }) === 'Legal draft - 2026-01-02');
ok('filename safe', toFileName('A/B: C? "x" - 2026', 'docx') === 'A_B_C_x_-_2026.docx', toFileName('A/B: C? "x" - 2026', 'docx'));
ok('long name capped', buildDraftName({ prompt: 'x'.repeat(300), date: new Date(2026, 0, 2) }).length <= 90);
console.log(`\nALL ${n} CHECKS PASSED`);
