import React from 'react';
import { renderMarkdown } from '../../utils/markdownUtils';

// Backend doesn't emit a category for red-team questions (that's pipeline-
// generation logic, explicitly out of scope for this pass) — classified
// here from keywords in the question/rebuttal text instead, the same
// heuristic-classification approach already used for parseGoverningLaw in
// WarRoomView.jsx.
const CATEGORY_RULES = [
  { tag: 'Limitation', kw: ['limitation', 'time-barred', 'time barred', 'prescribed period'] },
  { tag: 'Procedure', kw: ['notice', 'procedur', 'served', 'filed', 'jurisdiction'] },
  { tag: 'Quantum', kw: ['interest rate', 'quantum', 'arbitrary', 'punitive', 'bank rate'] },
  { tag: 'Damages', kw: ['damages', 'anguish', 'distress', 'compensation', 'valuation'] },
  { tag: 'Mitigation', kw: ['mitigat', 'net spend', 'replacement contractor'] },
  { tag: 'Causation', kw: ['caused', 'delay by', 'contributed', 'own conduct'] },
  { tag: 'Defence', kw: ['force majeure', 'section 56', 'impossib', 'excuse'] },
  { tag: 'Evidence', kw: ['produce', 'evidence', 'proof', 'document', 'contract itself'] },
];

function classifyChallenge(question, rebuttal) {
  const text = `${question || ''} ${rebuttal || ''}`.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.kw.some((k) => text.includes(k))) return rule.tag;
  }
  return 'Evidence';
}

function ChallengeItem({ index, question, rebuttal, isAddressed, onUseInChat }) {
  const category = classifyChallenge(question, rebuttal);
  return (
    <details className={`vc-challenge${isAddressed ? ' answered' : ''}`}>
      <summary>
        <span className="vc-chal-status">{isAddressed ? '✓' : ''}</span>
        <span className="vc-chal-body">
          <span className="vc-chal-tag">{category}</span>
          <div className="vc-chal-q">{question}</div>
        </span>
      </summary>
      <div className="vc-chal-expand">
        {rebuttal && (
          <>
            <div className="vc-rebuttal-box">{rebuttal}</div>
            <button
              type="button"
              className={`vc-use-btn${isAddressed ? ' used' : ''}`}
              onClick={() => onUseInChat(rebuttal, index)}
            >
              {isAddressed ? 'Sent to chat' : 'Use in chat'}
            </button>
          </>
        )}
      </div>
    </details>
  );
}

export default function SimulationRoom({
  questions,
  addressedChallenges,
  onUseInChat,
  chatMessages,
  chatInput,
  setChatInput,
  chatLoading,
  strategyTone,
  setStrategyTone,
  onChatSubmit,
  onQuickReply,
  chatEndRef,
  chatInputRef,
}) {
  return (
    <div className="vc-sim-grid">
      <div className="vc-queue-panel">
        <div className="vc-queue-panel-head">
          <span>Opponent's challenges</span>
        </div>
        {questions.length > 0 ? (
          questions.map((q, i) => (
            <ChallengeItem
              key={i}
              index={i}
              question={q.question}
              rebuttal={q.suggested_rebuttal}
              isAddressed={addressedChallenges.has(i)}
              onUseInChat={onUseInChat}
            />
          ))
        ) : (
          <div className="vc-chal-expand" style={{ padding: '18px', fontStyle: 'italic', color: 'var(--text-muted)' }}>
            No opposition challenges detected.
          </div>
        )}
      </div>

      <div className="vc-chat-panel">
        <div className="vc-chat-head">
          <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--ink)' }}>Live exchange</span>
          <div className="vc-tone-toggle">
            <button
              type="button"
              className={`vc-tone-btn${strategyTone === 'aggressive' ? ' on aggr' : ''}`}
              onClick={() => setStrategyTone('aggressive')}
            >
              ⚔ Aggressive
            </button>
            <button
              type="button"
              className={`vc-tone-btn${strategyTone === 'defensive' ? ' on def' : ''}`}
              onClick={() => setStrategyTone('defensive')}
            >
              🛡 Defensive
            </button>
          </div>
        </div>

        <div className="vc-chat-thread">
          {chatMessages.map((m, i) => (
            <React.Fragment key={i}>
              <div className={`vc-msg ${m.role === 'user' ? 'vc-msg-you' : 'vc-msg-opp'}`}>
                <div className="vc-msg-role">{m.role === 'user' ? 'You' : 'Opposing counsel'}</div>
                {m.role === 'bot' ? (
                  <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
                ) : (
                  m.text
                )}
              </div>
              {m.role === 'bot' && m.rebuttals?.length > 0 && (
                <div className="vc-quick-replies">
                  {m.rebuttals.map((r, j) => (
                    <button
                      key={j}
                      type="button"
                      className="vc-qr-pill"
                      disabled={chatLoading}
                      onClick={() => onQuickReply(r)}
                    >
                      ↳ {r}
                    </button>
                  ))}
                </div>
              )}
            </React.Fragment>
          ))}
          {chatLoading && <div className="vc-msg vc-msg-opp vc-typing">Opposing counsel preparing cross-examination…</div>}
          <div ref={chatEndRef} />
        </div>

        <form className="vc-chat-input-row" onSubmit={onChatSubmit}>
          <textarea
            ref={chatInputRef}
            placeholder="State your argument or respond to opposition…"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            disabled={chatLoading}
            rows={1}
          />
          <button type="submit" className="vc-send-btn" disabled={chatLoading || !chatInput.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
