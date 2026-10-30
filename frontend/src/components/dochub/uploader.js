// The upload engine. It is a small store that lives outside React, so a big import keeps going if the
// person navigates to another screen, and any component can show its progress.
//
//  - 4 files at a time, each with up to 3 retries on network trouble / 5xx / 429 (files are never lost quietly)
//  - checks size and file type BEFORE sending, so a 400 MB video does not waste a slot
//  - duplicates are reported, not silently dropped ("Add anyway" re-sends with force)
//  - after the last file is sent it keeps watching the server-side batch until every file has been read
import { ApiError, dh } from './api.js';

const CONCURRENCY = 4;
const RETRY_DELAYS = [1500, 5000, 12000];
const JUNK_NAME = /^(?:\.ds_store|thumbs\.db|desktop\.ini|\.localized)$|^~\$|\.(?:tmp|crdownload|part|swp)$|^\._/i;

const listeners = new Set();
const activity = new Set();
let items = [];
let pending = [];
let head = 0;
let running = 0;
let paused = false;
let batchId = null;
let opts = { folderId: null, matterId: null };
let limits = { maxBytes: 200 * 1024 * 1024, blocked: new Set() };
let batchInfo = null;
let skippedJunk = 0;
let startedAt = 0;
let finishedAt = 0;
let bytesDone = 0;
let bytesTotal = 0;
let pollTimer = null;
let emitTimer = null;
let snap = null;
let watching = false;
let rateUntil = 0;
let idSeq = 0;
snap = build();

function counts() {
  const c = { queued: 0, sending: 0, stored: 0, dup: 0, failed: 0, skipped: 0 };
  for (const it of items) c[it.status === 'retry' ? 'queued' : it.status] += 1;
  return c;
}

function build() {
  const c = counts();
  const active = c.queued + c.sending;
  return {
    items, counts: c, total: items.length, active, paused, batchId, opts,
    busy: active > 0, batchInfo, skippedJunk, startedAt, finishedAt, bytesDone, bytesTotal,
    // "done" = every file has reached a final state on our side
    sent: active === 0 && items.length > 0,
    reading: !!batchInfo && batchInfo.working > 0,
    version: (snap?.version || 0) + 1,
  };
}

function emit(now = false) {
  const go = () => {
    emitTimer = null;
    snap = build();
    listeners.forEach((fn) => fn());
  };
  if (now) { if (emitTimer) clearTimeout(emitTimer); go(); return; }
  if (!emitTimer) emitTimer = setTimeout(go, 120);   // a 5,000-file import must not re-render 5,000 times
}

function fireActivity(kind) {
  activity.forEach((fn) => { try { fn(kind); } catch { /* listener bug must not stop uploads */ } });
}

const guard = (e) => { e.preventDefault(); e.returnValue = ''; };
function syncGuard() {
  if (typeof window === 'undefined') return;
  window.removeEventListener('beforeunload', guard);
  if (snap.active > 0 && !paused) window.addEventListener('beforeunload', guard);
}

export const uploader = {
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  getSnapshot() { return snap; },
  onActivity(fn) { activity.add(fn); return () => activity.delete(fn); },

  configure(cfg) {
    if (!cfg) return;
    limits = {
      maxBytes: (cfg.max_file_mb || 200) * 1024 * 1024,
      blocked: new Set((cfg.blocked_ext || []).map((e) => String(e).replace(/^\./, '').toLowerCase())),
    };
  },

  setDestination(o) { opts = { ...opts, ...o }; emit(true); },

  // files: [{file, rel}]; returns {added, skipped, rejected}
  add(files, dest) {
    if (dest) opts = { ...opts, ...dest };
    if (!files.length) return { added: 0, skipped: 0, rejected: 0 };
    if (snap.sent && !snap.reading) this.reset();            // a fresh import after a finished one
    if (!batchId) { batchId = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; startedAt = Date.now(); finishedAt = 0; }
    let added = 0; let skipped = 0; let rejected = 0;
    for (const f of files) {
      const file = f.file;
      const name = file.name || 'file';
      if (JUNK_NAME.test(name)) { skipped += 1; skippedJunk += 1; continue; }
      const ext = (name.split('.').pop() || '').toLowerCase();
      const it = { id: ++idSeq, file, name, rel: f.rel || '', size: file.size || 0, status: 'queued', msg: '', docId: null, tries: 0, force: false, existing: null };
      if (!it.size) { it.status = 'skipped'; it.msg = 'Empty file'; rejected += 1; }
      else if (name.includes('.') && limits.blocked.has(ext)) { it.status = 'failed'; it.msg = `.${ext} files are not accepted`; it.file = null; rejected += 1; }
      else if (it.size > limits.maxBytes) { it.status = 'failed'; it.msg = `Larger than ${Math.round(limits.maxBytes / 1048576)} MB`; it.file = null; rejected += 1; }
      else { pending.push(it); bytesTotal += it.size; added += 1; }
      items.push(it);
    }
    emit(true);
    syncGuard();
    this.pump();
    return { added, skipped, rejected };
  },

  pump() {
    if (paused) return;
    while (running < CONCURRENCY && head < pending.length) {
      const it = pending[head];
      head += 1;
      if (head > 2000 && head * 2 > pending.length) { pending = pending.slice(head); head = 0; }
      if (it.status !== 'queued' && it.status !== 'retry') continue;
      running += 1;
      send(it).finally(() => { running -= 1; this.pump(); });
    }
    if (running === 0 && head >= pending.length) settle();
  },

  pause() { paused = true; emit(true); syncGuard(); },
  resume() { paused = false; emit(true); syncGuard(); this.pump(); },

  retry(id) {
    const it = items.find((x) => x.id === id);
    if (!it || !it.file) return;
    it.status = 'queued'; it.msg = ''; it.tries = 0;
    pending.push(it);
    emit(true); syncGuard(); this.pump();
  },
  retryFailed() {
    let n = 0;
    for (const it of items) {
      if (it.status === 'failed' && it.file && it.retryable !== false) { it.status = 'queued'; it.msg = ''; it.tries = 0; pending.push(it); n += 1; }
    }
    if (n) { emit(true); syncGuard(); this.pump(); }
    return n;
  },
  addAnyway(id) {
    const it = items.find((x) => x.id === id);
    if (!it || !it.file) return;
    it.force = true; it.status = 'queued'; it.msg = ''; it.tries = 0;
    pending.push(it);
    emit(true); syncGuard(); this.pump();
  },
  addAllDuplicatesAnyway() {
    let n = 0;
    for (const it of items) if (it.status === 'dup' && it.file) { it.force = true; it.status = 'queued'; pending.push(it); n += 1; }
    if (n) { emit(true); syncGuard(); this.pump(); }
    return n;
  },
  cancelQueued() {
    for (const it of items) if (it.status === 'queued' || it.status === 'retry') { it.status = 'skipped'; it.msg = 'Cancelled'; it.file = null; }
    pending = []; head = 0;
    emit(true); syncGuard(); settle();
  },
  reset() {
    if (snap.active > 0) return;
    items = []; pending = []; head = 0; batchId = null; batchInfo = null; skippedJunk = 0;
    bytesDone = 0; bytesTotal = 0; startedAt = 0; finishedAt = 0; paused = false;
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    watching = false;
    emit(true); syncGuard();
  },
};

function fail(it, e) {
  it.status = 'failed';
  it.msg = e.message || 'Upload failed';
  it.retryable = !(e instanceof ApiError) || e.status === 0 || e.status >= 500 || e.status === 429 || e.status === 401;
}

async function send(it) {
  it.status = 'sending';
  emit();
  while (true) {
    if (paused) { it.status = 'queued'; pending.push(it); emit(); return; }
    const wait = rateUntil - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      const r = await dh.upload(it.file, { folderId: opts.folderId, matterId: opts.matterId, batchId, relPath: it.rel, force: it.force });
      if (r.duplicate) {
        it.status = 'dup';
        it.existing = r.existing || null;
        it.msg = r.in_trash ? 'Already in the trash' : 'Already in your library';
      } else {
        it.status = 'stored';
        it.docId = r.doc?.id ?? null;
        it.msg = '';
        bytesDone += it.size;
        it.file = null;                       // let the browser release the file handle
      }
      it.force = false;
      emit();
      fireActivity('stored');
      watchBatch();
      return;
    } catch (e) {
      const transient = e instanceof ApiError && (e.status === 0 || e.status >= 500 || e.status === 429);
      if (e?.name === 'AbortError') { fail(it, e); emit(); return; }
      if (e instanceof ApiError && e.status === 401) {
        // the patched fetch already tried a silent refresh; pause so nothing is lost while they sign in again
        paused = true;
        it.status = 'queued'; pending.push(it);
        it.msg = 'Waiting for you to sign in again';
        emit(true); syncGuard();
        return;
      }
      if (transient && it.tries < RETRY_DELAYS.length) {
        const delay = RETRY_DELAYS[it.tries];
        it.tries += 1;
        it.status = 'retry';
        it.msg = `Retrying (${it.tries}/${RETRY_DELAYS.length})…`;
        if (e.status === 429) rateUntil = Date.now() + 6000;
        emit();
        await new Promise((r) => setTimeout(r, delay));
        it.status = 'sending';
        continue;
      }
      fail(it, e);
      emit();
      return;
    }
  }
}

function settle() {
  emit(true);                                   // rebuild the snapshot first: the throttled one may still say "1 active"
  if (snap.active === 0 && items.length && !finishedAt) { finishedAt = Date.now(); emit(true); }
  syncGuard();
  if (batchId && items.some((x) => x.status === 'stored')) watchBatch();
}

function watchBatch() {
  if (watching) return;
  watching = true;
  const tick = async () => {
    pollTimer = null;
    if (!batchId) { watching = false; return; }
    try {
      batchInfo = await dh.batch(batchId);
    } catch { /* keep the last numbers; try again */ }
    emit(true);
    fireActivity('batch');
    const stillGoing = (batchInfo?.working || 0) > 0 || snap.active > 0;
    if (stillGoing && Date.now() - startedAt < 6 * 3600 * 1000) pollTimer = setTimeout(tick, snap.active > 0 ? 4000 : 2500);
    else watching = false;
  };
  pollTimer = setTimeout(tick, 800);
}

// ── getting files out of a drop or a picker ───────────────────────────────────────────
const readAll = (reader) => new Promise((resolve, reject) => {
  const out = [];
  const next = () => reader.readEntries((batch) => {
    if (!batch.length) resolve(out); else { out.push(...batch); next(); }
  }, reject);
  next();
});

async function walk(entry, prefix, out, progress) {
  if (entry.isFile) {
    await new Promise((resolve) => entry.file((file) => { out.push({ file, rel: prefix + entry.name }); progress?.(out.length); resolve(); }, resolve));
  } else if (entry.isDirectory) {
    let kids = [];
    try { kids = await readAll(entry.createReader()); } catch { /* unreadable folder: skip it */ }
    for (const k of kids) await walk(k, `${prefix}${entry.name}/`, out, progress);
  }
}

// Must be called synchronously inside the drop handler (the browser invalidates the items afterwards).
export function grabDrop(dt) {
  const entries = [];
  const plain = [];
  if (dt.items && dt.items.length) {
    for (const it of dt.items) {
      if (it.kind !== 'file') continue;
      const en = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
      if (en) entries.push(en); else { const f = it.getAsFile(); if (f) plain.push({ file: f, rel: '' }); }
    }
  } else {
    for (const f of dt.files || []) plain.push({ file: f, rel: '' });
  }
  return async (progress) => {
    const out = [...plain];
    for (const en of entries) await walk(en, '', out, progress);
    return out;
  };
}

export function fromInput(fileList) {
  return [...fileList].map((file) => ({ file, rel: file.webkitRelativePath || '' }));
}
