import { useEffect } from 'react';
import { useOrganizationStore } from '../stores/useOrganizationStore';

export default function WorkspaceGuard({ children }) {
  const setHydratedData = useOrganizationStore((state) => state.setHydratedData);
  const isHydrating = useOrganizationStore((state) => state.isHydrating);

  useEffect(() => {
    const loadWorkspace = async () => {
      const token = localStorage.getItem('authToken');
      if (token) {
        // Future: const data = await fetchUserWorkspace(token);
        // setHydratedData(data);
      }
    };
    loadWorkspace();
  }, [setHydratedData]);

  if (isHydrating) return <div className="p-8 text-[var(--muted)]">Loading secure workspace...</div>;
  return children;
}
