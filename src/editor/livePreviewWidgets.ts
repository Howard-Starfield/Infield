import { EditorView, WidgetType } from '@codemirror/view'

/**
 * `TaskCheckboxWidget` replaces the `[ ]` or `[x]` source span with a
 * real <input type="checkbox">. Click toggles the source bytes via a
 * single user-event transaction so undo replays it as one step.
 */
export class TaskCheckboxWidget extends WidgetType {
  constructor(
    /** Whether the source is `[x]` (true) or `[ ]` (false). */
    readonly checked: boolean,
    /** Document offset of the `[` byte. */
    readonly from: number,
    /** Document offset one past the `]` byte. */
    readonly to: number,
  ) {
    super()
  }

  /** Same checked state + same range = identical widget; CM6 reuses
   *  the DOM. Without this, every caret move re-mounts the checkbox. */
  eq(other: TaskCheckboxWidget): boolean {
    return (
      this.checked === other.checked &&
      this.from === other.from &&
      this.to === other.to
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.className = 'cm-md-task-checkbox'
    input.checked = this.checked
    input.addEventListener('mousedown', (e) => {
      // Prevent the click from moving the caret into the widget range.
      e.preventDefault()
    })
    input.addEventListener('click', (e) => {
      e.preventDefault()
      const next = this.checked ? '[ ]' : '[x]'
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: next },
        userEvent: 'input.toggle',
      })
    })
    return input
  }

  /** Returning false routes pointer events through the editor's normal
   *  flow so our click handler fires. */
  ignoreEvent(): boolean {
    return false
  }
}

/**
 * `DividerWidget` replaces a `---` source line with a visual <hr>.
 */
export class DividerWidget extends WidgetType {
  eq(_other: DividerWidget): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const el = document.createElement('hr')
    el.className = 'cm-md-hr'
    return el
  }

  /** Static element — pointer events ignored entirely. */
  ignoreEvent(): boolean {
    return true
  }
}

/**
 * `PendingImageWidget` renders a spinner placeholder while a freshly pasted
 * image is being written to the vault. The source markdown reads
 * `![Saving image…](pending://<tempId>)`; the live-preview decorator detects
 * the `pending://` scheme and replaces the source span with this widget.
 *
 * Static — pointer events are ignored. The autosave plugin's `pending://`
 * substring guard keeps the placeholder text from being written to disk.
 */
export class PendingImageWidget extends WidgetType {
  constructor(readonly tempId: string) {
    super()
  }

  eq(other: PendingImageWidget): boolean {
    return this.tempId === other.tempId
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-md-image-pending'
    const spinner = document.createElement('span')
    spinner.className = 'cm-md-image-spinner'
    spinner.setAttribute('aria-label', 'Saving image')
    el.appendChild(spinner)
    return el
  }

  ignoreEvent(): boolean {
    return true
  }
}

/**
 * `ImageWidget` replaces a `![alt|w](path)` source span with a real <img>
 * element wrapped in a span carrying hover-revealed corner handles for
 * resizing. On pointer-up after a resize drag, the wrapper dispatches a CM6
 * transaction rewriting `widget.sourceFrom..sourceTo` with the new `|width`
 * value, persisting via autosave.
 *
 * `sourcePath` carries the original vault-relative path from the markdown
 * source so the resize handler can rewrite the source line without
 * round-tripping through the asset URL.
 */
export class ImageWidget extends WidgetType {
  constructor(
    /** Result of `convertFileSrc(absolutePath)` — Tauri asset:// scheme. */
    readonly absSrc: string,
    /** Alt text from the markdown source. May be empty. */
    readonly alt: string,
    /** Width from `|width` syntax, or null for natural size. */
    readonly width: number | null,
    /** Height from `|wxh` syntax, or null. */
    readonly height: number | null,
    /** Doc offset of the leading `!` in the source span. */
    readonly sourceFrom: number,
    /** Doc offset one past the closing `)` in the source span. */
    readonly sourceTo: number,
    /** Original vault-relative path from the markdown source. */
    readonly sourcePath: string,
  ) {
    super()
  }

  eq(other: ImageWidget): boolean {
    return (
      this.absSrc === other.absSrc &&
      this.alt === other.alt &&
      this.width === other.width &&
      this.height === other.height &&
      this.sourceFrom === other.sourceFrom &&
      this.sourceTo === other.sourceTo &&
      this.sourcePath === other.sourcePath
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-md-image-wrap'
    if (this.width != null) wrap.style.width = `${this.width}px`

    const img = document.createElement('img')
    img.className = 'cm-md-image'
    img.src = this.absSrc
    img.alt = this.alt
    img.setAttribute('loading', 'lazy')
    img.setAttribute('decoding', 'async')
    if (this.width != null) img.width = this.width
    if (this.height != null) img.height = this.height

    const handleR = makeResizeHandle('right', view, this)
    const handleBR = makeResizeHandle('bottom-right', view, this)

    wrap.appendChild(img)
    wrap.appendChild(handleR)
    wrap.appendChild(handleBR)
    return wrap
  }

  ignoreEvent(e: Event): boolean {
    if (
      e.target instanceof HTMLElement &&
      e.target.classList.contains('cm-md-image-handle')
    ) {
      return false
    }
    return true
  }
}

/**
 * Build a resize handle for an ImageWidget. On pointer-down it captures the
 * pointer; pointer-move applies a live width to the wrapper inline style
 * (no transactions during drag — keeps drag at 60fps); pointer-up dispatches
 * one CM6 transaction that rewrites the source span with the new width,
 * which autosave then persists.
 *
 * Note: if the source had `|wxh` (Obsidian dual-dimension form), the rewrite
 * drops the height. Aspect ratio is preserved by natural image dimensions.
 * Documented as expected behaviour, not a regression.
 */
function makeResizeHandle(
  variant: 'right' | 'bottom-right',
  view: EditorView,
  widget: ImageWidget,
): HTMLElement {
  const el = document.createElement('span')
  el.className = `cm-md-image-handle cm-md-image-handle--${variant}`

  const MIN_WIDTH = 80
  let active = false
  let startX = 0
  let startWidth = 0
  let wrapper: HTMLElement | null = null

  el.addEventListener('pointerdown', (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    wrapper = el.closest('.cm-md-image-wrap') as HTMLElement | null
    if (!wrapper) return
    active = true
    startX = e.clientX
    startWidth = wrapper.getBoundingClientRect().width
    el.setPointerCapture(e.pointerId)
  })

  el.addEventListener('pointermove', (e: PointerEvent) => {
    if (!active || !wrapper) return
    const delta = e.clientX - startX
    const editorWidth =
      wrapper.parentElement?.getBoundingClientRect().width ?? Infinity
    const newWidth = Math.max(
      MIN_WIDTH,
      Math.min(startWidth + delta, editorWidth),
    )
    wrapper.style.width = `${Math.round(newWidth)}px`
  })

  const finish = (e: PointerEvent) => {
    if (!active || !wrapper) return
    active = false
    try {
      el.releasePointerCapture(e.pointerId)
    } catch {
      // pointer already released
    }
    const newWidth = Math.round(wrapper.getBoundingClientRect().width)
    const insert = `![${widget.alt}|${newWidth}](${widget.sourcePath})`
    view.dispatch({
      changes: { from: widget.sourceFrom, to: widget.sourceTo, insert },
      userEvent: 'input.imageresize',
    })
  }
  el.addEventListener('pointerup', finish)
  el.addEventListener('pointercancel', finish)

  return el
}
