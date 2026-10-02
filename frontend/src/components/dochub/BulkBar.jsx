import { useState } from 'react';
import { Icon } from './icons.jsx';
import { Menu } from './ui.jsx';
import { fmtNum } from './format.js';

function MoveForm({ folderIndex, onApply, close }) {
  const [v, setV] = useState('');
  return (
    <div className="form">
      <select className="dh-select" value={v} onChange={(e) => setV(e.target.value)} aria-label="Destination folder">
        <option value="">Not filed (no folder)</option>
        {folderIndex.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <button type="button" className="dh-btn primary sm" onClick={() => { close(); onApply(v ? Number(v) : null); }}>Move here</button>
    </div>
  );
}

function TagForm({ onApply, close }) {
  const [v, setV] = useState('');
  const tags = v.split(',').map((t) => t.trim()).filter(Boolean);
  return (
    <div className="form">
      <input className="dh-input" value={v} onChange={(e) => setV(e.target.value)} placeholder="Tag, or several separated by commas" aria-label="Tags" maxLength={120}
        onKeyDown={(e) => { if (e.key === 'Enter' && tags.length) { close(); onApply('tag_add', tags); } }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="dh-btn primary sm" disabled={!tags.length} onClick={() => { close(); onApply('tag_add', tags); }}>Add tag</button>
        <button type="button" className="dh-btn ghost sm" disabled={!tags.length} onClick={() => { close(); onApply('tag_remove', tags); }}>Remove tag</button>
      </div>
    </div>
  );
}

export function BulkBar({ count, folderIndex, matters, classes, busy, onAction, onClear, onZip, onTrash, onAddToBundle }) {
  return (
    <div className="dh-bulk" role="toolbar" aria-label="Actions for the selected documents">
      <span className="n">{fmtNum(count)} selected</span>
      <Menu icon="folder" label="Move to" disabled={busy}>{(close) => <MoveForm folderIndex={folderIndex} close={close} onApply={(fid) => onAction('move', { folder_id: fid })} />}</Menu>
      <Menu icon="tag" label="Set type" disabled={busy}>
        {(close) => (
          <>
            {classes.map((c) => <button key={c} type="button" className="item" onClick={() => { close(); onAction('classify', { doc_class: c }); }}>{c}</button>)}
          </>
        )}
      </Menu>
      <Menu icon="hash" label="Tags" disabled={busy}>{(close) => <TagForm close={close} onApply={(a, tags) => onAction(a, { tags })} />}</Menu>
      <Menu icon="briefcase" label="Matter" disabled={busy}>
        {(close) => (
          <>
            <button type="button" className="item" onClick={() => { close(); onAction('link_matter', { matter_id: null }); }}>Unlink from matter</button>
            <hr />
            {matters.length ? matters.map((m) => <button key={m.id} type="button" className="item" onClick={() => { close(); onAction('link_matter', { matter_id: m.id }); }}>{m.title}</button>)
              : <div className="lab">No matters yet</div>}
          </>
        )}
      </Menu>
      <button type="button" className="dh-btn ghost sm" disabled={busy} onClick={() => onAction('accept')} title="Keep the type the hub chose"><Icon name="check" />Confirm types</button>
      <Menu icon="lock" label="Hold" disabled={busy}>
        {(close) => (
          <>
            <button type="button" className="item" onClick={() => { close(); onAction('hold', { hold: true }); }}><Icon name="lock" />Place legal hold</button>
            <button type="button" className="item" onClick={() => { close(); onAction('hold', { hold: false }); }}>Lift legal hold</button>
            <div className="lab">Only the owner of a document can change its hold.</div>
          </>
        )}
      </Menu>
      <span className="sep" />
      <button type="button" className="dh-btn ghost sm" disabled={busy} onClick={() => onAction('reprocess')}><Icon name="refresh" />Read again</button>
      <button type="button" className="dh-btn ghost sm" disabled={busy} onClick={onZip}><Icon name="zip" />Download .zip</button>
      {onAddToBundle ? <button type="button" className="dh-btn ghost sm" disabled={busy} onClick={onAddToBundle}><Icon name="bundle" />Add to bundle</button> : null}
      <span className="grow" />
      <button type="button" className="dh-btn danger sm" disabled={busy} onClick={onTrash}><Icon name="trash" />Trash</button>
      <button type="button" className="dh-btn quiet sm" onClick={onClear} aria-label="Clear selection"><Icon name="close" />Clear</button>
    </div>
  );
}
