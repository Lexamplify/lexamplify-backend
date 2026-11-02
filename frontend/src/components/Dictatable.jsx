import { useRef } from 'react';
import MicButton, { LangPicker } from './MicButton.jsx';
import '../styles/dictation.css';

// Wrap ONE <input> or <textarea> to give it a microphone. The field itself is not touched: no new props, no
// ref, no state. The words are inserted at the caret and the field's own onChange runs as if the user typed them.
//
//   <Dictatable><textarea className="inp" value={v} onChange={...} /></Dictatable>
//
// `lang` shows the language picker (on hover/focus) for long fields where the choice matters.
export default function Dictatable({ children, kind = 'legal', spokenCommands, lang = true, className = '', style }) {
  const wrapRef = useRef(null);
  const getEl = () => wrapRef.current?.querySelector('textarea, input');
  const isArea = (() => {
    const c = Array.isArray(children) ? children[0] : children;
    return c && c.type === 'textarea';
  })();
  return (
    <div ref={wrapRef} className={`dict ${isArea ? 'dict--area' : 'dict--line'} ${className}`} style={style}>
      {children}
      <div className="dict__tools">
        {lang && <LangPicker className="mic-lang--tool" />}
        <MicButton getTarget={getEl} kind={kind} spokenCommands={spokenCommands} />
      </div>
    </div>
  );
}
