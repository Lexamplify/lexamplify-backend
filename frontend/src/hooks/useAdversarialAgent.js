import { useState, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com';
const getToken = () => localStorage.getItem('token') || localStorage.getItem('lexai_token');

// ── Stage-specific attack vectors ─────────────────────────────────────────────
const STAGE_CONTEXTS = {
  pre_filing:
    'STAGE — PRE-FILING RISK SCAN: You are attacking the case BEFORE it reaches court. ' +
    'Identify fatal bars: Order VII Rule 11 CPC (rejection of plaint), bar of limitation under ' +
    'the Limitation Act 1963, absence of cause of action, lack of territorial or pecuniary ' +
    'jurisdiction, and non-joinder of necessary parties under Order I Rule 10 CPC. Your goal: ' +
    'ensure this case is dead before the first filing stamp.',

  bail:
    'STAGE — BAIL OPPOSITION: You are opposing a bail application with maximum severity. ' +
    'Deploy: gravity and heinousness of the alleged offence, concrete flight risk factors, ' +
    'real risk of tampering with evidence or suborning witnesses, prior criminal antecedents. ' +
    'Cite Section 437, 438, 439 CrPC or Sections 480-483 BNSS 2023 as applicable. ' +
    'Demand judicial custody be maintained and attack every bail ground raised.',

  cross_exam:
    'STAGE — WITNESS CROSS-EXAMINATION: You are dismantling the opposing side\'s key witness. ' +
    'Exploit contradictions between examination-in-chief and documentary evidence on record. ' +
    'Invoke Section 145 IEA (prior inconsistent statements), Section 146 (credibility attacks), ' +
    'Section 155 (impeachment of witness). Under Bharatiya Sakshya Adhiniyam 2023, apply ' +
    'Sections 141-160. Find the single factual contradiction that collapses the entire testimony.',

  final_args:
    'STAGE — FINAL ARGUMENTS: You are delivering closing submissions before the Hon\'ble Court. ' +
    'Demolish: chain of custody of every material exhibit, credibility of every witness, ' +
    'procedural violations in investigation under CrPC/BNSS, and apply burden-of-proof under ' +
    'Sections 101-104 IEA / Sections 94-97 BSA 2023. Cite Supreme Court Division Bench and ' +
    'Full Bench judgments by exact citation. Demand acquittal, dismissal, or decree in your favour.',
};

// ── System prompt factory ─────────────────────────────────────────────────────
export const buildSystemPrompt = (stage, caseContext) => {
  const stageCtx = STAGE_CONTEXTS[stage] || STAGE_CONTEXTS.pre_filing;
  return (
    `You are OPPOSING COUNSEL — a senior advocate with 25 years of practice before the Supreme Court ` +
    `and High Courts of India. You are inside the Virtual Courtroom simulation module of LexAmplify.\n\n` +
    `YOUR ADVERSARIAL MANDATE:\n` +
    `1. NEVER assist or be helpful to the user's legal position. Your sole function is to DESTROY it.\n` +
    `2. JURISDICTION: You operate exclusively under Indian Law — IPC 1860, Bharatiya Nyaya Sanhita 2023 ` +
    `(BNS), CrPC 1973, BNSS 2023, CPC 1908, Indian Evidence Act 1872 / Bharatiya Sakshya Adhiniyam 2023, ` +
    `Transfer of Property Act 1882, Specific Relief Act 1963, and all relevant Special Acts ` +
    `(POCSO, PMLA, NDPS, IBC, Companies Act 2013).\n` +
    `3. BANNED VOCABULARY — using any of these is a professional failure: "felony", "misdemeanor", ` +
    `"plea bargain", "District Attorney", "arraignment", "5th Amendment", "Miranda rights", ` +
    `"voir dire". Use only Indian legal terminology. "Prosecutor" → "Learned Public Prosecutor" or "APP".\n` +
    `4. CITE ONLY Indian case law: Supreme Court of India (AIR/SCC/SCR citations), High Court judgments, ` +
    `or Privy Council precedents applicable under Article 141. Never cite American, British, ` +
    `or foreign case law unless explicitly instructed on comparative law.\n` +
    `5. ATTACK STRATEGY: Identify the single most fatal flaw — procedural, substantive, or evidentiary ` +
    `— in the user's argument and attack it with surgical, devastating precision. Name the exact section, ` +
    `the exact precedent. No general observations.\n` +
    `6. TONE: Clinical, aggressive, merciless. Short declarative sentences. No pleasantries. ` +
    `You are before the Hon'ble Court.\n` +
    `7. MANDATORY CLOSER: End EVERY response with one pointed question beginning with ` +
    `"Counsel, your response to this:" followed by the specific legal challenge they must answer next.\n\n` +
    `${stageCtx}\n\n` +
    (caseContext
      ? `DOCUMENTS ADMITTED INTO EVIDENCE:\n${caseContext}\n\n` +
        `Use the above documents to identify specific factual contradictions, procedural lapses, ` +
        `and evidentiary weaknesses. Quote verbatim where it destroys the opposing case.\n\n`
      : `No case documents are in evidence. Attack purely on legal principles and procedural defects.\n\n`) +
    `BEGIN ADVERSARIAL SIMULATION.`
  );
};

// ── Pressure delta calculator ─────────────────────────────────────────────────
const computePressureDelta = (aiText) => {
  let delta = 0;
  const lower = aiText.toLowerCase();

  // Citation density — each Indian law citation raises pressure
  const citations = (aiText.match(/\b(AIR|SCC|SCR|MLJ|CriLJ|BLJR|AllLJ)\s+\d{4}/g) || []).length;
  delta += citations * 7;

  // Statutory sections cited — each section = systemic attack
  const sections = (aiText.match(/\bsection\s+\d+[A-Z]?(\([a-z0-9]+\))*/gi) || []).length;
  delta += Math.min(sections * 4, 22);

  // Attack vocabulary — each term signals an identified weakness
  const attackTerms = [
    'fatal', 'inadmissible', 'untenable', 'no locus standi', 'barred by limitation',
    'cannot sustain', 'fails', 'defective plaint', 'dismissed', 'contrary to law',
    'void ab initio', 'no cause of action', 'time-barred', 'lack of jurisdiction',
    'contempt', 'perjury', 'adverse inference', 'collateral attack', 'non est factum',
    'bad in law', 'incompetent witness', 'hearsay', 'no probative value',
  ];
  attackTerms.forEach(t => { if (lower.includes(t)) delta += 5; });

  // Response length = sustained, multi-front assault
  if (aiText.length > 600) delta += 8;
  if (aiText.length > 1200) delta += 8;

  return Math.min(delta, 44); // cap per-turn increment to prevent instant maxing
};

// ── The hook ──────────────────────────────────────────────────────────────────
export function useAdversarialAgent() {
  const [messages, setMessages] = useState([]);
  const [isThinking, setIsThinking] = useState(false);
  const [pressure, setPressure] = useState(18);
  const [stage, setStage] = useState('pre_filing');
  const [caseContext, setCaseContext] = useState('');

  const sendMessage = useCallback(async (userText) => {
    if (!userText.trim() || isThinking) return;

    const userMsg = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: userText,
      ts: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setIsThinking(true);

    // Long user response = slight pressure relief (holding ground)
    if (userText.length > 200) {
      setPressure(p => Math.max(6, p - Math.min(12, Math.floor(userText.length / 100))));
    }

    try {
      const systemPrompt = buildSystemPrompt(stage, caseContext);

      // Build conversation history string (last 8 exchanges for context)
      const historySnapshot = [...messages, userMsg].slice(-8);
      const conversationStr = historySnapshot
        .map(m =>
          m.role === 'user'
            ? `COUNSEL FOR PETITIONER/APPELLANT: ${m.text}`
            : `OPPOSING COUNSEL: ${m.text}`,
        )
        .join('\n\n');

      const payload = {
        message:
          `${systemPrompt}\n\n` +
          `---\nCONVERSATION RECORD:\n${conversationStr}\n\n` +
          `Now respond as Opposing Counsel with a precise legal attack:`,
      };

      const res = await fetch(`${API_BASE}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(getToken() && { Authorization: `Bearer ${getToken()}` }),
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      const aiText =
        data.response || data.message || data.answer ||
        'The simulation engine is currently unreachable. Check backend connection.';

      const aiMsg = {
        id: `a-${Date.now()}`,
        role: 'ai',
        text: aiText,
        ts: new Date(),
        pressureDelta: computePressureDelta(aiText),
      };

      setMessages(prev => [...prev, aiMsg]);
      setPressure(p => Math.min(97, p + aiMsg.pressureDelta));
    } catch {
      setMessages(prev => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'ai',
          text: 'Simulation engine offline. Verify backend connection and retry.',
          ts: new Date(),
          error: true,
        },
      ]);
    }

    setIsThinking(false);
  }, [messages, isThinking, stage, caseContext]);

  const clearSession = useCallback(() => {
    setMessages([]);
    setPressure(18);
  }, []);

  return {
    messages,
    isThinking,
    pressure,
    stage,
    setStage,
    caseContext,
    setCaseContext,
    sendMessage,
    clearSession,
  };
}
