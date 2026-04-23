import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import type { WorkspaceNode } from '../../types/workspace'
import { MDXEditorView, type MDXEditorMethods } from '../editor/MDXEditorView'
import {
  EDITOR_SCROLL_PADDING_X_PX,
} from '../../lib/editorLayoutConstants'
import { deriveNoteTitle } from '../../lib/utils/editorUtils'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  LoaderCircle,
  PanelRightOpen,
  Share2,
  Sparkles,
} from 'lucide-react'
import { DatabaseShell } from './DatabaseShell'
import { RowPageView } from './RowPageView'
import { BacklinksSection } from './BacklinksSection'
import { ChildrenSection } from './ChildrenSection'
import { formatVoiceMemoRecordedAt } from '@/lib/formatVoiceMemoRecordedAt'
import { stripLegacyVoiceMemoAudioLine } from '@/lib/voiceMemoAudioDirective'
import { registerActiveEditorFlush, flushActiveEditor } from '@/lib/activeEditorFlush'
import { mergeSidenoteRailIntoProperties, parseSidenoteRail, type SidenoteRailPersisted } from '@/lib/sidenoteRail'
import {
  mergeTagsIntoProperties,
  parseTagsFromProperties,
} from '@/lib/workspaceDocumentTags'
import { SidenoteRail } from './SidenoteRail'
import { WorkspaceDocumentTags } from './WorkspaceDocumentTags'

/** Parsed from `workspace_nodes.properties` for Mic Transcribe mirror docs. */
type VoiceMemoMirrorMeta = {
  noteId: string
  recordedAtMs: number
  audioFilePath: string | null
}

function parseVoiceMemoMirror(propertiesJson: string): VoiceMemoMirrorMeta | null {
  try {
    const p = JSON.parse(propertiesJson || '{}') as Record<string, unknown>
    const m = p.voice_memo_mirror as Record<string, unknown> | undefined
    if (!m || typeof m !== 'object') return null
    const noteId = typeof m.note_id === 'string' ? m.note_id : ''
    if (!noteId) return null
    const ram = m.recorded_at_ms
    const recordedAtMs =
      typeof ram === 'number'
        ? ram
        : typeof ram === 'string'
          ? Number.parseInt(ram, 10)
          : Number.NaN
    const afp = m.audio_file_path
    const audioFilePath =
      afp === null || afp === undefined
        ? null
        : typeof afp === 'string'
          ? afp
          : String(afp)
    return {
      noteId,
      recordedAtMs: Number.isFinite(recordedAtMs) ? recordedAtMs : 0,
      audioFilePath,
    }
  } catch {
    return null
  }
}

// ─── DocumentEditor ─────────────────────────────────────────────────────────

interface DocumentEditorProps {
  node: WorkspaceNode
}

const DocumentEditor: React.FC<DocumentEditorProps> = ({ node }) => {
  const { t } = useTranslation()
  // Granular selector — avoid whole-store subscription (CLAUDE.md Rule 4).
  const updateNode = useWorkspaceStore((s) => s.updateNode)
  const [title, setTitle] = useState(node.name)

  // Check if this is a daily note
  const dailyDate: string | null = (() => {
    try {
      const props = JSON.parse(node.properties || '{}')
      return props.daily_date || null
    } catch {
      return null
    }
  })()

  const today = new Date().toISOString().split('T')[0]
  const isToday = dailyDate === today

  const voiceMemoMirror = useMemo(
    () => parseVoiceMemoMirror(node.properties),
    [node.properties],
  )
  const documentTags = useMemo(
    () => parseTagsFromProperties(node.properties),
    [node.properties],
  )
  const [isAiOpen, setIsAiOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  /** Reflects last persistence attempt — not idle "looks saved" when nothing ran yet. */
  const [saveState, setSaveState] = useState<'saved' | 'error'>('saved')
  const saveTimeoutRef = useRef<number | null>(null)
  const titleRef = useRef(title)
  titleRef.current = title

  const editorRef = useRef<MDXEditorMethods | null>(null)
  const titleAreaRef = useRef<HTMLTextAreaElement | null>(null)
  const latestPropsRef = useRef(node.properties)
  const layoutOuterTimeoutRef = useRef<number | null>(null)
  const layoutInnerTimeoutRef = useRef<number | null>(null)
  /**
   * Last body value this editor either rendered for `node.id` or persisted.
   * Used to discriminate self-echo from autosave roundtrip (skip) vs. real
   * external mutation like transcription append (apply). See Finding 1 in
   * the note-switching audit.
   */
  const lastLocalBodyRef = useRef<string>(node.body ?? '')

  const rail = useMemo(() => parseSidenoteRail(node.properties), [node.properties])
  const sidenoteOpen = rail.collapsed === false
  const widthPercent = rail.width_percent ?? 32
  const aiVertPercent = rail.ai_vertical_percent ?? 30

  const rawBody = node.body ?? ''

  // Extract plain text from body for word count
  const plainText = rawBody.replace(/[*_~`#>\-\[\]!]/g, '').trim()
  const wordCount = plainText.trim()
    ? plainText.trim().split(/\s+/).length
    : 0
  const updatedLabel = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(node.updated_at))
  const titleEyebrow = dailyDate
    ? t('tree.today')
    : t('workspace.documentBadge', { defaultValue: 'Document' })

  // Auto-resize title textarea
  const resizeTitleArea = useCallback(() => {
    const el = titleAreaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useEffect(() => {
    resizeTitleArea()
  }, [title, resizeTitleArea])

  // Sync when navigating to a different node. DocumentView keys <DocumentEditor>
  // by node.id, so MDXEditorView remounts with `markdown={rawBody}` on its own —
  // no explicit setMarkdown needed here (Finding 2 in the audit).
  useEffect(() => {
    setTitle(node.name)
    setSaveState('saved')
    lastLocalBodyRef.current = node.body ?? ''
  }, [node.id])

  useEffect(() => {
    latestPropsRef.current = node.properties
  }, [node.properties])

  // Live body mirror for EXTERNAL mutations (transcription append, etc.).
  // Self-echo guard (Finding 1): when our own autosave roundtrip bounces
  // `node.body` back, `lastLocalBodyRef` already matches — skip, preserve
  // in-flight keystrokes. External pushes (ref stale) fall through and
  // replace editor content.
  useEffect(() => {
    const raw = node.body ?? ''
    if (raw === lastLocalBodyRef.current) return
    const current = editorRef.current?.getMarkdown() ?? ''
    const currentNorm = stripLegacyVoiceMemoAudioLine(current)
    if (raw !== currentNorm) {
      editorRef.current?.setMarkdown(raw)
    }
    lastLocalBodyRef.current = raw
  }, [node.body])

  const handleSave = useCallback(
    async (content: string) => {
      const toPersist = stripLegacyVoiceMemoAudioLine(content)
      const nextTitle = deriveNoteTitle(titleRef.current, 'Untitled')
      setIsSaving(true)
      try {
        await updateNode(
          node.id,
          nextTitle,
          node.icon,
          latestPropsRef.current,
          toPersist,
        )
        setSaveState('saved')
      } catch (e) {
        setSaveState('error')
        toast.error(
          t('workspace.saveFailed', { defaultValue: 'Could not save page' }),
          { description: e instanceof Error ? e.message : String(e) },
        )
      } finally {
        setIsSaving(false)
      }
    },
    [node.id, node.icon, t, updateNode],
  )

  const patchRail = useCallback(
    async (patch: Partial<SidenoteRailPersisted>) => {
      const merged = mergeSidenoteRailIntoProperties(latestPropsRef.current, patch)
      latestPropsRef.current = merged
      const nextTitle = deriveNoteTitle(titleRef.current, 'Untitled')
      const raw = editorRef.current?.getMarkdown() ?? ''
      const body = stripLegacyVoiceMemoAudioLine(raw)
      await updateNode(node.id, nextTitle, node.icon, merged, body)
    },
    [node.id, node.icon, updateNode],
  )

  const patchTags = useCallback(
    async (nextTags: string[]) => {
      const merged = mergeTagsIntoProperties(latestPropsRef.current, nextTags)
      latestPropsRef.current = merged
      const nextTitle = deriveNoteTitle(titleRef.current, 'Untitled')
      const raw = editorRef.current?.getMarkdown() ?? ''
      const body = stripLegacyVoiceMemoAudioLine(raw)
      await updateNode(node.id, nextTitle, node.icon, merged, body)
    },
    [node.id, node.icon, updateNode],
  )

  const toggleSidenotes = useCallback(() => {
    if (sidenoteOpen) {
      void patchRail({ collapsed: true })
    } else {
      void patchRail({
        collapsed: false,
        width_percent: rail.width_percent ?? 32,
        ai_vertical_percent: rail.ai_vertical_percent ?? 30,
      })
    }
  }, [sidenoteOpen, patchRail, rail.width_percent, rail.ai_vertical_percent])

  const schedulePersistOuterLayout = useCallback(
    (sizes: number[]) => {
      if (sizes.length < 2) return
      const rightPct = Math.round(sizes[1])
      if (layoutOuterTimeoutRef.current !== null) window.clearTimeout(layoutOuterTimeoutRef.current)
      layoutOuterTimeoutRef.current = window.setTimeout(() => {
        layoutOuterTimeoutRef.current = null
        void patchRail({ width_percent: rightPct })
      }, 350)
    },
    [patchRail],
  )

  const schedulePersistInnerLayout = useCallback(
    (sizes: number[]) => {
      if (sizes.length < 2) return
      const bottomPct = Math.round(sizes[1])
      if (layoutInnerTimeoutRef.current !== null) window.clearTimeout(layoutInnerTimeoutRef.current)
      layoutInnerTimeoutRef.current = window.setTimeout(() => {
        layoutInnerTimeoutRef.current = null
        void patchRail({ ai_vertical_percent: bottomPct })
      }, 350)
    },
    [patchRail],
  )

  const handleSaveRef = useRef(handleSave)
  handleSaveRef.current = handleSave

  // MDXEditorView calls onChange(markdown). We use that to keep the self-echo
  // ref up-to-date (stripped form — what we actually persist) BEFORE the
  // debounce fires, so any intermediate body-change effect during the window
  // compares against the latest local value, not a stale one.
  const scheduleAutoSave = useCallback((markdown?: string) => {
    if (typeof markdown === 'string') {
      lastLocalBodyRef.current = stripLegacyVoiceMemoAudioLine(markdown)
    }
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = window.setTimeout(() => {
      saveTimeoutRef.current = null
      const raw = editorRef.current?.getMarkdown() ?? ''
      void handleSave(raw)
    }, 300)
  }, [handleSave])

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (saveTimeoutRef.current !== null) {
          window.clearTimeout(saveTimeoutRef.current)
          saveTimeoutRef.current = null
        }
        const raw = editorRef.current?.getMarkdown() ?? ''
        void handleSave(raw)
      }
    }
    document.addEventListener('keydown', handleSaveShortcut)
    return () => {
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current)
      }
      document.removeEventListener('keydown', handleSaveShortcut)
    }
  }, [handleSave])

  // Flush debounced save before unmount / node switch (after keyboard effect so cleanup runs first).
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
        const raw = editorRef.current?.getMarkdown() ?? ''
        void handleSaveRef.current(raw)
      }
    }
  }, [node.id])

  // Register this editor's flush-pending-save hook so `workspaceStore.navigateTo`
  // / `goBack` can await persistence BEFORE swapping `activeNode`. Prevents the
  // "type fast, switch note, lose last chunk" race (Finding 5 in the audit).
  useEffect(() => {
    const flush = (): Promise<void> | void => {
      if (saveTimeoutRef.current === null) return
      window.clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
      const raw = editorRef.current?.getMarkdown() ?? ''
      return handleSaveRef.current(raw)
    }
    registerActiveEditorFlush(flush)
    return () => registerActiveEditorFlush(null)
  }, [])

  const mainScroll = (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        padding: `24px ${EDITOR_SCROLL_PADDING_X_PX}px 96px`,
        background: 'transparent',
      }}
    >
      <div
        className="workspace-paper-surface workspace-note-surface"
        style={{
          maxWidth: 'var(--workspace-editor-max-width)',
          margin: '0 auto',
          padding: '42px 48px 64px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 16,
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '.14em',
            color: 'var(--workspace-text-soft)',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          <span>{titleEyebrow}</span>
          <span
            style={{
              width: 4,
              height: 4,
              borderRadius: 999,
              background: 'rgba(60, 50, 45, 0.42)',
            }}
          />
          <span>{t('workspace.draftBadge', { defaultValue: 'Draft' })}</span>
        </div>
        <textarea
          ref={titleAreaRef}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            scheduleAutoSave()
          }}
          placeholder="Untitled"
          rows={1}
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            resize: 'none',
            padding: 0,
            margin: 0,
            display: 'block',
            color: 'var(--workspace-text)',
            fontSize: 44,
            fontWeight: 500,
            fontFamily: 'Georgia, Iowan Old Style, Times New Roman, serif',
            letterSpacing: '-0.04em',
            lineHeight: 1.08,
            overflow: 'hidden',
          }}
        />
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            marginTop: 14,
            marginBottom: 14,
          }}
        >
          <span className="workspace-pill">
            {t('workspace.pillUpdated', { date: updatedLabel })}
          </span>
          <span className="workspace-pill">
            {t('workspace.pillWords', { count: wordCount })}
          </span>
          {voiceMemoMirror && (
            <span className="workspace-pill" title={t('notes.voiceMemo.recordedTitle')}>
              {t('notes.voiceMemo.recordedAt', {
                at: formatVoiceMemoRecordedAt(
                  voiceMemoMirror.recordedAtMs > 0
                    ? voiceMemoMirror.recordedAtMs
                    : node.created_at * 1000,
                ),
              })}
            </span>
          )}
        </div>
        <WorkspaceDocumentTags
          tags={documentTags}
          disabled={isSaving}
          onCommit={patchTags}
        />
        <div
          style={{
            height: 1,
            background: 'rgba(28, 28, 25, 0.06)',
            margin: '20px 0 24px',
          }}
        />
        <MDXEditorView
          ref={editorRef}
          markdown={rawBody}
          onChange={scheduleAutoSave}
          className="mdx-shell"
        />
        <ChildrenSection parentId={node.id} />
        <BacklinksSection targetId={node.id} />
      </div>
    </div>
  )

  const aiPanel = (
    <div
      style={{
        height: '100%',
        minHeight: 0,
        width: '100%',
        borderLeft: '1px solid var(--workspace-border)',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.52), rgba(255,255,255,0)), var(--surface-2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--workspace-text-muted)',
        fontSize: 13,
      }}
    >
      {t('workspace.aiPlaceholder')}
    </div>
  )

  return (
    <div
      className="flex-1 min-h-0 min-w-0 h-full flex flex-col note-editor-wrapper"
      style={{ background: 'var(--editor-bg)' }}
    >
      {/* Slim top bar */}
      <div
      style={{
        height: 36,
        flexShrink: 0,
        display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        padding: '0 18px',
        borderBottom: '1px solid var(--workspace-border)',
        background: 'var(--workspace-note-topbar-bg)',
        backdropFilter: 'blur(var(--workspace-panel-blur))',
        boxShadow: 'inset 0 -1px 0 rgba(255,255,255,0.45)',
      }}
    >
        {/* Breadcrumb */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11.5,
            color: 'var(--workspace-text-soft)',
            fontFamily: 'Inter, sans-serif',
            userSelect: 'none',
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <button
            type="button"
            aria-label={t('navigation.back')}
            style={{
              width: 22,
              height: 22,
              display: 'grid',
              placeItems: 'center',
              border: 'none',
              borderRadius: 6,
              background: 'transparent',
              color: 'var(--workspace-text-soft)',
              padding: 0,
              cursor: 'default',
            }}
          >
            <ChevronLeft size={13} strokeWidth={1.8} />
          </button>
          {dailyDate ? (
            <>
              {isToday ? (
                <span
                  style={{
                    flexShrink: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    color: 'var(--workspace-text-soft)',
                  }}
                >
                  <CalendarDays size={14} strokeWidth={2} aria-hidden style={{ flexShrink: 0, opacity: 0.95 }} />
                  {t('tree.today')}
                </span>
              ) : (
                <span style={{ flexShrink: 0 }}>{dailyDate}</span>
              )}
              {!isToday && (
                <>
                  <ChevronRight size={9} style={{ flexShrink: 0 }} />
                  <span
                    style={{
                      color: 'var(--workspace-text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {title || 'Untitled'}
                  </span>
                </>
              )}
            </>
          ) : (
            <>
              <span style={{ flexShrink: 0 }}>{t('workspace.title')}</span>
              <ChevronRight size={9} style={{ flexShrink: 0 }} />
              <span
                style={{
                  color: 'var(--workspace-text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {title || 'Untitled'}
              </span>
            </>
          )}
        </div>

        {/* Save status + AI toggle */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontFamily: 'Inter, sans-serif',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color: isSaving
                ? 'var(--workspace-text-soft)'
                : saveState === 'error'
                  ? 'var(--workspace-accent)'
                  : 'var(--workspace-accent-secondary)',
            }}
          >
            {isSaving ? (
              <>
                <LoaderCircle size={10} className="animate-spin" />
                {t('workspace.saving', { defaultValue: 'Saving…' })}
              </>
            ) : saveState === 'error' ? (
              <>
                <AlertCircle size={10} aria-hidden />
                {t('workspace.saveFailedShort', { defaultValue: 'Save failed' })}
              </>
            ) : (
              <>
                <Check size={10} aria-hidden />
                {t('workspace.saved', { defaultValue: 'Saved' })}
              </>
            )}
          </span>

          <button
            type="button"
            aria-label={t('workspace.share', { defaultValue: 'Share' })}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              height: 24,
              padding: '0 8px',
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              color: 'var(--workspace-text-muted)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            <Share2 size={12} strokeWidth={1.8} />
            {t('workspace.share', { defaultValue: 'Share' })}
          </button>

          <button
            type="button"
            aria-label={t('workspace.sidenotes.toggleAria')}
            title={t('workspace.sidenotes.toggleTitle')}
            aria-pressed={sidenoteOpen}
            onClick={() => void toggleSidenotes()}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              background: sidenoteOpen ? 'rgba(183,35,1,.1)' : 'transparent',
              border: '1px solid',
              borderColor: sidenoteOpen
                ? 'rgba(183,35,1,.25)'
                : 'rgba(143,112,105,.2)',
              borderRadius: 999,
              cursor: 'pointer',
              color: sidenoteOpen ? 'var(--workspace-accent)' : 'var(--workspace-text-muted)',
              padding: 0,
              transition: 'background 120ms, color 120ms, border-color 120ms',
            }}
          >
            <PanelRightOpen size={13} strokeWidth={2} />
          </button>

          <button
            type="button"
            onClick={() => setIsAiOpen((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              minWidth: 24,
              height: 24,
              padding: '0 8px',
              background: isAiOpen ? 'rgba(183,35,1,.1)' : 'transparent',
              border: '1px solid',
              borderColor: isAiOpen
                ? 'rgba(183,35,1,.25)'
                : 'rgba(143,112,105,.2)',
              borderRadius: 999,
              cursor: 'pointer',
              color: isAiOpen
                ? 'var(--workspace-accent)'
                : 'var(--workspace-text-muted)',
              transition: 'background 120ms, color 120ms, border-color 120ms',
            }}
          >
            <Sparkles size={13} />
            <span style={{ fontSize: 12 }}>{t('workspace.ask', { defaultValue: 'Ask' })}</span>
          </button>

          <button
            type="button"
            aria-label={t('common.more', { defaultValue: 'More' })}
            style={{
              width: 24,
              height: 24,
              display: 'grid',
              placeItems: 'center',
              border: 'none',
              background: 'transparent',
              color: 'var(--workspace-text-muted)',
              padding: 0,
              cursor: 'pointer',
            }}
          >
            <Ellipsis size={14} />
          </button>
        </div>
      </div>

      {/* Content row: main + optional resizable sidenote / AI stack */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        {sidenoteOpen || isAiOpen ? (
          <PanelGroup
            direction="horizontal"
            style={{ flex: 1, minHeight: 0, minWidth: 0 }}
            onLayout={schedulePersistOuterLayout}
          >
            <Panel defaultSize={100 - widthPercent} minSize={42}>
              {mainScroll}
            </Panel>
            <PanelResizeHandle
              style={{
                width: 5,
                flexShrink: 0,
                background: 'var(--workspace-border)',
                cursor: 'col-resize',
              }}
            />
            <Panel defaultSize={widthPercent} minSize={18} style={{ minWidth: 0 }}>
              {sidenoteOpen && isAiOpen ? (
                <PanelGroup
                  direction="vertical"
                  style={{ height: '100%', minHeight: 0 }}
                  onLayout={schedulePersistInnerLayout}
                >
                  <Panel defaultSize={100 - aiVertPercent} minSize={38}>
                    <SidenoteRail parentNode={node} patchRail={patchRail} />
                  </Panel>
                  <PanelResizeHandle
                    style={{
                      height: 5,
                      flexShrink: 0,
                      background: 'var(--workspace-border)',
                      cursor: 'row-resize',
                    }}
                  />
                  <Panel defaultSize={aiVertPercent} minSize={14}>
                    {aiPanel}
                  </Panel>
                </PanelGroup>
              ) : sidenoteOpen ? (
                <SidenoteRail parentNode={node} patchRail={patchRail} />
              ) : (
                aiPanel
              )}
            </Panel>
          </PanelGroup>
        ) : (
          mainScroll
        )}
      </div>
    </div>
  )
}

// ─── View components ─────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flex: 1,
      minHeight: 0,
      width: '100%',
      opacity: 0.4,
      fontSize: 14,
    }}>
      {message}
    </div>
  )
}

function DocumentView({ node }: { node: WorkspaceNode }) {
  return <DocumentEditor key={node.id} node={node} />
}

function DatabaseView({ node }: { node: WorkspaceNode }) {
  return <DatabaseShell node={node} />
}

function RowView({ node }: { node: WorkspaceNode }) {
  const { t } = useTranslation()
  const [databaseNode, setDatabaseNode] = useState<WorkspaceNode | null>(null)

  // Load parent database for field definitions without mutating workspace activeNode (row must stay selected).
  useEffect(() => {
    if (!node.parent_id) {
      setDatabaseNode(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const parent = await invoke<WorkspaceNode | null>('get_node', { id: node.parent_id })
        if (cancelled) return
        if (parent?.node_type === 'database') {
          setDatabaseNode(parent)
        } else {
          setDatabaseNode(null)
          toast.error(
            parent
              ? t('workspace.rowParentNotDatabase', {
                  defaultValue: 'Could not open this row: its parent is not a database.',
                })
              : t('workspace.rowParentMissing', { defaultValue: 'Could not load the database for this row.' }),
          )
        }
      } catch (e) {
        if (!cancelled) {
          setDatabaseNode(null)
          toast.error(String(e))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [node.parent_id, node.id, t])

  if (!databaseNode) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--workspace-text-muted)',
        fontSize: 13,
      }}>
        Loading...
      </div>
    )
  }

  return <RowPageView key={node.id} rowNode={node} databaseNode={databaseNode} />
}

interface WorkspaceLayoutProps {
  /** If provided, load and display this node on mount instead of showing empty state */
  nodeId?: string
  /**
   * Declared surface (notes | databases). Informs which tree filter /
   * empty-state copy to show when no node is loaded. When a specific
   * `nodeId` is provided, the active node's own `node_type` still wins
   * for internal branching — this prop is a presentation hint, not a
   * routing override.
   */
  mode?: 'notes' | 'databases'
}

export function WorkspaceLayout({ nodeId, mode: _mode }: WorkspaceLayoutProps) {
  // Granular selectors — avoid re-rendering on unrelated store changes
  // (CLAUDE.md Rule 4).
  const activeNode = useWorkspaceStore((s) => s.activeNode)
  const loadNode = useWorkspaceStore((s) => s.loadNode)
  const focusRefreshActiveNode = useWorkspaceStore((s) => s.focusRefreshActiveNode)
  const { t } = useTranslation()

  // Track previous node for back navigation restoration
  const prevNodeRef = useRef<WorkspaceNode | null>(null)

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = async (event: PopStateEvent) => {
      if (event.state?.type === 'workspace-nav') {
        const { nodeId: prevNodeId } = event.state
        if (prevNodeId) {
          const loadedNode = await loadNode(prevNodeId)
          // Update prevNodeRef to the loaded node so subsequent forward navigation
          // uses the correct previous node
          if (loadedNode) {
            prevNodeRef.current = loadedNode
          }
        }
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [loadNode])

  // Track activeNode changes to detect when we navigate to a row
  useEffect(() => {
    if (activeNode?.node_type === 'row' && prevNodeRef.current) {
      // When navigating to a row, push the previous (database) node to history
      const prevNode = prevNodeRef.current
      if (prevNode.id !== activeNode.id) {
        window.history.pushState(
          { type: 'workspace-nav', nodeId: prevNode.id },
          '',
          ''
        )
      }
    } else if (activeNode && activeNode.node_type !== 'row') {
      // Update the previous node ref when we're at a database or document view
      prevNodeRef.current = activeNode
    }
  }, [activeNode])

  useEffect(() => {
    if (nodeId) {
      void loadNode(nodeId)
    }
  }, [nodeId])

  // window:focus re-fetch — catches external edits while the doc is open
  // (CLAUDE.md Rule 14 replacement: no watcher, pull on focus instead).
  //
  // ─── INVARIANT — load-bearing for correctness ───────────────────────────
  // The ordering below MUST stay strictly sequential:
  //
  //   1. flushActiveEditor()       keystrokes → DB + vault written
  //   2. focusRefreshActiveNode()  get_node mtime check, pulls disk body
  //   3. if body changed → push to editor + toast
  //      if body unchanged → no-op (flush already won)
  //
  // DO NOT:
  //   • Reorder (refresh before flush) — the refresh would push on-disk body
  //     to the editor BEFORE the pending autosave lands, so the subsequent
  //     autosave commits stale content, silently reverting the user's last
  //     keystrokes.
  //   • Parallelise (Promise.all) — same race: autosave may land after the
  //     refresh has already overwritten the editor with disk content.
  //
  // Rationale: the user may have typed in Infield, alt-tabbed to another
  // app (maybe their editor), and come back. Any in-flight keystrokes must
  // be persisted before we let disk mtime be authoritative.  If the flush
  // fails with VAULT_CONFLICT, the user's draft is preserved and the
  // conflict handler takes over — still safe.
  // ────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const handleFocus = async () => {
      await flushActiveEditor()
      const changed = await focusRefreshActiveNode()
      if (changed) {
        toast.info(t('workspace.refreshedFromDisk', { defaultValue: 'Refreshed from disk' }))
      }
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [focusRefreshActiveNode, t])

  if (!activeNode) {
    return (
      <div className="flex-1 min-h-0 w-full flex flex-col">
        <EmptyState message={nodeId ? "Loading…" : "Select a page from the sidebar"} />
      </div>
    )
  }

  const main = (() => {
    switch (activeNode.node_type) {
      case 'document':
        return <DocumentView node={activeNode} />
      case 'database':
        return <DatabaseView node={activeNode} />
      case 'row':
        return <RowView node={activeNode} />
      default:
        return <EmptyState message={`Unknown node type: ${activeNode.node_type}`} />
    }
  })()

  return (
    <div className="flex-1 min-h-0 w-full flex flex-col overflow-hidden">
      {main}
    </div>
  )
}
