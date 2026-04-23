import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { flushActiveEditor } from '@/lib/activeEditorFlush'
import {
  normalizeNodeView,
  type WorkspaceNode,
  type NodeView,
  type NodeComment,
  type NodeTemplate,
  type CellData,
} from '../types/workspace'
import { persistedCellFieldType } from '@/lib/workspaceFieldSelect'

export type SelectColor = 'purple' | 'pink' | 'light_pink' | 'orange' | 'yellow' | 'lime' | 'green' | 'aqua' | 'blue'

export interface SelectOption {
  id: string
  name: string
  color: SelectColor
}

export interface NavigationOptions {
  viewId?: string
  source?: 'tree' | 'quick_open' | 'wikilink' | 'daily_note' | 'back'
}

export interface HistoryEntry {
  nodeId: string
  viewId?: string
  scrollTop?: number
}

interface WorkspaceStore {
  /** Bumped after workspace structure/data changes so WorkspaceTree can refetch its child cache. */
  workspaceTreeRevision: number
  bumpWorkspaceTreeRevision: () => void

  /** Bumped so WorkspaceTree reloads Recent list from preferences (navigate, delete, restore). */
  recentsRevision: number
  bumpRecentsRevision: () => void

  // Current node
  activeNode: WorkspaceNode | null
  activeNodeChildren: WorkspaceNode[]
  /** Root-level workspace nodes. Populated by loadRootNodes(). Kept separate from
   *  activeNodeChildren so tree refreshes never clobber the rows of an open database. */
  rootNodes: WorkspaceNode[]
  isLoading: boolean
  error: string | null

  // Navigation
  historyStack: HistoryEntry[]
  navigateTo: (nodeId: string, options?: NavigationOptions) => Promise<void>
  goBack: () => void
  setActiveNode: (node: WorkspaceNode | null) => void
  /** Live transcript mirror: patch body when it matches the open document (no full get_node). */
  applyExternalNodeBodyPatch: (nodeId: string, body: string, updatedAt: number) => void
  loadNode: (id: string) => Promise<WorkspaceNode | null>
  loadNodeChildren: (parentId: string) => Promise<void>
  loadRootNodes: () => Promise<void>

  // Scroll position preservation for database views
  scrollPositions: Record<string, number>
  setScrollPosition: (nodeId: string, scrollTop: number) => void

  // CRUD
  createNode: (parentId: string | null, nodeType: 'document' | 'database' | 'row', name: string) => Promise<WorkspaceNode>
  updateNode: (id: string, name: string, icon: string, properties: string, body: string) => Promise<WorkspaceNode>
  deleteNode: (id: string) => Promise<void>
  moveNode: (id: string, parentId: string | null, position: number) => Promise<WorkspaceNode>

  // Views (attached to database nodes)
  views: NodeView[]
  loadViews: (nodeId: string) => Promise<void>
  createView: (nodeId: string, name: string, layout: NodeView['layout']) => Promise<NodeView>
  updateView: (id: string, name: string, color: string | null, filters: string, sorts: string, view_options: string) => Promise<NodeView>
  deleteView: (id: string) => Promise<void>

  // Comments
  comments: NodeComment[]
  loadComments: (nodeId: string) => Promise<void>
  addComment: (nodeId: string, author: string, content: string) => Promise<NodeComment>
  deleteComment: (id: string) => Promise<void>

  // Templates
  templates: NodeTemplate[]
  loadTemplates: (nodeId: string) => Promise<void>
  createTemplate: (nodeId: string, name: string, templateData: string) => Promise<NodeTemplate>

  // Board operations
  createSelectOption: (databaseId: string, fieldId: string, name: string) => Promise<SelectOption>
  renameSelectOption: (databaseId: string, fieldId: string, optionId: string, name: string) => Promise<void>
  updateSelectOptionColor: (databaseId: string, fieldId: string, optionId: string, color: SelectColor) => Promise<void>
  deleteSelectOption: (databaseId: string, fieldId: string, optionId: string) => Promise<void>
  reorderSelectOptions: (databaseId: string, fieldId: string, optionIds: string[]) => Promise<void>
  getCell: (rowId: string, fieldId: string) => Promise<CellData | null>
  updateCell: (
    rowId: string,
    fieldId: string,
    cellType: string,
    value: unknown,
    isPrimary?: boolean,
    cellExtras?: { formula?: string | null; evalError?: string | null } | null,
  ) => Promise<void>
  createRowInGroup: (databaseId: string, fieldId: string, optionId: string, name: string) => Promise<WorkspaceNode>
  addSingleSelectField: (databaseId: string, fieldName: string) => Promise<WorkspaceNode>

  // Field CRUD
  addField: (databaseId: string, fieldName: string, fieldType: string) => Promise<WorkspaceNode>
  renameField: (databaseId: string, fieldId: string, name: string) => Promise<WorkspaceNode>
  setFieldType: (databaseId: string, fieldId: string, fieldType: string) => Promise<WorkspaceNode>
  setFieldGroup: (databaseId: string, fieldId: string, group: string) => Promise<WorkspaceNode>
  renameFieldGroup: (databaseId: string, oldName: string, newName: string) => Promise<WorkspaceNode>
  deleteField: (databaseId: string, fieldId: string) => Promise<WorkspaceNode>

  // Search
  searchNodes: (query: string, options?: { limit?: number }) => Promise<WorkspaceNodeSummary[]>

  // Trash
  trashNodes: WorkspaceNode[]
  loadTrashNodes: () => Promise<void>
  restoreNode: (id: string) => Promise<void>
  permanentDeleteNode: (id: string) => Promise<void>
  emptyTrash: () => Promise<void>

  // Import / Export
  importMarkdownFolder: (path: string) => Promise<WorkspaceNode[]>
  importCsv: (path: string) => Promise<WorkspaceNode>
  exportMarkdown: (nodeId: string, path: string) => Promise<void>
  exportCsv: (nodeId: string, viewId: string, path: string) => Promise<void>

  /** Silent re-fetch on window:focus. Returns true when the body changed on disk (external edit). */
  focusRefreshActiveNode: () => Promise<boolean>
}

export interface WorkspaceNodeSummary {
  id: string
  name: string
  node_type: string
  icon: string
  parent_name: string | null
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => {
  const bumpWorkspaceTreeRevision = () =>
    set((s) => ({ workspaceTreeRevision: s.workspaceTreeRevision + 1 }))
  const bumpRecentsRevision = () =>
    set((s) => ({ recentsRevision: s.recentsRevision + 1 }))

  return {
  workspaceTreeRevision: 0,
  bumpWorkspaceTreeRevision,
  recentsRevision: 0,
  bumpRecentsRevision,

  activeNode: null,
  activeNodeChildren: [],
  rootNodes: [],
  isLoading: false,
  error: null,
  views: [],
  comments: [],
  templates: [],
  scrollPositions: {},
  historyStack: [],
  trashNodes: [],

  navigateTo: async (nodeId, options) => {
    // Flush any pending autosave in the currently-focused editor BEFORE
    // swapping activeNode, so the last keystroke isn't dropped when the user
    // navigates mid-typing (Finding 5 in the note-switching audit).
    await flushActiveEditor()

    const { activeNode, scrollPositions } = get()
    const currentScrollTop = activeNode ? scrollPositions[activeNode.id] : undefined

    // Push current position to history stack (cap at 100)
    if (activeNode) {
      const entry: HistoryEntry = {
        nodeId: activeNode.id,
        viewId: undefined,
        scrollTop: currentScrollTop,
      }
      let stack = [...get().historyStack, entry]
      if (stack.length > 100) {
        stack = stack.slice(stack.length - 100)
      }
      set({ historyStack: stack })
    }

    // Load the target node and its children
    set({ isLoading: true, error: null, views: [], comments: [] })
    try {
      const node = await invoke<WorkspaceNode | null>('get_node', { id: nodeId })
      if (!node) {
        set({ isLoading: false, error: 'Node not found' })
        return
      }

      const children = node.node_type === 'database' || node.node_type === 'row'
        ? await invoke<WorkspaceNode[]>('get_node_children', { parentId: nodeId })
        : []

      set({ activeNode: node, activeNodeChildren: children, isLoading: false })

      // Update recents in user_preferences
      try {
        const recentsJson = await invoke<string | null>('get_user_preference', { key: 'recents' })
        let recents: { nodeId: string; viewedAt: number }[] = []
        if (recentsJson) {
          recents = JSON.parse(recentsJson)
        }
        // Remove existing entry for this node, add to front
        recents = recents.filter(r => r.nodeId !== nodeId)
        recents.unshift({ nodeId, viewedAt: Date.now() })
        recents = recents.slice(0, 10)
        await invoke('set_user_preference', { key: 'recents', value: JSON.stringify(recents) })
        bumpRecentsRevision()
      } catch {
        // Non-critical, ignore preference errors
      }

      // Update window title
      try {
        const win = getCurrentWindow()
        await win.setTitle(`${node.name} — Infield`)
      } catch {
        // Non-critical
      }

      // Reset view state if viewId provided
      if (options?.viewId) {
        set({ views: [] })
      }
    } catch (e) {
      set({ error: String(e), isLoading: false })
    }
  },

  goBack: () => {
    const stack = get().historyStack
    if (stack.length === 0) return

    const newStack = [...stack]
    const prev = newStack.pop()!
    set({ historyStack: newStack })

    // Flush pending autosave, then fetch fresh node state. Kept async-inside-sync
    // so callers (keyboard shortcut, back button) don't need to await.
    void (async () => {
      await flushActiveEditor()
      const node = await invoke<WorkspaceNode | null>('get_node', { id: prev.nodeId })
      if (!node) return
      const children =
        node.node_type === 'database' || node.node_type === 'row'
          ? await invoke<WorkspaceNode[]>('get_node_children', { parentId: prev.nodeId })
          : []
      set({ activeNode: node, activeNodeChildren: children })
      // Restore scroll position after a tick
      if (prev.scrollTop !== undefined) {
        setTimeout(() => {
          const current = get().scrollPositions
          set({ scrollPositions: { ...current, [prev.nodeId]: prev.scrollTop as number } })
        }, 0)
      }
    })()
  },

  setScrollPosition: (nodeId, scrollTop) => set({ scrollPositions: { ...get().scrollPositions, [nodeId]: scrollTop } }),

  setActiveNode: (node) => set({ activeNode: node, activeNodeChildren: [], error: null }),

  applyExternalNodeBodyPatch: (nodeId, body, updatedAt) => {
    const { activeNode } = get()
    if (!activeNode || activeNode.id !== nodeId) return
    set({ activeNode: { ...activeNode, body, updated_at: updatedAt } })
  },

  loadNode: async (id) => {
    set({ isLoading: true, error: null, activeNodeChildren: [] })
    try {
      const node = await invoke<WorkspaceNode | null>('get_node', { id })
      set({ activeNode: node ?? null, isLoading: false })
      return node ?? null
    } catch (e) {
      set({ error: String(e), isLoading: false })
      return null
    }
  },

  loadNodeChildren: async (parentId) => {
    try {
      const children = await invoke<WorkspaceNode[]>('get_node_children', { parentId })
      set({ activeNodeChildren: children })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  focusRefreshActiveNode: async () => {
    const { activeNode } = get()
    if (!activeNode || activeNode.node_type !== 'document') return false
    try {
      const fresh = await invoke<WorkspaceNode | null>('get_node', { id: activeNode.id })
      if (!fresh) return false
      const bodyChanged = fresh.body !== activeNode.body
      if (bodyChanged || fresh.updated_at !== activeNode.updated_at) {
        set({ activeNode: fresh })
      }
      return bodyChanged
    } catch {
      return false
    }
  },

  loadRootNodes: async () => {
    try {
      const roots = await invoke<WorkspaceNode[]>('get_root_nodes')
      // IMPORTANT: write to dedicated rootNodes, NEVER activeNodeChildren.
      // activeNodeChildren holds the rows of the currently-open database; clobbering
      // it with roots made open database views look empty after imports/transcriptions.
      set({ rootNodes: roots })
    } catch {
      set({ rootNodes: [] })
    }
  },

  // CRUD
  createNode: async (parentId, nodeType, name) => {
    try {
      const node = await invoke<WorkspaceNode>('create_node', { parentId, nodeType, name })
      if (parentId) { await get().loadNodeChildren(parentId) }
      bumpWorkspaceTreeRevision()
      return node
    } catch (e) {
      set({ error: String(e) })
      throw e
    }
  },

  updateNode: async (id, name, icon, properties, body) => {
    try {
      const node = await invoke<WorkspaceNode>('update_node', { id, name, icon, properties, body })
      set((s) => ({
        activeNode: s.activeNode?.id === id ? node : s.activeNode,
      }))
      bumpWorkspaceTreeRevision()
      return node
    } catch (e) {
      set({ error: String(e) })
      throw e
    }
  },

  deleteNode: async (id) => {
    try {
      await invoke('delete_node', { id })
      set({ activeNode: null, activeNodeChildren: [] })
      bumpWorkspaceTreeRevision()
      await get().loadTrashNodes()
      bumpRecentsRevision()
    } catch (e) {
      set({ error: String(e) })
      throw e
    }
  },

  moveNode: async (id, parentId, position) => {
    try {
      const moved = await invoke<WorkspaceNode>('move_node', { id, parentId, position })
      bumpWorkspaceTreeRevision()
      return moved
    } catch (e) {
      set({ error: String(e) })
      throw e
    }
  },

  // Views
  loadViews: async (nodeId) => {
    const raw = await invoke<NodeView[]>('get_node_views', { nodeId })
    const views = raw.map(normalizeNodeView)
    set({ views })
  },

  createView: async (nodeId, name, layout) => {
    try {
      const view = normalizeNodeView(await invoke<NodeView>('create_node_view', { nodeId, name, layout }))
      set({ views: [...get().views, view] })
      return view
    } catch (e) {
      set({ error: String(e) })
      throw e
    }
  },

  updateView: async (id, name, color, filters, sorts, view_options) => {
    try {
      const view = normalizeNodeView(await invoke<NodeView>('update_node_view', { id, name, color, filters, sorts, viewOptions: view_options }))
      set({ views: get().views.map(v => v.id === id ? view : v) })
      return view
    } catch (e) {
      set({ error: String(e) })
      throw e
    }
  },

  deleteView: async (id) => {
    try {
      await invoke('delete_node_view', { id })
      set({ views: get().views.filter(v => v.id !== id) })
    } catch (e) {
      set({ error: String(e) })
      throw e
    }
  },

  // Comments
  loadComments: async (nodeId) => {
    const comments = await invoke<NodeComment[]>('get_node_comments', { nodeId })
    set({ comments })
  },

  addComment: async (nodeId, author, content) => {
    try {
      const comment = await invoke<NodeComment>('add_comment', { nodeId, author, content })
      set({ comments: [...get().comments, comment] })
      return comment
    } catch (e) {
      set({ error: String(e) })
      throw e
    }
  },

  deleteComment: async (id) => {
    try {
      await invoke('delete_comment', { id })
      set({ comments: get().comments.filter(c => c.id !== id) })
    } catch (e) {
      set({ error: String(e) })
      throw e
    }
  },

  // Templates
  loadTemplates: async (nodeId) => {
    const templates = await invoke<NodeTemplate[]>('get_templates', { nodeId })
    set({ templates })
  },

  createTemplate: async (nodeId, name, templateData) => {
    try {
      const template = await invoke<NodeTemplate>('create_template', { nodeId, name, templateData })
      set({ templates: [...get().templates, template] })
      return template
    } catch (e) {
      set({ error: String(e) })
      throw e
    }
  },

  // Board operations
  createSelectOption: async (databaseId, fieldId, name) => {
    const result = await invoke<SelectOption>('ws_create_select_option', { databaseId, fieldId, name })
    // Reload the database node so BoardView/GridView see the updated field options
    if (get().activeNode?.id === databaseId) {
      const updated = await invoke<WorkspaceNode | null>('get_node', { id: databaseId })
      if (updated) set({ activeNode: updated })
    }
    bumpWorkspaceTreeRevision()
    return result
  },
  renameSelectOption: async (databaseId, fieldId, optionId, name) => {
    await invoke('ws_rename_select_option', { databaseId, fieldId, optionId, name })
    if (get().activeNode?.id === databaseId) {
      const updated = await invoke<WorkspaceNode | null>('get_node', { id: databaseId })
      if (updated) set({ activeNode: updated })
    }
    bumpWorkspaceTreeRevision()
  },
  updateSelectOptionColor: async (databaseId, fieldId, optionId, color) => {
    await invoke('ws_update_select_option_color', { databaseId, fieldId, optionId, color })
    if (get().activeNode?.id === databaseId) {
      const updated = await invoke<WorkspaceNode | null>('get_node', { id: databaseId })
      if (updated) set({ activeNode: updated })
    }
    bumpWorkspaceTreeRevision()
  },
  deleteSelectOption: async (databaseId, fieldId, optionId) => {
    await invoke('ws_delete_select_option', { databaseId, fieldId, optionId })
    if (get().activeNode?.id === databaseId) {
      const updated = await invoke<WorkspaceNode | null>('get_node', { id: databaseId })
      if (updated) set({ activeNode: updated })
    }
    bumpWorkspaceTreeRevision()
  },
  reorderSelectOptions: async (databaseId, fieldId, optionIds) => {
    await invoke('ws_reorder_select_options', { databaseId, fieldId, optionIds })
    if (get().activeNode?.id === databaseId) {
      const updated = await invoke<WorkspaceNode | null>('get_node', { id: databaseId })
      if (updated) set({ activeNode: updated })
    }
    bumpWorkspaceTreeRevision()
  },
  getCell: async (rowId, fieldId) => {
    const result = await invoke<string | null>('ws_get_cell', { rowId, fieldId })
    if (!result) return null
    return JSON.parse(result) as CellData
  },
  updateCell: async (rowId, fieldId, cellType, value, isPrimary?: boolean, cellExtras?: { formula?: string | null; evalError?: string | null } | null) => {
    const cellExtrasJson =
      cellExtras != null && Object.keys(cellExtras).length > 0
        ? JSON.stringify(cellExtras)
        : null
    const persistedCellType = persistedCellFieldType(cellType)
    await invoke('ws_update_cell', {
      rowId,
      fieldId,
      cellType: persistedCellType,
      value: JSON.stringify(value),
      cellExtras: cellExtrasJson,
    })

    // Re-fetch row from backend so UI always reflects true state
    const updatedRow = await invoke<WorkspaceNode | null>('get_node', { id: rowId })
    if (updatedRow) {
      set((state) => ({
        activeNodeChildren: state.activeNodeChildren.map((n) =>
          n.id === rowId ? updatedRow : n
        ),
      }))
    }

    // If primary field, sync row.name in the DB so WorkspaceTree shows correct name
    if (isPrimary && typeof value === 'string') {
      const node = get().activeNodeChildren.find(n => n.id === rowId)
      if (node) {
        await invoke('update_node', {
          id: rowId,
          name: value,
          icon: node.icon,
          properties: node.properties,
          body: node.body,
        })
      }
    }
    bumpWorkspaceTreeRevision()
  },
  createRowInGroup: async (databaseId, fieldId, optionId, name) => {
    const node = await invoke<WorkspaceNode>('ws_create_row_in_group', { databaseId, fieldId, optionId, name })
    // Add the new row to activeNodeChildren and reload to get fresh data
    await get().loadNodeChildren(databaseId)
    bumpWorkspaceTreeRevision()
    return node
  },
  addSingleSelectField: async (databaseId, fieldName) => {
    const node = await invoke<WorkspaceNode>('ws_add_single_select_field', { databaseId, fieldName })
    if (get().activeNode?.id === databaseId) {
      set({ activeNode: node })
    }
    bumpWorkspaceTreeRevision()
    return node
  },
  addField: async (databaseId, fieldName, fieldType) => {
    const node = await invoke<WorkspaceNode>('ws_add_field', { databaseId, fieldName, fieldType })
    if (get().activeNode?.id === databaseId) {
      set({ activeNode: node })
    }

    // Auto-wire date/datetime fields to calendar view (start + optional end column)
    if (fieldType === 'date' || fieldType === 'date_time') {
      const views = get().views
      const calendarView = views.find(v => v.layout === 'calendar')
      if (calendarView) {
        const fields = JSON.parse(node.properties).fields ?? []
        const sortedFields = [...fields].sort((a: { position: number }, b: { position: number }) => a.position - b.position)
        const newField = sortedFields[sortedFields.length - 1] as { id: string; field_type: string } | undefined
        if (newField) {
          const existingOptions = (() => {
            try {
              return JSON.parse(calendarView.view_options || '{}') as Record<string, unknown>
            } catch {
              return {} as Record<string, unknown>
            }
          })()
          const { calendarDateFieldId: _l1, calendarEndFieldId: _l2, ...restViewOptions } = existingOptions
          const base: Record<string, unknown> = { ...restViewOptions }

          const startIdRaw =
            (typeof base.date_field_id === 'string' && base.date_field_id.trim()) ||
            (typeof existingOptions.calendarDateFieldId === 'string' && existingOptions.calendarDateFieldId.trim()) ||
            ''
          const endIdRaw =
            (typeof base.end_field_id === 'string' && base.end_field_id.trim()) ||
            (typeof existingOptions.calendarEndFieldId === 'string' && existingOptions.calendarEndFieldId.trim()) ||
            ''

          const getField = (id: string) => sortedFields.find((f: { id: string }) => f.id === id)
          const startField = startIdRaw ? getField(startIdRaw) : undefined
          const endField = endIdRaw ? getField(endIdRaw) : undefined

          const validStart =
            startField && (startField.field_type === 'date' || startField.field_type === 'date_time')
          const validEnd = endField?.field_type === 'date_time'

          let merged: Record<string, unknown>

          if (
            newField.field_type === 'date_time' &&
            validStart &&
            startField.field_type === 'date_time' &&
            newField.id !== startField.id
          ) {
            if (!validEnd || !endField || endField.id === newField.id) {
              merged = { ...base, date_field_id: startField.id, end_field_id: newField.id }
            } else {
              merged = { ...base, date_field_id: startField.id, end_field_id: endField.id }
            }
          } else if (!validStart) {
            merged = { ...base, date_field_id: newField.id }
            delete merged.end_field_id
          } else {
            merged = { ...base, date_field_id: startField.id }
            if (validEnd && endField) {
              merged.end_field_id = endField.id
            } else {
              delete merged.end_field_id
            }
          }

          const mergedOptions = JSON.stringify(merged)
          await invoke('update_node_view', {
            id: calendarView.id,
            name: calendarView.name,
            color: calendarView.color ?? null,
            filters: calendarView.filters ?? '[]',
            sorts: calendarView.sorts ?? '[]',
            viewOptions: mergedOptions,
          })
          const rawViews = await invoke<NodeView[]>('get_node_views', { nodeId: databaseId })
          set({ views: rawViews.map(normalizeNodeView) })
        }
      }
    }

    bumpWorkspaceTreeRevision()
    return node
  },
  renameField: async (databaseId, fieldId, name) => {
    const node = await invoke<WorkspaceNode>('ws_rename_field', { databaseId, fieldId, name })
    if (get().activeNode?.id === databaseId) {
      set({ activeNode: node })
    }
    bumpWorkspaceTreeRevision()
    return node
  },
  setFieldType: async (databaseId, fieldId, fieldType) => {
    const node = await invoke<WorkspaceNode>('ws_set_field_type', { databaseId, fieldId, fieldType })
    if (get().activeNode?.id === databaseId) {
      set({ activeNode: node })
    }
    bumpWorkspaceTreeRevision()
    return node
  },
  setFieldGroup: async (databaseId, fieldId, group) => {
    const node = await invoke<WorkspaceNode>('ws_set_field_group', { databaseId, fieldId, group })
    if (get().activeNode?.id === databaseId) {
      set({ activeNode: node })
    }
    bumpWorkspaceTreeRevision()
    return node
  },
  renameFieldGroup: async (databaseId, oldName, newName) => {
    const node = await invoke<WorkspaceNode>('ws_rename_field_group', {
      databaseId,
      oldName,
      newName,
    })
    if (get().activeNode?.id === databaseId) {
      set({ activeNode: node })
    }
    bumpWorkspaceTreeRevision()
    return node
  },
  deleteField: async (databaseId, fieldId) => {
    const node = await invoke<WorkspaceNode>('ws_delete_field', { databaseId, fieldId })
    if (get().activeNode?.id === databaseId) {
      set({ activeNode: node })
    }
    bumpWorkspaceTreeRevision()
    return node
  },

  // Search — title-only FTS for wikilink autocomplete
  searchNodes: async (query, options) => {
    if (!query.trim()) return []
    const limit = options?.limit ?? 10
    return await invoke<WorkspaceNodeSummary[]>('search_workspace_title', { query, limit })
  },

  // Trash
  loadTrashNodes: async () => {
    try {
      const nodes = await invoke<WorkspaceNode[]>('get_deleted_nodes')
      set({ trashNodes: nodes })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  restoreNode: async (id) => {
    try {
      await invoke('restore_node', { id })
      set({ trashNodes: get().trashNodes.filter(n => n.id !== id) })
      // Reload root nodes so the restored node appears in the tree
      await get().loadRootNodes()
      bumpWorkspaceTreeRevision()
      bumpRecentsRevision()
    } catch (e) {
      set({ error: String(e) })
      throw e
    }
  },

  permanentDeleteNode: async (id) => {
    try {
      await invoke('permanent_delete_node', { id })
      set({ trashNodes: get().trashNodes.filter(n => n.id !== id) })
      bumpWorkspaceTreeRevision()
      bumpRecentsRevision()
    } catch (e) {
      set({ error: String(e) })
      throw e
    }
  },

  emptyTrash: async () => {
    try {
      await invoke('empty_trash')
      set({ trashNodes: [] })
      bumpWorkspaceTreeRevision()
      bumpRecentsRevision()
    } catch (e) {
      set({ error: String(e) })
      throw e
    }
  },

  // Import / Export
  importMarkdownFolder: async (path) => {
    try {
      const nodes = await invoke<WorkspaceNode[]>('import_markdown_folder', { path })
      await get().loadRootNodes()
      bumpWorkspaceTreeRevision()
      return nodes
    } catch (e) {
      set({ error: String(e) })
      throw e
    }
  },

  importCsv: async (path) => {
    try {
      const node = await invoke<WorkspaceNode>('import_csv', { path })
      await get().loadRootNodes()
      bumpWorkspaceTreeRevision()
      return node
    } catch (e) {
      set({ error: String(e) })
      throw e
    }
  },

  exportMarkdown: async (nodeId, path) => {
    try {
      await invoke('export_markdown', { nodeId, path })
    } catch (e) {
      set({ error: String(e) })
      throw e
    }
  },

  exportCsv: async (nodeId, viewId, path) => {
    try {
      await invoke('export_csv', { nodeId, viewId, path })
    } catch (e) {
      set({ error: String(e) })
      throw e
    }
  },
}
})