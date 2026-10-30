// frontend/src/data/disputeForms.js
// Turns the 112-entry Dispute Library (the same catalog Auto-Draft Studio uses) into fillable
// Legal Forms templates. The catalog (~340 KB) is loaded lazily, on first visit to a page that
// needs it, and pushed into the shared TEMPLATES / CATEGORIES arrays so every consumer sees it.
import { useSyncExternalStore } from 'react';
import { TEMPLATES, CATEGORIES, CUSTOM_CATEGORY, decorate } from './legalTemplates.js';
import { formFields, buildDisputeDoc } from '../utils/disputeDraft.js';

export const DISPUTE_CATEGORY = 'Disputes';
export const DISPUTE_ID_PREFIX = 'dp_';

const REQUIRED = new Set(['p1_name', 'p2_name', 'authority']);

let status = 'idle'; // idle | loading | ready | error
let promise = null;
let catalogRef = null;
let version = 0;
const listeners = new Set();
const emit = () => { version += 1; listeners.forEach((l) => l()); };

function buildTemplate(d, bases, catLabel) {
  const ff = formFields(d, bases);
  const seen = new Set();
  const fields = [];
  [...ff.setup, ...ff.matter].forEach((f) => {
    if (seen.has(f.key)) return;
    seen.add(f.key);
    fields.push({
      key: f.key, field_id: f.key, label: f.label, hint: f.hint || '',
      type: ['text', 'textarea', 'date', 'number'].includes(f.type) ? f.type : 'text',
      required: REQUIRED.has(f.key), group: f.group,
    });
  });
  const facts = Object.fromEntries(fields.map((f) => [f.key, `{{${f.key}}}`]));
  const { text } = buildDisputeDoc(d, facts, bases, null, { md: true });
  return decorate({
    id: `${DISPUTE_ID_PREFIX}${d.id}`,
    aliases: [d.id],
    title: d.title,
    category: DISPUTE_CATEGORY,
    subcategory: catLabel,
    catId: d.cat,
    dispute: true,
    disputeId: d.id,
    blurb: d.blurb,
    forum: d.forum,
    docTitle: d.doc,
    kind: d.kind,
    keywords: Array.isArray(d.keywords) ? d.keywords.join(' ') : String(d.keywords || ''),
    fields,
    preview: text,
    demo: {},
  });
}

/** Idempotent. Resolves to the catalog once the dispute templates are in TEMPLATES. */
export function loadDisputeTemplates() {
  if (status === 'ready') return Promise.resolve(catalogRef);
  if (promise) return promise;
  status = 'loading';
  promise = import('./disputeCatalog.json')
    .then((cm) => {
      const catalog = cm.default || cm;
      const labels = new Map(catalog.categories.map((c) => [c.id, c.label]));
      const built = catalog.disputes.map((d) => buildTemplate(d, catalog.bases, labels.get(d.cat) || ''));
      for (let i = TEMPLATES.length - 1; i >= 0; i -= 1) if (TEMPLATES[i].dispute) TEMPLATES.splice(i, 1);
      const firstCustom = TEMPLATES.findIndex((t) => t.custom);
      TEMPLATES.splice(firstCustom === -1 ? TEMPLATES.length : firstCustom, 0, ...built);
      if (!CATEGORIES.includes(DISPUTE_CATEGORY)) {
        const ci = CATEGORIES.indexOf(CUSTOM_CATEGORY);
        CATEGORIES.splice(ci === -1 ? CATEGORIES.length : ci, 0, DISPUTE_CATEGORY);
      }
      catalogRef = catalog;
      status = 'ready';
      emit();
      return catalog;
    })
    .catch((err) => {
      console.error('[disputeForms] could not load the dispute library', err);
      status = 'error';
      promise = null;
      emit();
      return null;
    });
  return promise;
}

const subscribe = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };

/** Triggers the lazy load and re-renders the caller when it finishes. */
export function useDisputeTemplates() {
  useSyncExternalStore(subscribe, () => version, () => 0);
  if (status === 'idle') loadDisputeTemplates();
  return { ready: status === 'ready', error: status === 'error', catalog: catalogRef };
}

export const isDisputeTemplateId = (id) => typeof id === 'string' && id.startsWith(DISPUTE_ID_PREFIX);
