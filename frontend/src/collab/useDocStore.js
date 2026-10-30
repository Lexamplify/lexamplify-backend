import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getIdentity } from './identity.js';

// Client-side document registry: metadata, members, roles, sharing.
// The actual document BODY lives in the Yjs doc (y-indexeddb), keyed by the same id.
// Roles: 'owner' | 'editor' | 'commenter' | 'viewer'.

export const ROLE_LABEL = { owner: 'Owner', editor: 'Can edit', commenter: 'Can comment', viewer: 'Can view' };
export const ROLE_ORDER = ['owner', 'editor', 'commenter', 'viewer'];

function newId() { return 'doc_' + Math.random().toString(36).slice(2, 10); }

// A few collaborators to make the share panel feel real in the demo.
const DIRECTORY = [
  { email: 'priya@chambers.in', name: 'Priya Counsel' },
  { email: 'rohan@chambers.in', name: 'Rohan Associate' },
  { email: 'meera@chambers.in', name: 'Meera Paralegal' },
  { email: 'client@mehta-industries.in', name: 'Mehta Industries' },
];

export const useDocStore = create(
  persist(
    (set, get) => ({
      docs: {}, // id -> { id, title, matter, type, createdAt, updatedAt, ownerId, members:[], linkRole, seedHtml }

      createDoc: ({ title, matter, type, seedHtml } = {}) => {
        const me = getIdentity();
        const id = newId();
        const doc = {
          id,
          title: title || 'Untitled draft',
          matter: matter || '',
          type: type || 'Document',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          ownerId: me.id,
          members: [{ id: me.id, name: me.name, email: 'you@chambers.in', role: 'owner' }],
          linkRole: 'viewer', // anyone with the link
          seedHtml: seedHtml || '',
        };
        set((s) => ({ docs: { ...s.docs, [id]: doc } }));
        return id;
      },

      getDoc: (id) => get().docs[id],

      touch: (id, patch = {}) =>
        set((s) => (s.docs[id] ? { docs: { ...s.docs, [id]: { ...s.docs[id], ...patch, updatedAt: Date.now() } } } : s)),

      rename: (id, title) => get().touch(id, { title }),

      addMember: (id, { email, name, role = 'viewer' }) =>
        set((s) => {
          const d = s.docs[id];
          if (!d) return s;
          if (d.members.some((m) => m.email === email)) return s;
          const mem = { id: 'u_' + Math.random().toString(36).slice(2, 8), email, name: name || email.split('@')[0], role };
          return { docs: { ...s.docs, [id]: { ...d, members: [...d.members, mem], updatedAt: Date.now() } } };
        }),

      setMemberRole: (id, memberId, role) =>
        set((s) => {
          const d = s.docs[id];
          if (!d) return s;
          return { docs: { ...s.docs, [id]: { ...d, members: d.members.map((m) => (m.id === memberId ? { ...m, role } : m)) } } };
        }),

      removeMember: (id, memberId) =>
        set((s) => {
          const d = s.docs[id];
          if (!d) return s;
          return { docs: { ...s.docs, [id]: { ...d, members: d.members.filter((m) => m.id !== memberId) } } };
        }),

      setLinkRole: (id, linkRole) => get().touch(id, { linkRole }),

      myRole: (id) => {
        const d = get().docs[id];
        if (!d) return 'viewer';
        const me = getIdentity();
        const mem = d.members.find((m) => m.id === me.id);
        return mem ? mem.role : d.linkRole; // visitors via link get the link role
      },

      directory: () => DIRECTORY,
    }),
    { name: 'lx-docs-v1' }
  )
);

// Capability helpers derived from a role.
export const can = {
  edit: (role) => role === 'owner' || role === 'editor',
  comment: (role) => role === 'owner' || role === 'editor' || role === 'commenter',
  manage: (role) => role === 'owner',
};
