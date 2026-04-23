import type { SelectOption, SelectColor } from '@/stores/workspaceStore'

export interface BoardTemplate {
  id: string
  name: string
  columns: { name: string; color: SelectColor }[]
}

const STORAGE_KEY = 'handy:board-templates'

export const BUILTIN_TEMPLATES: BoardTemplate[] = [
  {
    id: 'kanban',
    name: 'Kanban',
    columns: [
      { name: 'To Do', color: 'purple' },
      { name: 'In Progress', color: 'yellow' },
      { name: 'Done', color: 'green' },
    ],
  },
  {
    id: 'priority',
    name: 'Priority',
    columns: [
      { name: 'High', color: 'pink' },
      { name: 'Medium', color: 'orange' },
      { name: 'Low', color: 'blue' },
    ],
  },
  {
    id: 'board',
    name: 'Board',
    columns: [
      { name: 'Open', color: 'light_pink' },
      { name: 'Review', color: 'yellow' },
      { name: 'Closed', color: 'green' },
    ],
  },
]

export function loadTemplates(): BoardTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveTemplates(templates: BoardTemplate[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
}

export function getAllTemplates(): BoardTemplate[] {
  return [...BUILTIN_TEMPLATES, ...loadTemplates()]
}