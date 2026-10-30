// AI editing for the draft, client-side.
//  - If the user configured a key (Settings -> AI), we call an OpenAI-compatible
//    chat endpoint directly from the browser and return the model's rewrite.
//  - Otherwise a built-in heuristic "edit engine" handles the common legal-drafting
//    instructions so the demo works out of the box with nothing to host.

const CFG_KEY = 'lx-ai-config-v1';

export function getAiConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch { return {}; }
}
export function setAiConfig(cfg) {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function hasLLM() {
  const c = getAiConfig();
  return !!(c.key && c.baseUrl && c.model);
}

const STANDARD_CLAUSES = {
  arbitration:
    'Arbitration. Any dispute, controversy or claim arising out of or relating to this agreement, including its breach, termination or validity, shall be finally resolved by arbitration under the Arbitration and Conciliation Act, 1996, before a sole arbitrator appointed by mutual consent of the parties. The seat and venue of arbitration shall be New Delhi and the language shall be English.',
  confidentiality:
    'Confidentiality. Each party shall keep confidential all non-public information disclosed by the other party in connection with this agreement and shall not use or disclose such information except as strictly necessary to perform its obligations hereunder. This obligation shall survive the termination of this agreement for a period of three (3) years.',
  termination:
    'Termination. Either party may terminate this agreement upon thirty (30) days’ prior written notice to the other party. Termination shall not affect any rights or obligations that have accrued as of the effective date of termination.',
  jurisdiction:
    'Governing Law and Jurisdiction. This agreement shall be governed by and construed in accordance with the laws of India, and the courts at New Delhi shall have exclusive jurisdiction over any matter arising out of or in connection with this agreement.',
  indemnity:
    'Indemnity. Each party shall indemnify and hold harmless the other party against any loss, damage, cost or expense (including reasonable legal fees) arising out of or in connection with any breach of this agreement or any negligent or wrongful act or omission of the indemnifying party.',
};

function detectClause(instruction) {
  const t = instruction.toLowerCase();
  for (const key of Object.keys(STANDARD_CLAUSES)) {
    if (t.includes(key)) return key;
  }
  if (t.includes('governing law')) return 'jurisdiction';
  if (t.includes('nda') || t.includes('non-disclosure')) return 'confidentiality';
  return null;
}

// --- heuristic transforms on plain text ---------------------------------------

function formalize(text) {
  return text
    .replace(/\bcan't\b/gi, 'cannot').replace(/\bwon't\b/gi, 'will not').replace(/\bdon't\b/gi, 'do not')
    .replace(/\bit's\b/gi, 'it is').replace(/\bI'm\b/gi, 'I am').replace(/\bdidn't\b/gi, 'did not')
    .replace(/\bgonna\b/gi, 'going to').replace(/\bwanna\b/gi, 'want to')
    .replace(/\bget\b/gi, 'obtain').replace(/\bshow\b/gi, 'demonstrate').replace(/\bask\b/gi, 'request');
}
function simplify(text) {
  return text
    .replace(/\bheretofore\b/gi, 'until now').replace(/\bhereinafter\b/gi, 'below')
    .replace(/\baforementioned\b/gi, 'above').replace(/\bnotwithstanding\b/gi, 'despite')
    .replace(/\bpursuant to\b/gi, 'under').replace(/\bin the event that\b/gi, 'if')
    .replace(/\bprior to\b/gi, 'before').replace(/\bshall be constrained to\b/gi, 'will have to');
}
function shorten(text) {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 1) return text.length > 220 ? text.slice(0, 200).trim() + '…' : text;
  const keep = Math.max(1, Math.ceil(sentences.length * 0.6));
  return sentences.slice(0, keep).join(' ');
}
function strengthen(text) {
  const closing = ' The position is well settled and admits of no serious doubt on the authorities.';
  return text.replace(/\s*$/, '') + closing;
}
function assertive(text) {
  return text
    .replace(/\bit is submitted that\b/gi, 'it is respectfully but firmly submitted that')
    .replace(/\bmay\b/gi, 'shall').replace(/\bmight\b/gi, 'will').replace(/\bperhaps\b/gi, 'clearly')
    .replace(/\bwe believe\b/gi, 'it is established');
}

const MODES = [
  { k: 'formal', test: /formal|professional|polish/i, fn: formalize, note: 'Made the language more formal.' },
  { k: 'plain', test: /simpl|plain|clear|readable|easier/i, fn: simplify, note: 'Simplified to plainer language.' },
  { k: 'short', test: /short|concise|trim|tighten|brief|cut/i, fn: shorten, note: 'Tightened and shortened.' },
  { k: 'strong', test: /strength|stronger|forceful|robust|authorit/i, fn: strengthen, note: 'Strengthened the argument.' },
  { k: 'assert', test: /assert|confiden|firm|decisive/i, fn: assertive, note: 'Made the tone more assertive.' },
];

function localEdit({ instruction, selection, fullText }) {
  const target = (selection && selection.trim()) ? selection : fullText;
  const clause = detectClause(instruction);

  if (/\badd\b|\binsert\b|\binclude\b/i.test(instruction) && clause) {
    return { text: STANDARD_CLAUSES[clause], mode: 'insert', note: `Added a standard ${clause} clause.` };
  }

  for (const m of MODES) {
    if (m.test.test(instruction)) {
      return { text: m.fn(target), mode: selection ? 'replace' : 'replaceAll', note: m.note };
    }
  }

  // Default: light formalization + a clarifying lead-in acknowledging the instruction.
  return {
    text: formalize(target),
    mode: selection ? 'replace' : 'replaceAll',
    note: 'Applied a general polish (set an AI key in Settings for instruction-specific edits).',
  };
}

// --- optional real LLM (OpenAI-compatible) ------------------------------------

async function llmEdit({ instruction, selection, fullText }) {
  const c = getAiConfig();
  const target = (selection && selection.trim()) ? selection : fullText;
  const sys = 'You are a senior Indian legal drafting assistant. Rewrite the provided text to satisfy the instruction. Return ONLY the rewritten text, no preamble, no quotes, no markdown fences.';
  const user = `INSTRUCTION:\n${instruction}\n\nTEXT:\n${target}`;
  const res = await fetch(c.baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key },
    body: JSON.stringify({ model: c.model, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], temperature: 0.3 }),
  });
  if (!res.ok) throw new Error('AI request failed (' + res.status + ')');
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Empty AI response');
  return { text, mode: selection ? 'replace' : 'replaceAll', note: 'Edited with your AI model.' };
}

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function serverEdit({ instruction, selection, fullText }) {
  const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
  const res = await fetch(API_BASE + '/api/drafts/ai-edit', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
    body: JSON.stringify({ instruction, selection: selection || '', fullText: fullText || '' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || ('AI request failed (' + res.status + ')'));
  if (!data.text) throw new Error('Empty AI response');
  return { text: data.text, mode: data.mode || (selection ? 'replace' : 'replaceAll'), note: data.note || 'Edited with your AI model.' };
}

export async function runAiEdit(args) {
  // Prefer server-side (uses backend OPENAI/GROQ key) → user-configured client key → local heuristic.
  try { return { ...(await serverEdit(args)), usedLLM: true }; }
  catch (e1) {
    if (hasLLM()) {
      try { return { ...(await llmEdit(args)), usedLLM: true }; }
      catch (e2) { return { ...localEdit(args), usedLLM: false, note: 'AI unreachable — used the built-in editor. (' + e2.message + ')' }; }
    }
    return { ...localEdit(args), usedLLM: false };
  }
}

export { STANDARD_CLAUSES };
