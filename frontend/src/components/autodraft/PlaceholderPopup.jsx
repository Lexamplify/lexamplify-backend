import { useState, useEffect, useMemo } from 'react';

const CSS = `
.ph-popup-overlay { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,.45); display: grid; place-items: center; animation: ph-fade-in .2s ease; }
@keyframes ph-fade-in { from { opacity: 0; } to { opacity: 1; } }
.ph-popup { background: var(--paper); border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,.25); width: 480px; max-width: 92vw; max-height: 80vh; display: flex; flex-direction: column; overflow: hidden; animation: ph-slide-up .25s ease; }
@keyframes ph-slide-up { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.ph-popup-head { padding: 20px 24px 14px; border-bottom: 1px solid var(--rule); }
.ph-popup-head h3 { margin: 0 0 4px; font-size: 16px; font-weight: 700; color: var(--ink); }
.ph-popup-head p { margin: 0; font-size: 12.5px; color: var(--muted); line-height: 1.5; }
.ph-popup-list { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 20px; display: flex; flex-direction: column; gap: 10px; scrollbar-width: thin; }
.ph-popup-card { border: 1px solid var(--rule); border-radius: 10px; padding: 10px 14px; background: var(--paper-2); }
.ph-popup-card.filled { border-color: color-mix(in srgb, var(--accent) 40%, var(--rule)); background: color-mix(in srgb, var(--accent) 5%, var(--paper-2)); }
.ph-popup-card.skipped { opacity: .55; }
.ph-popup-label { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.ph-popup-token { font: 600 12px 'IBM Plex Mono', monospace; color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--paper)); border-radius: 5px; padding: 2px 7px; }
.ph-popup-count { font-size: 10.5px; color: var(--muted); }
.ph-popup-status { margin-left: auto; font-size: 11px; font-weight: 600; }
.ph-popup-status.done { color: var(--accent); }
.ph-popup-status.skip { color: var(--muted); }
.ph-popup-row { display: flex; gap: 8px; align-items: center; }
.ph-popup-input { flex: 1; border: 1px solid var(--rule); border-radius: 8px; padding: 7px 10px; font-size: 13px; font-family: inherit; background: var(--paper); color: var(--ink); outline: none; transition: border-color .15s ease; }
.ph-popup-input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 14%, transparent); }
.ph-popup-btn { padding: 6px 14px; border-radius: 8px; border: 1px solid var(--accent); background: var(--accent); color: var(--on-accent, #fff); font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.ph-popup-btn:hover { filter: brightness(1.08); }
.ph-popup-btn:disabled { opacity: .4; cursor: not-allowed; }
.ph-popup-btn-skip { padding: 6px 12px; border-radius: 8px; border: 1px solid var(--rule); background: var(--paper); color: var(--muted); font-size: 12px; cursor: pointer; }
.ph-popup-btn-skip:hover { border-color: var(--ink-soft); color: var(--ink-soft); }
.ph-popup-foot { padding: 14px 20px; border-top: 1px solid var(--rule); display: flex; gap: 10px; justify-content: flex-end; }
.ph-popup-foot .done-btn { padding: 9px 24px; border-radius: 10px; border: none; background: var(--accent); color: var(--on-accent, #fff); font-size: 13px; font-weight: 700; cursor: pointer; }
.ph-popup-foot .done-btn:hover { filter: brightness(1.08); }
.ph-popup-foot .skip-all { padding: 9px 18px; border-radius: 10px; border: 1px solid var(--rule); background: var(--paper-2); color: var(--ink-soft); font-size: 13px; cursor: pointer; }
.ph-popup-foot .skip-all:hover { border-color: var(--ink-soft); }
`;

function replaceAll(html, token, value) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(new RegExp(escaped, 'g'), value);
}

export default function PlaceholderPopup({ variables, editor, onClose, onNotify }) {
  const [values, setValues] = useState({});
  const [filled, setFilled] = useState({});
  const [skipped, setSkipped] = useState({});

  const getHtml = () => editor?.getHTML() || '';
  const setHtml = (html) => editor?.commands.setContent(html, false);

  const fillOne = (token) => {
    const val = (values[token] || '').trim();
    if (!val) return;
    const html = getHtml();
    const updated = replaceAll(html, token, val);
    if (updated !== html) {
      setHtml(updated);
      setFilled((f) => ({ ...f, [token]: val }));
      onNotify?.(`Replaced ${token} → "${val}"`);
    }
  };

  const skipOne = (token) => {
    setSkipped((s) => ({ ...s, [token]: true }));
  };

  const skipAll = () => {
    const newSkipped = {};
    variables.forEach(({ token }) => {
      if (!filled[token]) newSkipped[token] = true;
    });
    setSkipped((s) => ({ ...s, ...newSkipped }));
  };

  const pending = variables.filter(({ token }) => !filled[token] && !skipped[token]);
  const allDone = pending.length === 0;

  return (
    <div className="ph-popup-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{CSS}</style>
      <div className="ph-popup">
        <div className="ph-popup-head">
          <h3>Fill missing fields</h3>
          <p>
            {variables.length} placeholder{variables.length !== 1 ? 's' : ''} detected in this draft.
            Fill each field or skip to leave it as a placeholder.
          </p>
        </div>

        <div className="ph-popup-list">
          {variables.map(({ token, count }) => {
            const isFilled = !!filled[token];
            const isSkipped = !!skipped[token];
            return (
              <div key={token} className={`ph-popup-card ${isFilled ? 'filled' : ''} ${isSkipped ? 'skipped' : ''}`}>
                <div className="ph-popup-label">
                  <span className="ph-popup-token">{token}</span>
                  <span className="ph-popup-count">{count}×</span>
                  {isFilled && <span className="ph-popup-status done">Filled</span>}
                  {isSkipped && <span className="ph-popup-status skip">Skipped</span>}
                </div>
                {!isFilled && !isSkipped && (
                  <div className="ph-popup-row">
                    <input
                      className="ph-popup-input"
                      placeholder={`Enter ${token.replace(/[\[\]]/g, '').toLowerCase()}…`}
                      value={values[token] || ''}
                      onChange={(e) => setValues((v) => ({ ...v, [token]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') fillOne(token); }}
                      autoFocus={variables[0]?.token === token}
                    />
                    <button className="ph-popup-btn" disabled={!(values[token] || '').trim()} onClick={() => fillOne(token)}>Fill</button>
                    <button className="ph-popup-btn-skip" onClick={() => skipOne(token)}>Skip</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="ph-popup-foot">
          {!allDone && <button className="skip-all" onClick={skipAll}>Skip remaining</button>}
          <button className="done-btn" onClick={onClose}>
            {allDone ? 'Done' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
