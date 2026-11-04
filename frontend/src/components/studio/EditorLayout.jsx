import { useState, useRef, useCallback, useEffect } from 'react';

function EditorLayout({ left, center, right, showLeft = true, showRight = true, onToggleLeft, onToggleRight }) {
  const [leftW, setLeftW] = useState(() => {
    try { return Number(localStorage.getItem('ads-left-w')) || 260; } catch { return 260; }
  });
  const [rightW, setRightW] = useState(() => {
    try { return Number(localStorage.getItem('ads-right-w')) || 372; } catch { return 372; }
  });

  useEffect(() => { try { localStorage.setItem('ads-left-w', String(leftW)); } catch {} }, [leftW]);
  useEffect(() => { try { localStorage.setItem('ads-right-w', String(rightW)); } catch {} }, [rightW]);

  const dragging = useRef(null);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = useCallback((side, e) => {
    e.preventDefault();
    dragging.current = side;
    startX.current = e.clientX;
    startW.current = side === 'left' ? leftW : rightW;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [leftW, rightW]);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      const dx = e.clientX - startX.current;
      if (dragging.current === 'left') {
        setLeftW(Math.max(200, Math.min(400, startW.current + dx)));
      } else {
        setRightW(Math.max(300, Math.min(500, startW.current - dx)));
      }
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  return (
    <div className="ads-editor-layout">
      {showLeft && (
        <>
          <div className="ads-panel ads-panel--left" style={{ width: leftW }}>
            <div className="ads-panel__collapse" onClick={onToggleLeft} title="Collapse panel">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" /></svg>
            </div>
            {left}
          </div>
          <div className="ads-resize-handle" onMouseDown={(e) => onMouseDown('left', e)} />
        </>
      )}
      {!showLeft && (
        <button className="ads-panel-tab ads-panel-tab--left" onClick={onToggleLeft} title="Show outline panel">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" /></svg>
        </button>
      )}

      <div className="ads-panel ads-panel--center">
        {center}
      </div>

      {showRight && (
        <>
          <div className="ads-resize-handle" onMouseDown={(e) => onMouseDown('right', e)} />
          <div className="ads-panel ads-panel--right" style={{ width: rightW }}>
            <div className="ads-panel__collapse ads-panel__collapse--right" onClick={onToggleRight} title="Collapse panel">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" /></svg>
            </div>
            {right}
          </div>
        </>
      )}
      {!showRight && (
        <button className="ads-panel-tab ads-panel-tab--right" onClick={onToggleRight} title="Show AI panel">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" /></svg>
        </button>
      )}
    </div>
  );
}

export default EditorLayout;
