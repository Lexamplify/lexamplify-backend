import { useState, useRef, useEffect, useMemo } from 'react';
import { CheckCircle2, Sparkles, ArrowRight, RotateCcw } from 'lucide-react';

const CSS = `
.ufp { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.ufp-head { padding: 14px 16px 12px; border-bottom: 1px solid var(--rule); }
.ufp-head-title { font-size: 13.5px; font-weight: 700; color: var(--ink); margin: 0 0 3px; }
.ufp-head-sub { font-size: 11.5px; color: var(--muted); line-height: 1.45; }
.ufp-list { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 14px 14px; display: flex; flex-direction: column; gap: 8px; scrollbar-width: thin; }
.ufp-empty { text-align: center; padding: 32px 16px; color: var(--muted); font-size: 13px; line-height: 1.55; }
.ufp-empty svg { display: block; margin: 0 auto 10px; color: var(--accent); }
.ufp-card { border: 1px solid var(--rule); border-radius: 10px; padding: 10px 12px; background: var(--paper-2); transition: border-color .15s ease; }
.ufp-card:focus-within { border-color: var(--accent); }
.ufp-card.filled { border-color: color-mix(in srgb, var(--accent) 40%, var(--rule)); background: color-mix(in srgb, var(--accent) 5%, var(--paper-2)); }
.ufp-token { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.ufp-token-text { font: 600 12px 'IBM Plex Mono', monospace; color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--paper)); border-radius: 5px; padding: 2px 7px; }
.ufp-token-count { font-size: 10.5px; color: var(--muted); }
.ufp-row { display: flex; gap: 6px; align-items: center; }
.ufp-input { flex: 1; border: 1px solid var(--rule); border-radius: 8px; padding: 6px 9px; font-size: 12.5px; font-family: inherit; background: var(--paper); color: var(--ink); outline: none; transition: border-color .15s ease, box-shadow .15s ease; }
.ufp-input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 14%, transparent); }
.ufp-input::placeholder { color: var(--muted); }
.ufp-apply { width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--accent); background: var(--accent); color: var(--on-accent, #fff); cursor: pointer; display: grid; place-items: center; flex-shrink: 0; transition: filter .12s ease; }
.ufp-apply:hover { filter: brightness(1.1); }
.ufp-apply:disabled { opacity: .35; cursor: not-allowed; filter: none; }
.ufp-undo { width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--rule); background: var(--paper); color: var(--muted); cursor: pointer; display: grid; place-items: center; flex-shrink: 0; }
.ufp-undo:hover { border-color: var(--accent); color: var(--accent); }
.ufp-filled-val { font-size: 12px; color: var(--ink-soft); font-style: italic; margin-top: 2px; display: flex; align-items: center; gap: 5px; }
.ufp-filled-val svg { color: var(--accent); }
.ufp-foot { padding: 10px 14px 14px; border-top: 1px solid var(--rule); display: flex; gap: 8px; }
.ufp-foot button { flex: 1; padding: 8px 10px; border-radius: 9px; border: 1px solid var(--rule); background: var(--paper-2); color: var(--ink); font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all .15s ease; }
.ufp-foot button:hover { border-color: var(--accent); color: var(--accent); }
.ufp-foot button.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent, #fff); }
.ufp-foot button.primary:hover { filter: brightness(1.08); color: var(--on-accent, #fff); }
`;

function replaceInHtml(html, token, replacement) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(new RegExp(escaped, 'g'), replacement);
}

export default function UnfilledFieldsPanel({ variables, editor, bridge, onNotify }) {
  const [values, setValues] = useState({});
  const [applied, setApplied] = useState({});

  const varKey = useMemo(() => variables.map((v) => v.token).join('|'), [variables]);
  useEffect(() => {
    setValues({});
    setApplied({});
  }, [varKey]);

  const getHtml = () => {
    if (bridge) return bridge.html();
    if (editor) return editor.getHTML();
    return '';
  };
  const setHtml = (html) => {
    if (bridge) { bridge.loadHtml(html); return; }
    if (editor) { editor.commands.setContent(html, false); }
  };
  const canEdit = !!(editor || bridge);

  const applyOne = (token) => {
    const val = (values[token] || '').trim();
    if (!val || !canEdit) return;
    const content = getHtml();
    const updated = replaceInHtml(content, token, val);
    if (updated !== content) {
      setHtml(updated);
      setApplied((a) => ({ ...a, [token]: val }));
      onNotify?.(`Replaced ${token} with "${val}"`);
    }
  };

  const undoOne = (token) => {
    const val = applied[token];
    if (!val || !canEdit) return;
    const content = getHtml();
    const restored = replaceInHtml(content, val, token);
    if (restored !== content) {
      setHtml(restored);
      setApplied((a) => { const n = { ...a }; delete n[token]; return n; });
      setValues((v) => ({ ...v, [token]: '' }));
      onNotify?.(`Reverted ${token}`);
    }
  };

  const applyAll = () => {
    if (!canEdit) return;
    let content = getHtml();
    let count = 0;
    variables.forEach(({ token }) => {
      const val = (values[token] || '').trim();
      if (!val || applied[token]) return;
      const next = replaceInHtml(content, token, val);
      if (next !== content) { content = next; count++; }
    });
    if (count > 0) {
      setHtml(content);
      const newApplied = { ...applied };
      variables.forEach(({ token }) => {
        const val = (values[token] || '').trim();
        if (val && !applied[token]) newApplied[token] = val;
      });
      setApplied(newApplied);
      onNotify?.(`Filled ${count} placeholder${count === 1 ? '' : 's'}`);
    }
  };

  const pending = variables.filter((v) => !applied[v.token]);
  const filledCount = variables.length - pending.length;

  return (
    <div className="ufp">
      <style>{CSS}</style>
      <div className="ufp-head">
        <div className="ufp-head-title">Unfilled Fields</div>
        <div className="ufp-head-sub">
          {variables.length === 0
            ? 'No placeholders in this draft.'
            : `${filledCount} of ${variables.length} filled`}
        </div>
      </div>

      <div className="ufp-list">
        {variables.length === 0 ? (
          <div className="ufp-empty">
            <CheckCircle2 size={28} />
            All fields are filled — this draft is ready.
          </div>
        ) : (
          variables.map(({ token, count }) => (
            <div key={token} className={`ufp-card ${applied[token] ? 'filled' : ''}`}>
              <div className="ufp-token">
                <span className="ufp-token-text">{token}</span>
                <span className="ufp-token-count">{count}×</span>
              </div>
              {applied[token] ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div className="ufp-filled-val">
                    <CheckCircle2 size={13} /> {applied[token]}
                  </div>
                  <button className="ufp-undo" title="Undo this fill" onClick={() => undoOne(token)}>
                    <RotateCcw size={13} />
                  </button>
                </div>
              ) : (
                <div className="ufp-row">
                  <input
                    className="ufp-input"
                    placeholder={`Enter ${token.replace(/[\[\]]/g, '').toLowerCase()}…`}
                    value={values[token] || ''}
                    onChange={(e) => setValues((v) => ({ ...v, [token]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') applyOne(token); }}
                  />
                  <button
                    className="ufp-apply"
                    disabled={!(values[token] || '').trim()}
                    title="Apply this value"
                    onClick={() => applyOne(token)}
                  >
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {variables.length > 0 && pending.length > 0 && (
        <div className="ufp-foot">
          <button
            className="primary"
            disabled={!pending.some((v) => (values[v.token] || '').trim())}
            onClick={applyAll}
          >
            <Sparkles size={13} /> Fill all entered values
          </button>
        </div>
      )}
    </div>
  );
}
