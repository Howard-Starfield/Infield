import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view'
import { convertFileSrc } from '@tauri-apps/api/core'
import { pathsExist } from '../utils/pathsExist'

export interface VoiceMemoDirective {
  path: string | null
  recordedAtMs: number | null
  from: number
  to: number
}

const MARKER = '::voice_memo_recording'

/**
 * Parse all `::voice_memo_recording{…}` directives from a string.
 *
 * Primary format: `::voice_memo_recording{path="<abs path>"}`.
 * Backward-compat: accepts JSON-shape metadata with `audio_file_path`
 * and `recorded_at_ms` keys.
 *
 * Returns directives in document order with absolute offsets; used by
 * both the CM6 decoration plugin and unit tests.
 */
export function parseVoiceMemoDirectives(body: string): VoiceMemoDirective[] {
  const out: VoiceMemoDirective[] = []
  let cursor = 0
  while (cursor <= body.length - MARKER.length) {
    const idx = body.indexOf(MARKER, cursor)
    if (idx === -1) break
    const closeIdx = body.indexOf('}', idx + MARKER.length)
    if (closeIdx === -1) break

    const metaRaw = body.slice(idx + MARKER.length, closeIdx + 1)
    const inner = metaRaw.slice(1, -1).trim()

    let path: string | null = null
    let recordedAtMs: number | null = null

    const pathMatch = inner.match(/path\s*=\s*"([^"]*)"/)
    if (pathMatch) path = pathMatch[1].length > 0 ? pathMatch[1] : null

    if (path === null && (inner.startsWith('"') || inner.startsWith('{'))) {
      try {
        const meta = JSON.parse(metaRaw)
        if (typeof meta?.audio_file_path === 'string') {
          path = meta.audio_file_path.length > 0 ? meta.audio_file_path : null
        }
        if (typeof meta?.recorded_at_ms === 'number') {
          recordedAtMs = meta.recorded_at_ms
        }
      } catch {
        /* malformed JSON — already got path from regex */
      }
    }

    out.push({ path, recordedAtMs, from: idx, to: closeIdx + 1 })
    cursor = closeIdx + 1
  }
  return out
}

/**
 * CM6 widget rendering a play button + path label for a voice-memo
 * directive. Implements no-audio / loading / playing / unavailable
 * states matching AudioView's PlayButton visual treatment.
 */
class VoiceMemoWidget extends WidgetType {
  constructor(private directive: VoiceMemoDirective) {
    super()
  }

  eq(other: VoiceMemoWidget): boolean {
    return (
      this.directive.path === other.directive.path &&
      this.directive.recordedAtMs === other.directive.recordedAtMs
    )
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'voice-memo-pill'
    wrap.dataset.path = this.directive.path ?? ''
    wrap.dataset.state = this.directive.path ? 'idle' : 'no-audio'

    const icon = document.createElement('span')
    icon.className = 'voice-memo-pill__icon'
    icon.textContent = this.directive.path ? '▶' : '🔇'
    wrap.appendChild(icon)

    const label = document.createElement('span')
    label.className = 'voice-memo-pill__label'
    label.textContent = this.directive.path
      ? 'Voice memo'
      : 'No audio'
    wrap.appendChild(label)

    return wrap
  }

  ignoreEvent(): boolean {
    return false
  }
}

/**
 * ViewPlugin that decorates every `::voice_memo_recording{…}` directive
 * in the doc with a widget. Re-runs on doc change. Registers a click
 * handler on the plugin's view root to toggle playback on the singleton
 * audio element.
 */
export function voiceMemoPillPlugin() {
  let audio: HTMLAudioElement | null = null
  let playingPath: string | null = null
  const unavailablePaths = new Set<string>()

  const buildDecorations = (view: EditorView): DecorationSet => {
    const body = view.state.doc.toString()
    const dirs = parseVoiceMemoDirectives(body)
    const widgets = dirs.map((d) =>
      Decoration.replace({
        widget: new VoiceMemoWidget(d),
        inclusive: false,
      }).range(d.from, d.to),
    )
    return Decoration.set(widgets, /* sort */ true)
  }

  const togglePlayback = (path: string, pill: HTMLElement) => {
    if (!path) return
    if (!audio) {
      audio = new Audio()
      audio.preload = 'auto'
    }
    if (playingPath === path) {
      audio.pause()
      pill.dataset.state = 'idle'
      playingPath = null
      return
    }
    // Different path — stop current, start new.
    audio.pause()
    audio.removeAttribute('src')
    pill.dataset.state = 'loading'
    try {
      audio.src = convertFileSrc(path)
      audio.onloadedmetadata = () => {
        pill.dataset.state = 'playing'
        playingPath = path
        void audio!.play().catch(() => {
          pill.dataset.state = 'unavailable'
          unavailablePaths.add(path)
        })
      }
      audio.onerror = () => {
        pill.dataset.state = 'unavailable'
        unavailablePaths.add(path)
        playingPath = null
      }
      audio.onended = () => {
        pill.dataset.state = 'idle'
        playingPath = null
      }
      audio.load()
    } catch {
      pill.dataset.state = 'unavailable'
      unavailablePaths.add(path)
    }
  }

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view)
        // Pre-seed unavailable state for already-missing files.
        const paths = parseVoiceMemoDirectives(view.state.doc.toString())
          .map((d) => d.path)
          .filter((p): p is string => !!p)
        void pathsExist(paths).then((found) => {
          for (const p of paths) {
            if (!found.has(p)) unavailablePaths.add(p)
          }
          // One-shot DOM pass: flip pills whose path is known-missing so the
          // first-click doesn't have to wait for audio.onerror to surface the
          // unavailable state. Widgets created later via docChanged will
          // consult unavailablePaths on their click-retry path.
          for (const pill of view.dom.querySelectorAll('.voice-memo-pill')) {
            const pillEl = pill as HTMLElement
            const p = pillEl.dataset.path
            if (p && unavailablePaths.has(p)) {
              pillEl.dataset.state = 'unavailable'
            }
          }
        })
      }

      update(u: ViewUpdate) {
        if (u.docChanged) {
          this.decorations = buildDecorations(u.view)
          // Decorations just got rebuilt — re-apply unavailable state to the
          // fresh DOM nodes on the next animation frame (CM6 paints the new
          // widgets synchronously during dispatch but the DOM may not be
          // attached until then).
          queueMicrotask(() => {
            for (const pill of u.view.dom.querySelectorAll('.voice-memo-pill')) {
              const pillEl = pill as HTMLElement
              const p = pillEl.dataset.path
              if (p && unavailablePaths.has(p)) {
                pillEl.dataset.state = 'unavailable'
              }
            }
          })
        }
      }

      destroy() {
        if (audio) {
          audio.pause()
          audio.onloadedmetadata = null
          audio.onerror = null
          audio.onended = null
          audio.removeAttribute('src')
          audio = null
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        click(ev, view) {
          const target = ev.target as HTMLElement
          const pill = target.closest('.voice-memo-pill') as HTMLElement | null
          if (!pill) return
          ev.preventDefault()
          const path = pill.dataset.path
          if (!path) return
          if (unavailablePaths.has(path)) {
            // Retry: clear unavailable and attempt to play again.
            unavailablePaths.delete(path)
          }
          togglePlayback(path, pill)
        },
      },
    },
  )
}
