// "Paper files": the register of physical files — where each one is kept, who has it, when it is due back — with printable
// QR labels so a file can be found, issued and returned by scanning it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CasePicker, DocPickerModal, KIND_NAME, Spinner, dueText, fmtDay, todayIso } from './FilesCommon.jsx';
import { fx, openPdf } from './filesApi.js';
import { fmtAgo, fmtNum, plural } from './format.js';
import { Icon } from './icons.jsx';
import { Pager } from './DocList.jsx';
import { Confirm, EmptyState, Menu, Modal, Portal, useDebounced, useDialog } from './ui.jsx';

const PER = 30;
const STATUS_TABS = [
  { id: 'active', label: 'All' },
  { id: 'in', label: 'On the shelf' },
  { id: 'out', label: 'Out' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'lost', label: 'Lost' },
  { id: 'archived', label: 'Archived' },
];
const LABEL_LAYOUTS = [['a4-24', 'A4 sheet, 24 labels'], ['a4-12', 'A4 sheet, 12 labels'], ['a4-6', 'A4 sheet, 6 big labels'], ['roll', 'Label printer (one per label)']];
const ACTION_TEXT = {
  created: 'Added to the register', moved: 'Moved', edited: 'Details changed', issued: 'Taken out', 'handed-over': 'Handed over', returned: 'Returned',
  lost: 'Marked lost', found: 'Found again', archived: 'Archived', restored: 'Restored', 'linked-docs': 'Scans linked',
};

const statusChip = (f) => {
  if (f.status === 'out') return f.overdue ? { tone: 'bad', text: 'Overdue' } : { tone: 'warn', text: 'Out' };
  if (f.status === 'lost') return { tone: 'bad', text: 'Lost' };
  if (f.status === 'archived') return { tone: '', text: 'Archived' };
  return { tone: '', text: 'On the shelf' };
};

function historyLine(m) {
  const base = ACTION_TEXT[m.action] || m.action;
  const bits = [];
  if (m.action === 'issued' || m.action === 'handed-over') bits.push(m.from_holder ? `from ${m.from_holder} to ${m.to_holder}` : `to ${m.to_holder}`);
  if (m.action === 'returned' && m.from_holder) bits.push(`by ${m.from_holder}`);
  if (m.to_loc && (m.action === 'moved' || m.action === 'returned' || m.action === 'created')) bits.push(`→ ${m.to_loc}`);
  if (m.due_at) bits.push(`due ${fmtDay(m.due_at)}`);
  return { head: base, detail: bits.join(' · '), note: m.action === 'edited' ? `Changed: ${m.note || ''}` : m.note };
}

// ── shelf select with the full path, e.g. "Record room › Almirah 3 › Shelf B" ───────────────
function ShelfSelect({ locations, value, onChange, placeholder = 'Not on a shelf yet', id, required }) {
  const opts = useMemo(() => (locations || []).filter((l) => !l.archived).map((l) => ({ id: l.id, label: l.path, depth: l.path.split(' › ').length - 1 })), [locations]);
  return (
    <select id={id} className="dh-select" value={value || ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} required={required}>
      <option value="">{placeholder}</option>
      {opts.map((o) => <option key={o.id} value={o.id}>{`${'  '.repeat(o.depth)}${o.label.split(' › ').pop()}${o.depth ? `   (${o.label.split(' › ').slice(0, -1).join(' › ')})` : ''}`}</option>)}
    </select>
  );
}

// ── create / edit a paper file ───────────────────────────────────────────────────────────────
function FileModal({ file, locations, caseRef, caseLabel, onClose, onSaved, onShelves }) {
  const edit = !!file;
  const [f, setF] = useState(() => ({
    title: file?.title || '', kind: file?.kind || 'file', case_ref: file ? (file.case_ref || '') : (caseRef || ''), case_label: file ? file.case_label : caseLabel, client: file?.client || '',
    location_id: file?.location_id || null, location_note: file?.location_note || '', pages_est: file?.pages_est ?? '', notes: file?.notes || '',
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e) => {
    e?.preventDefault();
    if (busy) return;
    if (!f.title.trim() && !f.case_ref) { setErr('Give the file a name, for example “Sharma v. Verma — Vol. 1”, or pick its case.'); return; }
    setBusy(true); setErr('');
    try {
      const body = { title: f.title.trim(), kind: f.kind, case_ref: f.case_ref || '', client: f.client.trim(), location_id: f.location_id, location_note: f.location_note.trim(), pages_est: f.pages_est === '' ? null : f.pages_est, notes: f.notes.trim() };
      const r = edit ? await fx.paperEdit(file.id, body) : await fx.paperCreate(body);
      onSaved(r.file, !edit);
    } catch (ex) { setErr(ex.message || 'Could not save.'); setBusy(false); }
  };
  return (
    <Modal title={edit ? `Edit ${file.file_no}` : 'Add a paper file'} onClose={busy ? () => {} : onClose}
      footer={<><button type="button" className="dh-btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="fx-fileform" className="dh-btn primary" disabled={busy}>{busy ? 'Saving…' : edit ? 'Save changes' : 'Add to register'}</button></>}>
      <form id="fx-fileform" onSubmit={submit} className="fx-form">
        <label className="dh-field"><span className="lab">Name on the file cover</span>
          <input className="dh-input" autoFocus value={f.title} maxLength={160} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Sharma v. Verma — Vol. 1" /></label>
        <div className="dh-field"><span className="lab">Case</span>
          <CasePicker value={f.case_ref} label={f.case_label} allowNone noneLabel="Not linked to a case" placeholder="Link to a case (optional)" onChange={(ref, c) => { set('case_ref', ref); set('case_label', c?.title || ''); if (c && !f.title.trim()) set('title', c.title); if (c?.client && !f.client) set('client', c.client); }} />
        </div>
        <div className="dh-row2">
          <label className="dh-field"><span className="lab">Kind</span>
            <select className="dh-select" value={f.kind} onChange={(e) => set('kind', e.target.value)}>{Object.entries(KIND_NAME).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
          <label className="dh-field"><span className="lab">Client</span><input className="dh-input" value={f.client} maxLength={120} onChange={(e) => set('client', e.target.value)} placeholder="Optional" /></label>
        </div>
        <div className="dh-field"><span className="lab">Kept in</span>
          <ShelfSelect locations={locations} value={f.location_id} onChange={(v) => set('location_id', v)} />
          <span className="hint">Not set up yet? <button type="button" className="fx-link" onClick={onShelves}>Add your almirahs and shelves</button></span></div>
        <div className="dh-row2">
          <label className="dh-field"><span className="lab">Exact spot</span><input className="dh-input" value={f.location_note} maxLength={120} onChange={(e) => set('location_note', e.target.value)} placeholder="e.g. second from the left" /></label>
          <label className="dh-field"><span className="lab">Approx. pages</span><input className="dh-input" inputMode="numeric" value={f.pages_est} onChange={(e) => set('pages_est', e.target.value.replace(/[^\d]/g, '').slice(0, 6))} placeholder="Optional" /></label>
        </div>
        <label className="dh-field"><span className="lab">Notes</span><textarea className="dh-textarea" rows={2} maxLength={500} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Anything the next person should know" /></label>
        {err ? <p role="alert" className="fx-err">{err}</p> : null}
      </form>
    </Modal>
  );
}

// ── hand a file to someone ─────────────────────────────────────────────────────────────────
function IssueModal({ file, people, onClose, onDone }) {
  const [who, setWho] = useState(people.length ? 'member' : 'other');
  const [uid, setUid] = useState(people[0]?.id || '');
  const [name, setName] = useState('');
  const [due, setDue] = useState(todayIso(7));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const out = file.status === 'out';
  const chips = [['Tomorrow', 1], ['3 days', 3], ['1 week', 7], ['2 weeks', 14], ['1 month', 30]];
  const submit = async (e) => {
    e?.preventDefault();
    if (busy) return;
    if (who === 'other' && !name.trim()) { setErr('Type who is taking the file.'); return; }
    setBusy(true); setErr('');
    try {
      const body = { due_at: due || null, note: note.trim() || null, transfer: out };
      if (who === 'member') body.to_user_id = Number(uid); else body.to_name = name.trim();
      onDone(await fx.paperAct(file.id, 'issue', body), out ? 'handed over' : 'issued');
    } catch (ex) { setErr(ex.message || 'Could not issue the file.'); setBusy(false); }
  };
  return (
    <Modal small title={out ? `Hand over ${file.file_no}` : `Issue ${file.file_no}`} onClose={busy ? () => {} : onClose}
      footer={<><button type="button" className="dh-btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="fx-issueform" className="dh-btn primary" disabled={busy}>{busy ? 'Saving…' : out ? 'Hand over' : 'Issue file'}</button></>}>
      <form id="fx-issueform" onSubmit={submit} className="fx-form">
        {out ? <p className="fx-note">Now with <b>{file.holder}</b>. Handing it over records the move in one step — no need to return it first.</p> : null}
        <div className="fx-seg full" role="group" aria-label="Who is taking it">
          <button type="button" className={who === 'member' ? 'on' : ''} onClick={() => setWho('member')} disabled={!people.length}>Someone in my firm</button>
          <button type="button" className={who === 'other' ? 'on' : ''} onClick={() => setWho('other')}>Someone else</button>
        </div>
        {who === 'member' ? (
          <label className="dh-field"><span className="lab">Who</span>
            <select className="dh-select" value={uid} onChange={(e) => setUid(e.target.value)}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        ) : (
          <label className="dh-field"><span className="lab">Name</span><input className="dh-input" autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Adv. Rao, court clerk, client" /></label>
        )}
        <div className="dh-field"><span className="lab">Due back</span>
          <div className="fx-chiprow">{chips.map(([l, n]) => <button type="button" key={l} className={`dh-chip btn${due === todayIso(n) ? ' on' : ''}`} onClick={() => setDue(todayIso(n))}>{l}</button>)}
            <button type="button" className={`dh-chip btn${!due ? ' on' : ''}`} onClick={() => setDue('')}>No date</button></div>
          <input className="dh-input" type="date" value={due} min={todayIso()} onChange={(e) => setDue(e.target.value)} aria-label="Due back on" style={{ marginTop: 8 }} /></div>
        <label className="dh-field"><span className="lab">Note</span><input className="dh-input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Optional — e.g. for the hearing on 14th" /></label>
        {err ? <p role="alert" className="fx-err">{err}</p> : null}
      </form>
    </Modal>
  );
}

function ReturnModal({ file, locations, onClose, onDone }) {
  const [loc, setLoc] = useState(file.location_id || null);
  const [spot, setSpot] = useState(file.location_note || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true); setErr('');
    try { onDone(await fx.paperAct(file.id, 'return', { location_id: loc, location_note: spot.trim() || null, note: note.trim() || null })); }
    catch (ex) { setErr(ex.message || 'Could not return the file.'); setBusy(false); }
  };
  return (
    <Modal small title={`Return ${file.file_no}`} onClose={busy ? () => {} : onClose}
      footer={<><button type="button" className="dh-btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="fx-retform" className="dh-btn primary" disabled={busy}>{busy ? 'Saving…' : 'Mark as returned'}</button></>}>
      <form id="fx-retform" onSubmit={submit} className="fx-form">
        <p className="fx-note">Back from <b>{file.holder}</b>. Where is it kept now?</p>
        <div className="dh-field"><span className="lab">Shelf</span><ShelfSelect locations={locations} value={loc} onChange={setLoc} placeholder="Choose a shelf" /></div>
        <label className="dh-field"><span className="lab">Exact spot</span><input className="dh-input" value={spot} maxLength={120} onChange={(e) => setSpot(e.target.value)} placeholder="Optional" /></label>
        <label className="dh-field"><span className="lab">Note</span><input className="dh-input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></label>
        {err ? <p role="alert" className="fx-err">{err}</p> : null}
      </form>
    </Modal>
  );
}

function MoveModal({ file, locations, onClose, onDone }) {
  const [loc, setLoc] = useState(file.location_id || null);
  const [spot, setSpot] = useState(file.location_note || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e?.preventDefault();
    if (!loc || busy) { if (!loc) setErr('Choose the shelf it is going to.'); return; }
    setBusy(true); setErr('');
    try { onDone(await fx.paperAct(file.id, 'move', { location_id: loc, location_note: spot.trim() || null })); }
    catch (ex) { setErr(ex.message || 'Could not move the file.'); setBusy(false); }
  };
  return (
    <Modal small title={`Move ${file.file_no}`} onClose={busy ? () => {} : onClose}
      footer={<><button type="button" className="dh-btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="fx-moveform" className="dh-btn primary" disabled={busy}>{busy ? 'Saving…' : 'Move'}</button></>}>
      <form id="fx-moveform" onSubmit={submit} className="fx-form">
        <div className="dh-field"><span className="lab">New shelf</span><ShelfSelect locations={locations} value={loc} onChange={setLoc} placeholder="Choose a shelf" /></div>
        <label className="dh-field"><span className="lab">Exact spot</span><input className="dh-input" value={spot} maxLength={120} onChange={(e) => setSpot(e.target.value)} placeholder="Optional" /></label>
        {err ? <p role="alert" className="fx-err">{err}</p> : null}
      </form>
    </Modal>
  );
}

// ── almirahs, racks and shelves ────────────────────────────────────────────────────────────
function ShelvesModal({ locations, kinds, onClose, onChanged, toast }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('almirah');
  const [parent, setParent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(null);
  const [del, setDel] = useState(null);
  const list = locations.filter((l) => !l.archived);
  const add = async (e) => {
    e?.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true); setErr('');
    try { const r = await fx.locationAdd({ name: name.trim(), kind, parent_id: parent }); onChanged(r.locations); setName(''); toast(`Added “${name.trim()}”`); }
    catch (ex) { setErr(ex.message || 'Could not add it.'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setErr('');
    try { const r = await fx.locationEdit(editing.id, { name: editing.name.trim(), kind: editing.kind, parent_id: editing.parent_id }); onChanged(r.locations); setEditing(null); }
    catch (ex) { setErr(ex.message || 'Could not save.'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { const r = await fx.locationDelete(del.id); onChanged(r.locations); toast(`Removed “${del.name}”`); setDel(null); }
    catch (ex) { toast(ex.message || 'Could not remove it.', { tone: 'bad' }); setDel(null); }
    finally { setBusy(false); }
  };
  return (
    <>
      <Modal title="Almirahs, racks and shelves" onClose={onClose} footer={<button type="button" className="dh-btn primary" onClick={onClose}>Done</button>}>
        <p className="fx-note">Describe where paper files are kept, from the room down to the shelf. A file can then say exactly where it lives — for example <b>Record room › Almirah 3 › Shelf B</b>.</p>
        <form className="fx-addloc" onSubmit={add}>
          <input className="dh-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Almirah 3" aria-label="Name" />
          <select className="dh-select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">{kinds.map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}</select>
          <select className="dh-select" value={parent || ''} onChange={(e) => setParent(e.target.value ? Number(e.target.value) : null)} aria-label="Inside">
            <option value="">Top level</option>
            {list.map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}
          </select>
          <button type="submit" className="dh-btn primary" disabled={!name.trim() || busy}><Icon name="plus" />Add</button>
        </form>
        {err ? <p role="alert" className="fx-err">{err}</p> : null}
        {!list.length ? <div className="fx-pickmsg">Nothing yet. Add your first room, almirah or rack above.</div> : (
          <ul className="fx-locs">
            {list.map((l) => {
              const depth = l.path.split(' › ').length - 1;
              const isEdit = editing?.id === l.id;
              return (
                <li key={l.id} style={{ paddingLeft: depth * 20 }}>
                  {isEdit ? (
                    <div className="edit">
                      <input className="dh-input" value={editing.name} maxLength={60} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Name" />
                      <select className="dh-select" value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value })} aria-label="Kind">{kinds.map((k) => <option key={k} value={k}>{k}</option>)}</select>
                      <button type="button" className="dh-btn primary sm" onClick={save} disabled={busy || !editing.name.trim()}>Save</button>
                      <button type="button" className="dh-btn quiet sm" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <Icon name={depth ? 'folder' : 'cabinet'} />
                      <span className="nm">{l.name}</span><span className="dh-chip">{l.kind}</span>
                      <span className="mut">{l.files ? plural(l.files, 'file') : 'empty'}</span>
                      <span className="sp" />
                      <button type="button" className="dh-ibtn" aria-label={`Rename ${l.name}`} onClick={() => setEditing({ id: l.id, name: l.name, kind: l.kind, parent_id: l.parent_id })}><Icon name="edit" /></button>
                      <button type="button" className="dh-ibtn" aria-label={`Remove ${l.name}`} onClick={() => setDel(l)}><Icon name="trash" /></button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Modal>
      {del ? <Confirm danger title={`Remove “${del.name}”?`} confirmLabel="Remove" busy={busy} onConfirm={remove} onCancel={() => setDel(null)}>Only an empty place with nothing inside can be removed. Files kept here are never deleted.</Confirm> : null}
    </>
  );
}

// ── print labels ───────────────────────────────────────────────────────────────────────────
function LabelsModal({ ids, onClose, toast }) {
  const [layout, setLayout] = useState(() => { try { return localStorage.getItem('fx_label_layout') || 'a4-24'; } catch { return 'a4-24'; } });
  const [cut, setCut] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      try { localStorage.setItem('fx_label_layout', layout); } catch { /* fine */ }
      const blob = await fx.labels(ids, layout, cut);
      openPdf(blob, 'paper-file-labels.pdf');
      onClose();
    } catch (e) { toast(e.message || 'Could not make the labels.', { tone: 'bad' }); setBusy(false); }
  };
  return (
    <Modal small title={`Print ${plural(ids.length, 'label')}`} onClose={busy ? () => {} : onClose}
      footer={<><button type="button" className="dh-btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="dh-btn primary" onClick={go} disabled={busy}><Icon name="printer" />{busy ? 'Making…' : 'Make the PDF'}</button></>}>
      <div className="fx-form">
        <label className="dh-field"><span className="lab">Paper</span>
          <select className="dh-select" value={layout} onChange={(e) => setLayout(e.target.value)}>{LABEL_LAYOUTS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
        {layout !== 'roll' ? <label className="dh-check"><input type="checkbox" checked={cut} onChange={(e) => setCut(e.target.checked)} />Draw faint cut marks (for plain paper)</label> : null}
        <p className="fx-note" style={{ marginTop: 12 }}>Each label carries the file number, name, case and a QR code. Scanning the QR with any phone camera opens that file here. Print at 100% / “actual size”.</p>
      </div>
    </Modal>
  );
}

// ── find a file by scanning its label (or typing its number) ───────────────────────────────
function ScanLabelModal({ onClose, onFound }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [cam, setCam] = useState('idle');       // idle | on | none | denied
  const video = useRef(null);
  const stream = useRef(null);
  const busyRef = useRef(false);
  const live = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

  const find = useCallback(async (value) => {
    const v = (value || '').trim();
    if (!v || busyRef.current) return;
    busyRef.current = true; setBusy(true); setErr('');
    try { const r = await fx.paperLookup(v); onFound(r.file); }
    catch (e) { setErr(e.message || 'No file found.'); busyRef.current = false; setBusy(false); }
  }, [onFound]);

  useEffect(() => {
    if (!live) { setCam('none'); return undefined; }
    let dead = false;
    let timer = null;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (dead) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        const v = video.current;
        if (!v) return;
        v.srcObject = s;
        await v.play().catch(() => {});
        setCam('on');
        const det = new window.BarcodeDetector({ formats: ['qr_code'] });
        const tick = async () => {
          if (dead) return;
          try {
            if (!busyRef.current && v.readyState >= 2) {
              const hits = await det.detect(v);
              if (hits.length) { find(hits[0].rawValue); }
            }
          } catch { /* a frame failed: try the next */ }
          if (!dead) timer = setTimeout(tick, 280);
        };
        tick();
      } catch (e) { if (!dead) setCam(e?.name === 'NotAllowedError' ? 'denied' : 'none'); }
    })();
    return () => { dead = true; if (timer) clearTimeout(timer); stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  }, [live, find]);

  return (
    <Modal small title="Find a file by its label" onClose={onClose}>
      <div className="fx-form">
        {live && cam !== 'none' && cam !== 'denied' ? (
          <div className="fx-cam"><video ref={video} muted playsInline aria-label="Camera view" /><span className="aim" aria-hidden="true" /></div>
        ) : null}
        {cam === 'denied' ? <p className="fx-note">The camera is blocked for this site. Allow it in the browser’s address bar, or type the number below.</p> : null}
        {!live ? <p className="fx-note">This browser cannot read QR codes itself. Point your phone’s camera at the label — it opens the file here — or type the number printed on the label.</p> : null}
        <form onSubmit={(e) => { e.preventDefault(); find(code); }}>
          <label className="dh-field"><span className="lab">Or type the file number</span>
            <span className="fx-inline"><input className="dh-input mono" autoFocus={!live} value={code} onChange={(e) => setCode(e.target.value)} placeholder="PF-0042" aria-label="File number" />
              <button type="submit" className="dh-btn primary" disabled={!code.trim() || busy}>{busy ? '…' : 'Find'}</button></span></label>
        </form>
        {err ? <p role="alert" className="fx-err">{err}</p> : null}
      </div>
    </Modal>
  );
}

// ── one file, in a side panel ──────────────────────────────────────────────────────────────
function FilePanel({ id, locations, people, onClose, onChanged, onOpenDoc, toast, onShelves, onGoCase }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const ref = useRef(null);
  useDialog(ref, () => { if (!modal && !confirm) onClose(); });

  const load = useCallback(() => fx.paperGet(id).then((d) => { setData(d); setErr(''); }).catch((e) => setErr(e.message || 'Could not open this file.')), [id]);
  useEffect(() => { setData(null); load(); }, [load]);

  const f = data?.file;
  const apply = (r, msg) => { setData((d) => ({ ...d, file: r.file })); onChanged(r.stats); if (msg) toast(msg); load(); setModal(null); setConfirm(null); };
  const simple = async (action, msg) => {
    setBusy(true);
    try { apply(await fx.paperAct(id, action, {}), msg); } catch (e) { toast(e.message || 'That did not work.', { tone: 'bad' }); setConfirm(null); } finally { setBusy(false); }
  };
  const label = async () => { try { openPdf(await fx.labelOne(id), `${f.file_no}-label.pdf`); } catch (e) { toast(e.message || 'Could not make the label.', { tone: 'bad' }); } };
  const unlink = async (docId) => { try { const r = await fx.paperUnlink(id, docId); setData((d) => ({ ...d, docs: r.docs })); } catch (e) { toast(e.message, { tone: 'bad' }); } };
  const link = async (ids) => {
    setBusy(true);
    try { const r = await fx.paperLink(id, ids); setData((d) => ({ ...d, docs: r.docs })); toast(`Linked ${plural(r.added, 'document')}`); setModal(null); load(); } catch (e) { toast(e.message, { tone: 'bad' }); } finally { setBusy(false); }
  };
  const chip = f ? statusChip(f) : null;

  return (
    <Portal>
      <div className="dh-scrim" onMouseDown={onClose} />
      <aside className="fx-panel" role="dialog" aria-modal="true" aria-label={f ? `${f.file_no} ${f.title}` : 'Paper file'} ref={ref}>
        <div className="fx-panelhead">
          <div className="t">
            <span className="no mono">{f?.file_no || '…'}</span>
            <h2>{f?.title || (err ? 'Not available' : 'Loading…')}</h2>
          </div>
          <button type="button" className="dh-ibtn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="fx-panelbody">
          {err ? <div className="dh-errbox" role="alert"><Icon name="alert" /><div className="body">{err}</div></div> : null}
          {!f && !err ? <Spinner label="Opening…" /> : null}
          {f ? (
            <>
              <div className={`fx-where ${f.status}${f.overdue ? ' overdue' : ''}`}>
                <span className={`dh-chip ${chip.tone}`}>{chip.text}</span>
                {f.status === 'out' ? (
                  <><div className="big">With {f.holder}</div><div className="sm">since {fmtDay(f.issued_at)}{f.due_at ? ` · due ${fmtDay(f.due_at)} (${dueText(f)})` : ' · no due date'}</div></>
                ) : f.status === 'lost' ? (
                  <><div className="big">Cannot be found</div><div className="sm">Last kept: {f.location || 'unknown'}</div></>
                ) : (
                  <><div className="big">{f.location ? <><Icon name="pin" />{f.location}</> : 'No shelf set'}</div><div className="sm">{f.location_note || (f.location ? '' : 'Choose where it is kept so it can be found.')}</div></>
                )}
              </div>

              <div className="fx-actrow">
                {f.status === 'in' ? <button type="button" className="dh-btn primary" onClick={() => setModal('issue')}><Icon name="handover" />Issue to someone</button> : null}
                {f.status === 'out' ? <button type="button" className="dh-btn primary" onClick={() => setModal('return')}><Icon name="back" />Mark returned</button> : null}
                {f.status === 'out' ? <button type="button" className="dh-btn ghost" onClick={() => setModal('issue')}>Hand over…</button> : null}
                {f.status === 'lost' ? <button type="button" className="dh-btn primary" disabled={busy} onClick={() => simple('found', 'Marked as found')}>Found it</button> : null}
                {f.status === 'archived' ? <button type="button" className="dh-btn primary" disabled={busy} onClick={() => simple('restore', 'Restored to the register')}>Restore</button> : null}
                {(f.status === 'in' || f.status === 'out') ? <button type="button" className="dh-btn ghost" onClick={() => setModal('move')}>Move</button> : null}
                <button type="button" className="dh-btn ghost" onClick={label}><Icon name="qr" />Print label</button>
                <Menu icon="more" label="" chevron={false} right className="dh-ibtn boxed" title="More">
                  {(close) => (
                    <>
                      <button type="button" role="menuitem" onClick={() => { close(); setModal('edit'); }}><Icon name="edit" />Edit details</button>
                      {f.status === 'in' || f.status === 'out' ? <button type="button" role="menuitem" onClick={() => { close(); setConfirm('lost'); }}><Icon name="alert" />Mark as lost</button> : null}
                      {f.status === 'in' ? <button type="button" role="menuitem" onClick={() => { close(); setConfirm('archive'); }}><Icon name="disk" />Archive</button> : null}
                    </>
                  )}
                </Menu>
              </div>

              <dl className="fx-facts">
                {f.case_ref ? <><dt>Case</dt><dd>{f.case_label || f.case_ref} <button type="button" className="fx-link" onClick={() => onGoCase(f.case_ref)}>see its documents</button></dd></> : null}
                {f.client ? <><dt>Client</dt><dd>{f.client}</dd></> : null}
                <dt>Kind</dt><dd>{KIND_NAME[f.kind] || f.kind}{f.pages_est ? ` · about ${fmtNum(f.pages_est)} pages` : ''}</dd>
                {f.notes ? <><dt>Notes</dt><dd>{f.notes}</dd></> : null}
                <dt>Label code</dt><dd className="mono">{f.file_no}</dd>
              </dl>

              <h3 className="fx-h3">Scanned copies <span className="ct">{data.docs.length}</span></h3>
              {data.docs.length ? (
                <ul className="fx-linked">
                  {data.docs.map((d) => (
                    <li key={d.id}><button type="button" className="nm" onClick={() => onOpenDoc(d.id)}><Icon name="doc" />{d.title}</button>
                      <span className="mut">{d.page_count ? plural(d.page_count, 'page') : ''}</span>
                      <button type="button" className="dh-ibtn" aria-label={`Unlink ${d.title}`} title="Unlink" onClick={() => unlink(d.id)}><Icon name="close" size={13} /></button></li>
                  ))}
                </ul>
              ) : <p className="fx-note">No scanned copy is linked yet. Scan this file in <b>Scan &amp; file</b> and choose it as the paper file, or link documents you already have.</p>}
              <button type="button" className="dh-btn ghost sm" onClick={() => setModal('link')}><Icon name="link" />Link existing documents</button>

              <h3 className="fx-h3">History</h3>
              <ol className="fx-hist">
                {data.history.map((m) => { const l = historyLine(m); return (
                  <li key={m.id}><span className="dot" /><div><b>{l.head}</b>{l.detail ? <span> · {l.detail}</span> : null}{l.note ? <div className="n">{l.note}</div> : null}
                    <div className="w">{m.actor_name || 'Someone'} · {fmtAgo(m.at)}</div></div></li>
                ); })}
              </ol>
            </>
          ) : null}
        </div>
      </aside>

      {modal === 'issue' && f ? <IssueModal file={f} people={people} onClose={() => setModal(null)} onDone={(r, what) => apply(r, `${f.file_no} ${what}`)} /> : null}
      {modal === 'return' && f ? <ReturnModal file={f} locations={locations} onClose={() => setModal(null)} onDone={(r) => apply(r, `${f.file_no} returned`)} /> : null}
      {modal === 'move' && f ? <MoveModal file={f} locations={locations} onClose={() => setModal(null)} onDone={(r) => apply(r, 'Moved')} /> : null}
      {modal === 'edit' && f ? <FileModal file={f} locations={locations} onShelves={onShelves} onClose={() => setModal(null)} onSaved={(file) => { setData((d) => ({ ...d, file })); setModal(null); onChanged(); toast('Saved'); load(); }} /> : null}
      {modal === 'link' && f ? <DocPickerModal title="Link scanned documents" confirmLabel="Link" caseRef={f.case_ref} exclude={data.docs.map((d) => d.id)} busy={busy} onClose={() => setModal(null)} onConfirm={link} /> : null}
      {confirm === 'lost' ? <Confirm danger title="Mark this file as lost?" confirmLabel="Mark as lost" busy={busy} onConfirm={() => simple('lost', 'Marked as lost')} onCancel={() => setConfirm(null)}>It stays in the register with its history and shows in the “Lost” list until it is found.</Confirm> : null}
      {confirm === 'archive' ? <Confirm title="Archive this file?" confirmLabel="Archive" busy={busy} onConfirm={() => simple('archive', 'Archived')} onCancel={() => setConfirm(null)}>Archived files leave the everyday list. You can restore one at any time.</Confirm> : null}
    </Portal>
  );
}

// ── the tab ────────────────────────────────────────────────────────────────────────────────
export function PaperFiles({ toast, onOpenDoc, onGoCase, caseRef, caseLabel, openToken, onTokenHandled, onStats }) {
  const [sum, setSum] = useState(null);
  const [locs, setLocs] = useState([]);
  const [kinds, setKinds] = useState(['room', 'almirah', 'rack', 'shelf', 'box', 'drawer', 'other']);
  const [status, setStatus] = useState('active');
  const [qIn, setQIn] = useState('');
  const q = useDebounced(qIn, 280);
  const [shelf, setShelf] = useState(null);
  const [holder, setHolder] = useState('');
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(() => new Set());
  const [openId, setOpenId] = useState(null);
  const [modal, setModal] = useState(null);
  const [tick, setTick] = useState(0);
  const req = useRef(0);

  const refreshSummary = useCallback(() => fx.paperSummary().then((s) => { setSum(s); setLocs(s.locations); onStats?.(s.stats); }).catch(() => {}), [onStats]);
  useEffect(() => { refreshSummary(); fx.locations().then((r) => setKinds(r.kinds)).catch(() => {}); }, [refreshSummary]);

  const params = useMemo(() => ({
    status: status === 'overdue' ? 'out' : status, overdue: status === 'overdue' ? 1 : undefined, q: q.trim() || undefined, location_id: shelf || undefined,
    holder: holder || undefined, sort, page, per_page: PER, case_ref: caseRef || undefined,
  }), [status, q, shelf, holder, sort, page, caseRef]);
  const sig = JSON.stringify([status, q, shelf, holder, sort, caseRef]);
  useEffect(() => { setPage(1); setSel(new Set()); }, [sig]);

  useEffect(() => {
    const id = (req.current += 1);
    const ctrl = new AbortController();
    fx.paperList(params, ctrl.signal).then((r) => {
      if (id !== req.current) return;
      if (!r.files.length && r.total > 0 && page > 1) { setPage(Math.ceil(r.total / PER)); return; }
      setData(r); setErr('');
    }).catch((e) => { if (e?.name === 'AbortError' || id !== req.current) return; setErr(e.message || 'Could not load the register.'); });
    return () => ctrl.abort();
  }, [params, page, tick]);

  // a scanned QR label opens the app at ?pf=<token>
  useEffect(() => {
    if (!openToken) return;
    fx.paperLookup(openToken).then((r) => setOpenId(r.file.id)).catch((e) => toast(e.message || 'That label is not in your register.', { tone: 'bad' })).finally(() => onTokenHandled?.());
  }, [openToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = useCallback((stats) => { setTick((t) => t + 1); if (stats) { setSum((s) => (s ? { ...s, stats } : s)); onStats?.(stats); } refreshSummary(); }, [refreshSummary, onStats]);
  const stats = sum?.stats;
  const files = data?.files;
  const allOn = !!files?.length && files.every((f) => sel.has(f.id));
  const toggleAll = () => setSel((s) => { const n = new Set(s); if (allOn) files.forEach((f) => n.delete(f.id)); else files.forEach((f) => n.add(f.id)); return n; });
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const noShelves = sum && !locs.length;
  const filtered = !!(q.trim() || shelf || holder || status !== 'active' || caseRef);

  const tile = (id, n, label, sub, tone) => (
    <button type="button" className={`dh-stat${tone ? ` ${tone}` : ''}${status === id ? ' on' : ''}`} onClick={() => setStatus(status === id ? 'active' : id)} aria-pressed={status === id}>
      <span className="n">{stats ? fmtNum(n) : '—'}</span><span className="l">{label}</span><span className="sub">{sub}</span>
    </button>
  );

  return (
    <section className="fx-section" aria-label="Paper files">
      <div className="fx-intro">
        <div>
          <h2 className="fx-h">Know where every physical file is</h2>
          <p className="fx-lead">Give each paper file a number and a label. See what is on which shelf, who has taken what, and what is overdue — and find any file by scanning its QR label.</p>
        </div>
        <div className="fx-introacts">
          <button type="button" className="dh-btn ghost" onClick={() => setModal('scan')}><Icon name="qr" />Find by label</button>
          <button type="button" className="dh-btn ghost" onClick={() => setModal('shelves')}><Icon name="cabinet" />Shelves</button>
          <button type="button" className="dh-btn primary" onClick={() => setModal('new')}><Icon name="plus" />Add a file</button>
        </div>
      </div>

      <div className="fx-tiles">
        {tile('in', stats?.in || 0, 'On the shelf', 'in their place')}
        {tile('out', stats?.out || 0, 'Out', stats?.due_soon ? `${stats.due_soon} due within 3 days` : 'with someone', stats?.out ? 'warn' : '')}
        {tile('overdue', stats?.overdue || 0, 'Overdue', 'past the due date', stats?.overdue ? 'bad' : '')}
        {tile('lost', stats?.lost || 0, 'Lost', 'cannot be found', stats?.lost ? 'bad' : '')}
      </div>

      {sum?.overdue?.length && status === 'active' && !caseRef ? (
        <div className="dh-banner rust" role="alert"><Icon name="clock" /><div className="body"><b>{plural(stats.overdue, 'file')} {stats.overdue === 1 ? 'is' : 'are'} overdue.</b>{' '}
          {sum.overdue.slice(0, 3).map((f) => `${f.file_no} with ${f.holder}`).join(' · ')}{sum.overdue.length > 3 ? ' …' : ''}. The register shows who to ask — it does not send reminders by itself.</div>
          <button type="button" className="dh-btn ghost sm" onClick={() => setStatus('overdue')}>Show them</button></div>
      ) : null}
      {noShelves ? (
        <div className="dh-banner plain"><Icon name="cabinet" /><div className="body"><b>Set up your shelves first.</b> Add your record room, almirahs and racks once, and every file can say exactly where it is kept.</div>
          <button type="button" className="dh-btn ghost sm" onClick={() => setModal('shelves')}>Add shelves</button></div>
      ) : null}
      {caseRef ? <div className="dh-banner plain"><Icon name="briefcase" /><div className="body">Showing the paper files of <b>{caseLabel || 'one case'}</b>.</div><button type="button" className="dh-btn quiet sm" onClick={() => onGoCase(null)}>Show all</button></div> : null}

      <div className="fx-toolbar">
        <div className="fx-picksearch wide"><Icon name="search" /><input value={qIn} onChange={(e) => setQIn(e.target.value)} placeholder="Search by number, name, client, case, holder or shelf…" aria-label="Search paper files" /></div>
        <ShelfSelect locations={locs} value={shelf} onChange={setShelf} placeholder="Any shelf" id="fx-shelf" />
        <select className="dh-select" value={holder} onChange={(e) => setHolder(e.target.value)} aria-label="Held by"><option value="">Anyone holding</option>{(sum?.holders || []).map((h) => <option key={h.holder} value={h.holder}>{h.holder} ({h.n})</option>)}</select>
        <select className="dh-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by"><option value="recent">Recently changed</option><option value="number">File number</option><option value="name">Name</option><option value="due">Due date</option></select>
      </div>

      <div className="fx-statusbar" role="tablist" aria-label="Show">
        {STATUS_TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={status === t.id} className={`fx-subtab${status === t.id ? ' on' : ''}`} onClick={() => setStatus(t.id)}>{t.label}</button>)}
        <span className="sp" />
        {sel.size ? <button type="button" className="dh-btn primary sm" onClick={() => setModal('labels')}><Icon name="printer" />Print {plural(sel.size, 'label')}</button> : (
          <Menu icon="more" label="" chevron={false} right className="dh-btn ghost sm" title="More">
            {(close) => (
              <>
                <button type="button" role="menuitem" disabled={!files?.length} onClick={() => { close(); setSel(new Set(files.map((f) => f.id))); setModal('labels'); }}><Icon name="printer" />Print labels for this page</button>
                <button type="button" role="menuitem" onClick={() => { close(); fx.paperCsv({ status: params.status, overdue: params.overdue, q: params.q, location_id: params.location_id, holder: params.holder }).catch((e) => toast(e.message, { tone: 'bad' })); }}><Icon name="download" />Download as a spreadsheet</button>
              </>
            )}
          </Menu>
        )}
      </div>

      {err ? <div className="dh-errbox" role="alert"><Icon name="alert" /><div className="body">{err}</div><button type="button" className="dh-btn ghost sm" onClick={() => setTick((t) => t + 1)}>Try again</button></div> : null}
      {!files && !err ? <div className="fx-skel" aria-busy="true">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="dh-skel" style={{ animationDelay: `${i * 70}ms` }}><i /></div>)}</div> : null}
      {files && !files.length ? (
        filtered ? <EmptyState icon="search" title="No file matches" actions={<button type="button" className="dh-btn ghost" onClick={() => { setQIn(''); setShelf(null); setHolder(''); setStatus('active'); }}>Clear search and filters</button>}>Try a shorter search, or choose another shelf or status.</EmptyState>
          : <EmptyState icon="cabinet" title="No paper files yet" actions={<button type="button" className="dh-btn primary" onClick={() => setModal('new')}><Icon name="plus" />Add the first file</button>}>Add each physical file once. It gets a number like PF-0001 and a printable QR label to stick on the cover.</EmptyState>
      ) : null}
      {files && files.length ? (
        <div className="fx-plist" role="table" aria-label="Paper files">
          <div className="fx-prow head" role="row"><span className="cbx"><input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Select all on this page" /></span><span>File</span><span className="hide-s">Kept / held by</span><span /></div>
          {files.map((f) => {
            const c = statusChip(f);
            return (
              <div key={f.id} role="row" className={`fx-prow${sel.has(f.id) ? ' sel' : ''}${f.overdue ? ' late' : ''}`}>
                <span className="cbx"><input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id)} aria-label={`Select ${f.file_no}`} /></span>
                <button type="button" className="main" onClick={() => setOpenId(f.id)} aria-label={`Open ${f.file_no} ${f.title}`}>
                  <span className="no mono">{f.file_no}</span>
                  <span className="ttl">{f.title}</span>
                  <span className="sub">{[KIND_NAME[f.kind] !== 'File' ? KIND_NAME[f.kind] : null, f.case_label && f.case_label !== f.title ? f.case_label : null, f.client].filter(Boolean).join(' · ')}</span>
                </button>
                <span className="where hide-s">
                  <span className={`dh-chip ${c.tone}`}>{c.text}</span>
                  <span className="txt">{f.status === 'out' ? <>With <b>{f.holder}</b>{f.due_at ? <> · <span className={f.overdue ? 'late' : ''}>{dueText(f)}</span></> : null}</> : f.location ? <><Icon name="pin" />{f.location}</> : <span className="mut">No shelf set</span>}</span>
                </span>
                <span className="acts">
                  {f.status === 'in' ? <button type="button" className="dh-btn ghost sm" onClick={() => setOpenId(f.id)} title="Open to issue it">Issue</button> : null}
                  {f.status === 'out' ? <button type="button" className="dh-btn ghost sm" onClick={() => setOpenId(f.id)} title="Open to mark it returned">Return</button> : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      <Pager page={page} perPage={PER} total={data?.total || 0} onPage={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />

      {openId ? <FilePanel id={openId} locations={locs} people={sum?.people || []} onClose={() => setOpenId(null)} onChanged={changed} onOpenDoc={onOpenDoc} toast={toast} onShelves={() => setModal('shelves')} onGoCase={(r) => { setOpenId(null); onGoCase(r); }} /> : null}
      {modal === 'new' ? <FileModal locations={locs} caseRef={caseRef} caseLabel={caseLabel} onShelves={() => setModal('shelves')} onClose={() => setModal(null)}
        onSaved={(file) => { setModal(null); changed(); toast(`${file.file_no} added`, { action: { label: 'Print label', run: () => fx.labelOne(file.id).then((b) => openPdf(b, `${file.file_no}-label.pdf`)).catch((e) => toast(e.message, { tone: 'bad' })) } }); setOpenId(file.id); }} /> : null}
      {modal === 'shelves' ? <ShelvesModal locations={locs} kinds={kinds} toast={toast} onClose={() => setModal(null)} onChanged={(l) => { setLocs(l); refreshSummary(); }} /> : null}
      {modal === 'labels' ? <LabelsModal ids={[...sel]} toast={toast} onClose={() => setModal(null)} /> : null}
      {modal === 'scan' ? <ScanLabelModal onClose={() => setModal(null)} onFound={(f) => { setModal(null); setOpenId(f.id); }} /> : null}
    </section>
  );
}
