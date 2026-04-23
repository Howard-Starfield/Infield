import { create } from 'zustand'
import { toast } from 'sonner'
import { commands, type ChatImageAttachment, type ChatMemoryMessage } from '@/bindings'
import { materializeWorkspaceDraft } from '@/lib/materializeWorkspaceDraft'
import {
  tryExtractWorkspaceDraftFromAssistantText,
  type WorkspaceDatabaseDraft,
} from '@/lib/workspaceDraftSchema'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useWorkspaceStore } from '@/stores/workspaceStore'

export type { ChatMemoryMessage as ChatMessage }

export interface ChatSession {
  id: string
  title: string | null
  created_at: number
  updated_at: number
}

interface ChatTokenPayload {
  session_id: string
  token: string
  done: boolean
}

interface ChatErrorPayload {
  session_id: string
  error: string
}

interface ChatStore {
  sessions: ChatSession[]
  activeSessionId: string | null
  messages: ChatMemoryMessage[]
  isLoading: boolean
  streamingContent: string
  /** Parsed from last assistant reply (```handy_workspace_draft); confirm to materialize. */
  pendingWorkspaceDraft: WorkspaceDatabaseDraft | null
  pendingWorkspaceDraftError: string | null
  dismissPendingWorkspaceDraft: () => void
  materializePendingDraft: (parentId: string | null) => Promise<{ databaseId: string } | null>
  loadSessions: () => Promise<void>
  startSession: (title?: string) => Promise<string | null>
  selectSession: (sessionId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  sendMessage: (
    content: string,
    attachments?: ChatImageAttachment[] | null,
    document_context?: string | null,
  ) => Promise<void>
}

export const useChatStore = create<ChatStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  isLoading: false,
  streamingContent: '',
  pendingWorkspaceDraft: null,
  pendingWorkspaceDraftError: null,

  dismissPendingWorkspaceDraft: () =>
    set({ pendingWorkspaceDraft: null, pendingWorkspaceDraftError: null }),

  materializePendingDraft: async (parentId) => {
    const draft = get().pendingWorkspaceDraft
    if (!draft) return null
    const ws = useWorkspaceStore.getState()
    const { databaseId } = await materializeWorkspaceDraft(draft, parentId, {
      createNode: ws.createNode,
      renameField: ws.renameField,
      addField: ws.addField,
      updateCell: ws.updateCell,
      loadNodeChildren: ws.loadNodeChildren,
    })
    set({ pendingWorkspaceDraft: null, pendingWorkspaceDraftError: null })
    ws.bumpWorkspaceTreeRevision()
    await ws.navigateTo(databaseId)
    return { databaseId }
  },

  loadSessions: async () => {
    const result = await commands.listChatSessions()
    if (result.status === 'ok') {
      set({ sessions: result.data })
    }
  },

  startSession: async (title) => {
    const result = await commands.newChatSession(title ?? null)
    if (result.status !== 'ok') {
      console.error('Failed to create chat session:', result.error)
      return null
    }
    const id = result.data
    await get().loadSessions()
    set({
      activeSessionId: id,
      messages: [],
      pendingWorkspaceDraft: null,
      pendingWorkspaceDraftError: null,
    })
    return id
  },

  selectSession: async (sessionId) => {
    const result = await commands.getChatMessages(sessionId, 50)
    if (result.status === 'ok') {
      set({
        activeSessionId: sessionId,
        messages: result.data,
        pendingWorkspaceDraft: null,
        pendingWorkspaceDraftError: null,
      })
    }
  },

  deleteSession: async (sessionId) => {
    await commands.deleteChatSession(sessionId)
    const { activeSessionId } = get()
    if (activeSessionId === sessionId) {
      set({
        activeSessionId: null,
        messages: [],
        pendingWorkspaceDraft: null,
        pendingWorkspaceDraftError: null,
      })
    }
    await get().loadSessions()
  },

  sendMessage: async (content, attachments = null, document_context = null) => {
    const { activeSessionId } = get()
    if (!activeSessionId) return

    const att = attachments?.length ? attachments : null
    const docCtx =
      document_context && document_context.trim().length > 0 ? document_context.trim() : null

    // Persist user message
    const result = await commands.addChatMessage(
      activeSessionId,
      'user',
      content,
      att,
      docCtx,
    )
    if (result.status !== 'ok') {
      console.error('Failed to add chat message:', result.error)
      return
    }
    const userMsg = result.data
    set((s) => ({
      messages: [...s.messages, userMsg],
      isLoading: true,
      streamingContent: '',
    }))

    // Build the messages array for the LLM
    const allMessages = get().messages.map((m) => ({
      role: m.role,
      content: m.content,
      attachments: m.attachments?.length ? m.attachments : null,
      document_context: m.document_context?.trim() ? m.document_context : null,
    }))

    // Listen for streaming tokens
    let accumulated = ''
    let unlistenToken: UnlistenFn | null = null
    let unlistenError: UnlistenFn | null = null

    const cleanup = () => {
      unlistenToken?.()
      unlistenError?.()
    }

    try {
      unlistenToken = await listen<ChatTokenPayload>(
        'chat-token',
        (event) => {
          if (event.payload.session_id !== activeSessionId) {
            return
          }

          accumulated += event.payload.token
          set({ streamingContent: accumulated })

          if (event.payload.done) {
            // Stream complete — persist assistant message and finalize
            const sessionId = activeSessionId
            const finalContent = accumulated
            cleanup()

            commands
              .addChatMessage(sessionId, 'assistant', finalContent, null, null)
              .then((assistantResult) => {
                if (assistantResult.status === 'ok') {
                  const draftParse = tryExtractWorkspaceDraftFromAssistantText(finalContent)
                  const draftPatch: Partial<{
                    pendingWorkspaceDraft: WorkspaceDatabaseDraft | null
                    pendingWorkspaceDraftError: string | null
                  }> = {}
                  if (draftParse.ok) {
                    draftPatch.pendingWorkspaceDraft = draftParse.draft
                    draftPatch.pendingWorkspaceDraftError = null
                  } else if (finalContent.includes('handy_workspace_draft')) {
                    draftPatch.pendingWorkspaceDraft = null
                    draftPatch.pendingWorkspaceDraftError = draftParse.error
                  } else {
                    draftPatch.pendingWorkspaceDraftError = null
                  }
                  set((s) => ({
                    messages: [...s.messages, assistantResult.data],
                    isLoading: false,
                    streamingContent: '',
                    ...draftPatch,
                  }))
                } else {
                  set({ isLoading: false, streamingContent: '' })
                }
              })
              .catch(() => {
                set({ isLoading: false, streamingContent: '' })
              })
          }
        }
      )

      unlistenError = await listen<ChatErrorPayload>(
        'chat-error',
        (event) => {
          if (event.payload.session_id !== activeSessionId) return
          console.error('Chat error:', event.payload.error)
          toast.error(event.payload.error || 'Chat request failed')
          cleanup()
          set({ isLoading: false, streamingContent: '' })
        }
      )

      // Fire the streaming request
      await commands.sendChatMessage(activeSessionId, allMessages)
    } catch (e) {
      console.error('Failed to send chat message:', e)
      cleanup()
      set({ isLoading: false, streamingContent: '' })
    }
  },
}))
