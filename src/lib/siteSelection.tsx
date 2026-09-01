import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { activeSite, loadStore, saveActiveSiteId, type SettingsStore, type SiteConfig } from './settings';

type SiteSelection = {
  sites: SiteConfig[];
  selectedSite: SiteConfig | null;
  selectSite: (id: string) => void;
};

const SiteSelectionContext = createContext<SiteSelection | null>(null);

export function SiteSelectionProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [store, setStore] = useState<SettingsStore>(loadStore);

  useEffect(() => {
    setStore(loadStore());
  }, [pathname]);

  const selectSite = useCallback((id: string) => {
    saveActiveSiteId(id);
    setStore((current) => ({ ...current, activeSiteId: id }));
  }, []);

  return (
    <SiteSelectionContext.Provider value={{ sites: store.sites, selectedSite: activeSite(store), selectSite }}>
      {children}
    </SiteSelectionContext.Provider>
  );
}

export function useSiteSelection(): SiteSelection {
  const selection = useContext(SiteSelectionContext);
  if (selection === null) {
    throw new Error('useSiteSelection must be used inside SiteSelectionProvider');
  }
  return selection;
}
