import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type PanelId = 'inbox' | 'workspace' | 'inspector';

interface LayoutState {
  isLayoutMode: boolean;
  panelOrder: PanelId[];
  panelVisibility: Record<PanelId, boolean>;
}

interface LayoutContextType extends LayoutState {
  toggleLayoutMode: () => void;
  setPanelOrder: (order: PanelId[]) => void;
  setLayoutMode: (val: boolean) => void;
  togglePanel: (id: PanelId) => void;
}

const DEFAULT_ORDER: PanelId[] = ['inbox', 'workspace', 'inspector'];
const DEFAULT_VISIBILITY: Record<PanelId, boolean> = {
  inbox: true,
  workspace: true,
  inspector: true
};

const LayoutContext = createContext<LayoutContextType | undefined>(undefined);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [isLayoutMode, setIsLayoutMode] = useState(false);
  const [panelOrder, setPanelOrderState] = useState<PanelId[]>(() => {
    const saved = localStorage.getItem('panel-order');
    if (saved) {
      let order = JSON.parse(saved);
      // Migrate old IDs to new unified 'inbox'
      if (order.includes('sidebar') || order.includes('list')) {
        order = order.map((id: string) => (id === 'sidebar' || id === 'list') ? 'inbox' : id);
        // Deduplicate
        order = [...new Set(order)];
        return order as PanelId[];
      }
      return order;
    }
    return DEFAULT_ORDER;
  });

  const [panelVisibility, setPanelVisibility] = useState<Record<PanelId, boolean>>(() => {
    const saved = localStorage.getItem('panel-visibility');
    if (saved) {
      let visibility = JSON.parse(saved);
      // Migrate visibility
      if ('sidebar' in visibility || 'list' in visibility) {
        const inboxVisible = visibility.sidebar !== false || visibility.list !== false;
        const newVisibility: any = { inbox: inboxVisible };
        if ('workspace' in visibility) newVisibility.workspace = visibility.workspace;
        if ('inspector' in visibility) newVisibility.inspector = visibility.inspector;
        return newVisibility;
      }
      return visibility;
    }
    return DEFAULT_VISIBILITY;
  });

  useEffect(() => {
    localStorage.setItem('panel-order', JSON.stringify(panelOrder));
  }, [panelOrder]);

  useEffect(() => {
    localStorage.setItem('panel-visibility', JSON.stringify(panelVisibility));
  }, [panelVisibility]);

  const toggleLayoutMode = () => setIsLayoutMode(prev => !prev);
  const setLayoutMode = (val: boolean) => setIsLayoutMode(val);
  const setPanelOrder = (newOrder: PanelId[]) => setPanelOrderState(newOrder);
  const togglePanel = (id: PanelId) => {
    setPanelVisibility(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <LayoutContext.Provider value={{ 
      isLayoutMode, 
      panelOrder, 
      panelVisibility,
      toggleLayoutMode, 
      setPanelOrder,
      setLayoutMode,
      togglePanel
    }}>
      {children}
    </LayoutContext.Provider>
  );
}


export function useLayout() {
  const context = useContext(LayoutContext);
  if (!context) throw new Error('useLayout must be used within LayoutProvider');
  return context;
}
