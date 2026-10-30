import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';
import { getIdentity } from './identity.js';

// One shared Yjs document per docId.
//  - IndexeddbPersistence  -> local autosave that survives reloads (works fully offline)
//  - WebrtcProvider        -> realtime co-editing: BroadcastChannel across tabs of the same
//                             browser (always on), WebRTC peer-to-peer across devices via
//                             public signaling (no server of ours to host).
// Returns a stable handle; the TipTap Collaboration extension binds to ydoc + provider.awareness.

// No public signaling servers (they're unreliable and flood the console). Presence then works
// across tabs of the same browser via y-webrtc's BroadcastChannel. Cross-device presence would
// need a signaling server, which the client-side demo deliberately doesn't host.
const SIGNALING = [];

export function useCollabDoc(docId) {
  const ref = useRef(null);
  const [synced, setSynced] = useState(false);
  const [peers, setPeers] = useState([]); // [{ id, name, color }]

  if (!ref.current || ref.current.docId !== docId) {
    // Tear down a previous doc if the id changed.
    if (ref.current) {
      try { ref.current.provider.destroy(); } catch { /* ignore */ }
      try { ref.current.idb.destroy(); } catch { /* ignore */ }
      try { ref.current.ydoc.destroy(); } catch { /* ignore */ }
    }
    const ydoc = new Y.Doc();
    const room = 'lx-doc-' + docId;
    const idb = new IndexeddbPersistence(room, ydoc);
    const provider = new WebrtcProvider(room, ydoc, { signaling: SIGNALING });
    const me = getIdentity();
    provider.awareness.setLocalStateField('user', { name: me.name, color: me.color, id: me.id });
    ref.current = { docId, ydoc, provider, idb };
  }

  useEffect(() => {
    const handle = ref.current;
    if (!handle) return undefined;

    let alive = true;
    handle.idb.whenSynced.then(() => { if (alive) setSynced(true); });
    // If IndexedDB is blocked (private mode), don't hang the editor.
    const fallback = setTimeout(() => { if (alive) setSynced(true); }, 1500);

    const readPeers = () => {
      const states = Array.from(handle.provider.awareness.getStates().values());
      const list = states.map((s) => s.user).filter(Boolean);
      setPeers(list);
    };
    handle.provider.awareness.on('change', readPeers);
    readPeers();

    return () => {
      alive = false;
      clearTimeout(fallback);
      handle.provider.awareness.off('change', readPeers);
    };
  }, [docId]);

  // Full teardown on unmount.
  useEffect(() => () => {
    const h = ref.current;
    if (!h) return;
    try { h.provider.destroy(); } catch { /* ignore */ }
    try { h.idb.destroy(); } catch { /* ignore */ }
    try { h.ydoc.destroy(); } catch { /* ignore */ }
    ref.current = null;
  }, []);

  return { ydoc: ref.current.ydoc, provider: ref.current.provider, synced, peers };
}
