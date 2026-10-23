// Pass-through wrapper for the organisation workspace routes.
//
// Earlier this read a legacy `authToken` from localStorage and gated on store fields
// (`isHydrating` / `setHydratedData`) that no longer exist — so it was already a no-op.
// Authentication is enforced by the cookie-based `Layout` guard in AppRouter (AuthContext),
// and workspace data is loaded by `hooks/useOrganization.js`. Nothing to guard here.
export default function WorkspaceGuard({ children }) {
  return children;
}
