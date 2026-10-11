import { useEffect, useRef, useState } from 'react';
import { useEditorState } from '@tiptap/react';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import { searchInfo } from './wordExtensions.js';

export default function FindBar({ editor, onClose, initial = '' }) {
  const [term, setTerm] = useState(initial);
  const [repl, setRepl] = useState('');
  const [cs, setCs] = useState(false);
  const [showRepl, setShowRepl] = useState(false);
  const inputRef = useRef(null);
  const info = useEditorState({ editor, selector: ({ editor: ed }) => searchInfo(ed) }) || { count: 0, current: 0 };

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  useEffect(() => { editor?.commands.setSearch(term, cs); }, [editor, term, cs]);
  useEffect(() => () => { if (editor && !editor.isDestroyed) editor.commands.setSearch('', false); }, [editor]);

  return (
    <div className="vw-find" role="search" aria-label="Find and replace">
      <div className="vw-find-row">
        <input ref={inputRef} className="vw-find-input" placeholder="Find in document" aria-label="Find" value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) editor.commands.findPrev(); else editor.commands.findNext(); }
            if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
          }} />
        <span className="vw-find-count" aria-live="polite">{term ? (info.count ? `${info.current} of ${info.count}` : 'No results') : ''}</span>
        <button type="button" className="vw-mini" title="Previous (Shift+Enter)" aria-label="Previous match" onClick={() => editor.commands.findPrev()} disabled={!info.count}><ChevronUp size={14} /></button>
        <button type="button" className="vw-mini" title="Next (Enter)" aria-label="Next match" onClick={() => editor.commands.findNext()} disabled={!info.count}><ChevronDown size={14} /></button>
        <label className="vw-check"><input type="checkbox" checked={cs} onChange={(e) => setCs(e.target.checked)} /> Match case</label>
        <button type="button" className="vw-mini" onClick={() => setShowRepl((v) => !v)} aria-expanded={showRepl}>{showRepl ? 'Hide replace' : 'Replace…'}</button>
        <button type="button" className="vw-mini icon" onClick={onClose} aria-label="Close find"><X size={14} /></button>
      </div>
      {showRepl && (
        <div className="vw-find-row">
          <input className="vw-find-input" placeholder="Replace with" aria-label="Replace with" value={repl} onChange={(e) => setRepl(e.target.value)} />
          <button type="button" className="vw-mini" disabled={!info.count} onClick={() => { editor.commands.replaceCurrent(repl); editor.commands.findNext(); }}>Replace</button>
          <button type="button" className="vw-mini" disabled={!info.count} onClick={() => editor.commands.replaceAll(repl)}>Replace all</button>
        </div>
      )}
    </div>
  );
}
