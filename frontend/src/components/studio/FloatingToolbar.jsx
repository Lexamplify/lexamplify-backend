import { useState, useEffect, useRef, useCallback } from 'react';

const ACTIONS = [
  { key: 'improve', label: 'Improve', icon: '✦' },
  { key: 'rewrite', label: 'Rewrite', icon: '↻' },
  { key: 'expand', label: 'Expand', icon: '⤢' },
  { key: 'simplify', label: 'Simplify', icon: '◇' },
  { key: 'explain', label: 'Explain', icon: '?' },
];

function FloatingToolbar({ wsRef, bridge, onAiAction }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [selectedText, setSelectedText] = useState('');
  const toolbarRef = useRef(null);

  const checkSelection = useCallback(() => {
    try {
      const iframe = wsRef?.current?.querySelector('iframe.wce-frame');
      if (!iframe?.contentDocument) return;
      const sel = iframe.contentDocument.getSelection();
      const text = sel?.toString()?.trim() || '';
      if (text.length < 3) { setVisible(false); return; }

      setSelectedText(text);
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const iframeRect = iframe.getBoundingClientRect();

      setPos({
        top: iframeRect.top + rect.top - 48,
        left: iframeRect.left + rect.left + rect.width / 2,
      });
      setVisible(true);
    } catch { setVisible(false); }
  }, [wsRef]);

  useEffect(() => {
    const iframe = wsRef?.current?.querySelector('iframe.wce-frame');
    if (!iframe?.contentDocument) return;
    const doc = iframe.contentDocument;

    const handler = () => setTimeout(checkSelection, 50);
    doc.addEventListener('mouseup', handler);
    doc.addEventListener('keyup', handler);
    return () => {
      doc.removeEventListener('mouseup', handler);
      doc.removeEventListener('keyup', handler);
    };
  }, [wsRef, bridge, checkSelection]);

  useEffect(() => {
    const handleClick = (e) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target)) {
        setVisible(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (!visible) return null;

  return (
    <div
      ref={toolbarRef}
      className="ads-float-toolbar"
      style={{ top: pos.top, left: pos.left }}
    >
      {ACTIONS.map((a) => (
        <button
          key={a.key}
          className="ads-float-toolbar__btn"
          onClick={() => {
            if (onAiAction) onAiAction(a.key, selectedText);
            setVisible(false);
          }}
          title={a.label}
        >
          <span className="ads-float-toolbar__icon">{a.icon}</span>
          {a.label}
        </button>
      ))}
    </div>
  );
}

export default FloatingToolbar;
