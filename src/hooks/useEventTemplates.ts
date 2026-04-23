import { useState, useCallback } from 'react'

export interface EventTemplate {
  id: string;
  title: string;
  hour: number;
  color: 'purple' | 'pink' | 'green' | 'blue' | 'orange' | 'yellow';
  description: string;
}

const STORAGE_KEY = 'handy:event-templates';

export function loadTemplates(): EventTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveTemplates(templates: EventTemplate[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

export function useEventTemplates() {
  const [templates, setTemplates] = useState<EventTemplate[]>(() => loadTemplates());

  const addTemplate = useCallback((t: Omit<EventTemplate, 'id'>) => {
    const newT: EventTemplate = { ...t, id: `tpl-${Date.now()}` };
    const next = [...templates, newT];
    saveTemplates(next);
    setTemplates(next);
  }, [templates]);

  const updateTemplate = useCallback((id: string, patch: Partial<EventTemplate>) => {
    const next = templates.map(t => t.id === id ? { ...t, ...patch } : t);
    saveTemplates(next);
    setTemplates(next);
  }, [templates]);

  const deleteTemplate = useCallback((id: string) => {
    const next = templates.filter(t => t.id !== id);
    saveTemplates(next);
    setTemplates(next);
  }, [templates]);

  return { templates, addTemplate, updateTemplate, deleteTemplate };
}
