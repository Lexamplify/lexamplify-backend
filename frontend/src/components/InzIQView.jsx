import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useInzIQ } from '../context/InzIQContext';
import { WS } from '../hooks/useWakeWord';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com';

// ── Legal Mode Configuration ──────────────────────────────────────────────────
const MODE_CONFIG = {
  draft: {
    icon: '✍',
    label: 'Draft',
    placeholder: 'Draft a legal document, notice, or agreement…',
    prefix: '[LEGAL DRAFTING MODE] Produce formal, court-ready Indian legal documents. Use proper recitals, numbered clauses, correct statutory references, and precise legal language enforceable under Indian law.',
  },
  research: {
    icon: '⚖',
    label: 'Research',
    placeholder: 'Research case law, statutes, or legal principles…',
    prefix: '[LEGAL RESEARCH MODE] Provide authoritative case law, statutes, and precedents applicable in Indian courts. Always cite the court, year, and key ratio decidendi. Distinguish conflicting judgments.',
  },
  strategize: {
    icon: '⚔',
    label: 'Strategize',
    placeholder: 'Plan litigation strategy, arguments, or tactics…',
    prefix: '[LITIGATION STRATEGY MODE] Think as aggressive senior litigation counsel. Identify procedural advantages, expose weaknesses in opposing arguments, and recommend adversarial tactics and manoeuvres.',
  },
};

// ── Curated Prompt Chips — 8 per mode, targeting senior litigator workflows ──
const CHIP_SETS = {
  draft: [
    { cat: 'NI Act § 138',  label: 'Demand Notice',          q: 'Draft a legal demand notice under Section 138 of the Negotiable Instruments Act for a dishonoured cheque of ₹10,00,000 payable within 15 days, with all statutory requirements.' },
    { cat: 'CrPC § 437',    label: 'Bail Application',       q: 'Draft detailed bail application grounds under Section 437 CrPC for a commercial fraud matter, referencing the latest Supreme Court guidelines on bail and personal liberty.' },
    { cat: 'Article 226',   label: 'Writ Petition',          q: 'Draft a writ petition under Article 226 challenging an arbitrary administrative order on grounds of violation of natural justice, Article 14 and Article 21.' },
    { cat: 'Contract',      label: 'Mutual NDA',             q: 'Draft a mutual non-disclosure agreement between two Indian entities with a 3-year confidentiality period, IP ownership clause, liquidated damages, and jurisdiction in Delhi courts.' },
    { cat: 'Order XLI CPC', label: 'Stay of Execution',      q: 'Draft an application for stay of execution of a money decree pending appeal under Order XLI Rule 5 CPC with detailed grounds and balance of convenience.' },
    { cat: 'Settlement',    label: 'Full & Final Settlement', q: 'Draft a comprehensive settlement agreement with confidentiality clause, non-disparagement, mutual release of all claims, and structured payment terms enforceable under Indian Contract Act.' },
    { cat: 'ID Act 1947',   label: 'Termination Notice',     q: 'Draft a legal notice for wrongful termination and illegal retrenchment under the Industrial Disputes Act 1947, seeking reinstatement with full back wages.' },
    { cat: 'Order IV CPC',  label: 'Recovery Plaint',        q: 'Draft a plaint for recovery of money with compound interest at 18% p.a. and legal costs under Order IV Rule 1 CPC with all required court fee particulars.' },
  ],
  research: [
    { cat: 'SC 2022–24',    label: 'Bail in NDPS',           q: 'What are the latest Supreme Court guidelines and restrictions on granting bail in NDPS Act cases after 2022? Cite the key precedents with their ratios and the twin-conditions test.' },
    { cat: 'Limitation Act',label: 'Condonation of Delay',   q: 'Summarise the current judicial position on condonation of delay under Section 5 of the Limitation Act after recent Supreme Court rulings. What constitutes "sufficient cause" today?' },
    { cat: 'IBC 2016',      label: 'CIRP Timelines',         q: 'Analyse the mandatory timelines for Corporate Insolvency Resolution Process and resolution plan approval under the IBC 2016 including all permitted extensions and judicial precedents.' },
    { cat: 'CrPC § 482',    label: 'FIR Quashing',           q: 'List the settled grounds for quashing an FIR under Section 482 CrPC. Provide the landmark judgments with specific ratios, and distinguish between compoundable and non-compoundable offences.' },
    { cat: 'Evidence Act',  label: 'Burden of Proof Rules',  q: 'Explain the rules of burden of proof and presumptions under the Indian Evidence Act 1872 in civil suits. Which sections shift the burden and under what circumstances?' },
    { cat: 'Arb Act § 37',  label: 'Arbitration Appeals',    q: 'What is the limitation period for filing appeals under Section 37 of the Arbitration and Conciliation Act 1996? Include the latest Supreme Court position on whether the Limitation Act applies.' },
    { cat: 'Puttaswamy',    label: 'Right to Privacy',       q: 'Analyse the evolution of the fundamental right to privacy in India after the Puttaswamy judgment and its current litigation impact on data protection, surveillance, and Aadhaar matters.' },
    { cat: 'RERA 2016',     label: 'Homebuyer Remedies',     q: 'What are the mandatory pre-litigation steps and complete remedies available to homebuyers under RERA 2016 before approaching High Courts? Include limitation periods and defect liability.' },
  ],
  strategize: [
    { cat: 'Written Statement', label: 'Demolish the Plaint',  q: 'Identify the three weakest legal arguments in a typical money recovery suit plaint and draft aggressive paragraph-by-paragraph rebuttals with supporting precedents for my written statement.' },
    { cat: 'Trial Advocacy',    label: 'Cross-Examination Plan', q: 'Design a cross-examination strategy to impeach a hostile witness who gave inconsistent prior statements under Section 162 CrPC. Include specific questions to expose each contradiction.' },
    { cat: 'Threshold',         label: 'Knock Out at Admission', q: 'List all preliminary objections and maintainability challenges I can raise at the first hearing to delay or defeat the plaintiff\'s suit before evidence stage begins.' },
    { cat: 'Injunction Defence',label: 'Block Interim Relief',  q: 'What procedural and substantive arguments can I use to oppose and defeat an urgent ex-parte interim injunction application? Address all three limbs of the balance of convenience test.' },
    { cat: 'Counter-Attack',    label: 'Counter-Claim Strategy', q: 'Draft an aggressive written statement with strong preliminary objections, categorical denial of all material allegations, and a counter-claim that reverses the financial exposure onto the plaintiff.' },
    { cat: 'Appeal Strategy',   label: 'Reverse the Decree',    q: 'Analyse the strongest grounds to appeal a trial court decree against my client. Cover jurisdictional errors, perversity of findings, non-consideration of evidence, and framing of issues.' },
    { cat: 'Precedent War',     label: 'Distinguish Their Cases',q: 'My opponent will cite [Judgment Name]. Give me every possible distinguishing factor — factual, legal, and jurisdictional — to argue why that precedent does not apply to our facts.' },
    { cat: 'Evidence Strategy', label: 'Shift the Burden',      q: 'Identify all documentary and oral evidence I must produce and the order of proof to effectively shift the burden of proof to the opposing party under the Indian Evidence Act.' },
  ],
};

export default function InzIQView() {
  const { wakeState, currentDictation } = useInzIQ();
  const location  = useLocation();
  const navigate  = useNavigate();

  const [messages,   setMessages]   = useState([]);
  const [query,      setQuery]      = useState('');
  const [aiLoading,  setAiLoading]  = useState(false);
  const [legalMode,  setLegalMode]  = useState('research');

  const inputRef       = useRef(null);
  const messagesEndRef = useRef(null);
  const handleSendRef  = useRef(null);

  // ── Derived display state ──────────────────────────────────────────────
  const hasMessages    = messages.length > 0;
  // Voice focus: triggered or dictating collapses the chip grid
  const isVoiceFocused = wakeState === WS.TRIGGERED || wakeState === WS.DICTATING || aiLoading;
  const orbState = aiLoading ? 'processing' :
                   wakeState === WS.DICTATING ? 'dictating' :
                   wakeState !== WS.IDLE      ? 'passive'   : 'idle';
  // Orb expands whenever voice is active; grid fade only matters when no messages
  const focusClass = isVoiceFocused ? 'inziq-focus-active' : 'inziq-focus-idle';

  // ── Auto-scroll to latest message ──────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, aiLoading]);

  // ── Consume voice route state on mount ────────────────────────────────
  useEffect(() => {
    const { query: q = '', autoSubmit = false } = (location.state || {});
    if (q) {
      setQuery(q);
      if (autoSubmit) setTimeout(() => handleSendRef.current?.(null, q), 250);
    }
    window.history.replaceState({}, '');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mirror live dictation into input ───────────────────────────────────
  useEffect(() => {
    if (wakeState === WS.DICTATING && currentDictation) setQuery(currentDictation);
  }, [currentDictation, wakeState]);

  // ── AI chat send ───────────────────────────────────────────────────────
  const handleSend = useCallback(async (e, directQuery = null) => {
    if (e) e.preventDefault();
    const q = (directQuery ?? query).trim();
    if (!q || aiLoading) return;

    // Inject legal mode context as invisible system prefix
    const modePrefix = MODE_CONFIG[legalMode].prefix;

    setMessages(prev => [...prev, { id: `u_${Date.now()}`, role: 'user', text: q }]);
    setQuery('');
    setAiLoading(true);

    try {
      const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');
      const res = await fetch(`${API_BASE}/api/ai/rag-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ query: `${modePrefix}\n\n${q}`, currentPath: '/agent' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMessages(prev => [...prev, {
        id: `a_${Date.now()}`, role: 'assistant',
        text: data.response || data.answer || data.result || 'No response received.',
      }]);
    } catch {
      setMessages(prev => [...prev, {
        id: `e_${Date.now()}`, role: 'error',
        text: 'Unable to reach InzIQ. Check your connection and try again.',
      }]);
    } finally {
      setAiLoading(false);
    }
  }, [query, aiLoading, legalMode]);

  useEffect(() => { handleSendRef.current = handleSend; }, [handleSend]);

  const chips = CHIP_SETS[legalMode];

  return (
    <div className={`inziq-page inziq-mode-${legalMode} ${focusClass}`}>

      {/* ── Atmospheric backdrop (color shifts with orb state) ───────────── */}
      <div className={`inziq-page-backdrop inziq-backdrop-${orbState}`} aria-hidden="true" />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="inziq-header">
        <button onClick={() => navigate(-1)} className="inziq-back-btn" aria-label="Go back">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
          Back
        </button>
        <div className="inziq-header-brand">
          <span className="inziq-header-name">InzIQ</span>
          <span className="inziq-header-sub">Always-On Legal AI</span>
        </div>
        <div className={`inziq-header-status${orbState !== 'idle' ? ` inziq-hs-${orbState}` : ''}`}>
          {orbState === 'passive'    && <><span className="inziq-hs-dot" />Listening</>}
          {orbState === 'dictating'  && <><span className="inziq-hs-dot inziq-hs-dot-hot" />Hot Mic</>}
          {orbState === 'processing' && <><span className="inziq-hs-dot inziq-hs-dot-proc" />Processing</>}
        </div>
      </header>

      {/* ── Orb Stage — compact by default, expands on voice focus ─────── */}
      <div className="inziq-orb-stage">
        <div className={`inziq-orb inziq-orb-${orbState}`}>
          <div className="inziq-orb-ring" />
          <div className="inziq-orb-ring-2" />
          <div className="inziq-orb-core" />
          <div className="inziq-orb-specular" />
        </div>

        <div className="inziq-orb-label">
          {aiLoading ? (
            <span className="inziq-thinking-dots"><span /><span /><span /></span>
          ) : (
            <span className={wakeState === WS.DICTATING ? 'inziq-label-hot' : ''}>
              {wakeState === WS.DICTATING ? 'Listening…'               :
               wakeState === WS.TRIGGERED ? 'InzIQ!'                   :
               wakeState !== WS.IDLE      ? 'Say "Hey InzIQ" to speak' :
               !hasMessages               ? 'Say "Hey InzIQ" or choose a workflow below' : ''}
            </span>
          )}
        </div>

        {wakeState === WS.DICTATING && currentDictation && (
          <div className="inziq-dictation-bubble">{currentDictation}</div>
        )}
      </div>

      {/* ── Empty-State Grid — fades on voice focus, hidden once chat starts ── */}
      {!hasMessages && (
        <div className="inziq-grid-section">
          <div className="inziq-chip-grid">
            {chips.map((chip, i) => (
              <button
                key={`${legalMode}-${i}`}
                className="inziq-chip"
                onClick={() => handleSend(null, chip.q)}
              >
                <span className="inziq-chip-cat">{chip.cat}</span>
                <span className="inziq-chip-label">{chip.label}</span>
                <svg className="inziq-chip-arrow" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Conversation history (scrollable) ───────────────────────────── */}
      {hasMessages && (
        <div className="inziq-messages">
          {messages.map(m => (
            <div key={m.id} className={`inziq-msg inziq-msg-${m.role}`}>
              <div className="inziq-msg-bubble">{m.text}</div>
            </div>
          ))}
          {aiLoading && (
            <div className="inziq-msg inziq-msg-assistant">
              <div className="inziq-msg-bubble inziq-msg-thinking">
                <span className="inziq-thinking-dots"><span /><span /><span /></span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* ── Input Area — always pinned at bottom ────────────────────────── */}
      <div className="inziq-input-area">

        {/* ── ARCHITECT'S INNOVATION: Legal Posture Mode Toggle ───────────
            One click locks the AI's cognitive lens for the entire session.
            Lawyers switch mental modes constantly (drafting → research →
            strategy). This eliminates the need to re-contextualize every
            prompt. The hidden mode prefix in the API call ensures the AI
            actually behaves differently, not just cosmetically. The orb
            core color also shifts per mode for ambient mode awareness.
        ─────────────────────────────────────────────────────────────────── */}
        <div className="inziq-mode-bar" role="group" aria-label="Legal posture mode">
          {Object.entries(MODE_CONFIG).map(([key, conf]) => (
            <button
              key={key}
              className={`inziq-mode-btn${legalMode === key ? ' inziq-mode-active' : ''}`}
              data-mode={key}
              onClick={() => setLegalMode(key)}
              title={`Switch to ${conf.label} mode`}
            >
              <span className="inziq-mode-icon">{conf.icon}</span>
              <span>{conf.label}</span>
            </button>
          ))}
          <span className="inziq-mode-hint">
            {legalMode === 'draft' && 'AI will produce formal court-ready documents'}
            {legalMode === 'research' && 'AI will cite precedents with court & ratio'}
            {legalMode === 'strategize' && 'AI will think as aggressive litigation counsel'}
          </span>
        </div>

        <form onSubmit={handleSend} className="inziq-input-form">
          <textarea
            ref={inputRef}
            rows={1}
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(null); }
            }}
            placeholder={
              wakeState === WS.DICTATING ? '🎤 Listening — speak your command…' :
              MODE_CONFIG[legalMode].placeholder
            }
            className="inziq-textarea"
            disabled={aiLoading}
          />
          <button
            type="submit"
            disabled={!query.trim() || aiLoading}
            className={`inziq-send-btn${query.trim() && !aiLoading ? ' inziq-send-active' : ''}`}
            aria-label="Send"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M22 2L11 13M22 2L15 22 11 13 2 9 22 2z" />
            </svg>
          </button>
        </form>

        <p className="inziq-disclaimer">
          InzIQ can make mistakes. Always verify critical legal information independently.
        </p>
      </div>
    </div>
  );
}
