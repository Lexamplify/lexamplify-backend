// Every dispute in the catalog must convert into a fillable Legal Forms template whose
// {{placeholders}} all map to real fields (run: node tests/frontend/disputeForms.test.mjs).
import fs from 'fs';
import assert from 'assert';
import { buildDisputeDoc, formFields } from '../../frontend/src/utils/disputeDraft.js';

const cat = JSON.parse(fs.readFileSync(new URL('../../frontend/src/data/disputeCatalog.json', import.meta.url), 'utf8'));
let n = 0;
for (const d of cat.disputes) {
  const ff = formFields(d, cat.bases);
  const keys = [...new Set([...ff.setup, ...ff.matter].map((f) => f.key))];
  const facts = Object.fromEntries(keys.map((k) => [k, `{{${k}}}`]));
  const { text } = buildDisputeDoc(d, facts, cat.bases, null, { md: true });
  const used = [...text.matchAll(/\{\{([^}]*)\}\}/g)].map((m) => m[1]);
  assert(used.length > 0, `${d.id}: no placeholders`);
  used.forEach((k) => assert(keys.includes(k), `${d.id}: placeholder {{${k}}} has no field`));
  assert(!/\{\{[^}]*[A-Z][^}]*\}\}/.test(text), `${d.id}: upper-cased placeholder key`);
  assert(/^>>[crj] /m.test(text), `${d.id}: no alignment marker`);
  if (d.kind === 'petition') assert(/^>>c \*\*/m.test(text), `${d.id}: petition has no centred bold heading`);
  // the default (non-md) output is unchanged: no alignment tokens or ** markers
  const plain = buildDisputeDoc(d, {}, cat.bases).text;
  assert(!/>>[crj] |\*\*/.test(plain), `${d.id}: md markers leaked into the Auto-Draft output`);
  n += 1;
}
assert.strictEqual(n, 112);
console.log(`disputeForms: ${n} disputes convert to fillable forms - ok`);
