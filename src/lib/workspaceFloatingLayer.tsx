import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

/** Read z-index from CSS custom properties (set on :root in App.css). */
export function workspaceFloatingZ(): string {
  if (typeof document === 'undefined') return '12001'
  const v = getComputedStyle(document.documentElement).getPropertyValue('--workspace-floating-z').trim()
  return v || '12001'
}

export function workspaceFloatingBackdropZ(): string {
  if (typeof document === 'undefined') return '12000'
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue('--workspace-floating-backdrop-z')
    .trim()
  return v || '12000'
}

export function workspaceModalZ(): string {
  if (typeof document === 'undefined') return '12030'
  const v = getComputedStyle(document.documentElement).getPropertyValue('--workspace-modal-z').trim()
  return v || '12030'
}

export function workspaceTooltipZ(): string {
  if (typeof document === 'undefined') return '12060'
  const v = getComputedStyle(document.documentElement).getPropertyValue('--workspace-tooltip-z').trim()
  return v || '12060'
}

export type BelowAnchorOptions = {
  gap?: number
  /** Used for horizontal clamping. */
  menuWidth?: number
  /** If set, may flip menu above the anchor when it would overflow the viewport bottom. */
  menuHeight?: number
  viewportPadding?: number
}

/**
 * Fixed-position top/left for a menu placed preferentially just below `anchor`,
 * clamped horizontally; flips above when `menuHeight` is known and there is not enough room below.
 */
export function placeBelowAnchor(anchor: DOMRect, opts: BelowAnchorOptions = {}): { top: number; left: number } {
  const gap = opts.gap ?? 4
  const menuWidth = opts.menuWidth ?? 240
  const menuHeight = opts.menuHeight
  const pad = opts.viewportPadding ?? 8
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800

  let top = anchor.bottom + gap
  if (menuHeight != null && top + menuHeight > vh - pad) {
    const above = anchor.top - gap - menuHeight
    if (above >= pad) top = above
    else top = Math.max(pad, Math.min(top, vh - menuHeight - pad))
  }

  let left = anchor.left
  left = Math.max(pad, Math.min(left, vw - menuWidth - pad))
  return { top, left }
}

/** A fixed-position box (top-left + size) before clamping to the viewport. */
export type ViewportBox = {
  top: number
  left: number
  width: number
  height: number
}

/**
 * Clamps a fixed-position box so it stays fully inside the viewport (with padding).
 * Use after measuring a menu with `getBoundingClientRect()`.
 */
export function fitRectInViewport(
  rect: ViewportBox,
  viewportPadding = 8,
): { top: number; left: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const p = viewportPadding
  const left = Math.max(p, Math.min(rect.left, vw - rect.width - p))
  const top = Math.max(p, Math.min(rect.top, vh - rect.height - p))
  return { top, left }
}

export type PointerMenuOptions = {
  menuWidth: number
  menuHeight: number
  /** Gap from pointer to menu edge (default 4). */
  gap?: number
  viewportPadding?: number
}

/**
 * Top/left for a context-style menu opened at the pointer: prefers below the cursor,
 * flips above if there is not enough room, then clamps horizontally (same idea as `placeBelowAnchor`).
 *
 * @example
 * const { top, left } = placeMenuAtPointer(e.clientX, e.clientY, { menuWidth: 220, menuHeight: 240 })
 * // After paint: const r = ref.current.getBoundingClientRect()
 * // setPosition(fitRectInViewport({ top, left, width: r.width, height: r.height }))
 */
export function placeMenuAtPointer(
  clientX: number,
  clientY: number,
  opts: PointerMenuOptions,
): { top: number; left: number } {
  const gap = opts.gap ?? 4
  const w = opts.menuWidth
  const h = opts.menuHeight
  const pad = opts.viewportPadding ?? 8
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800

  let top = clientY + gap
  if (top + h > vh - pad) {
    const above = clientY - gap - h
    if (above >= pad) top = above
    else top = Math.max(pad, Math.min(top, vh - h - pad))
  }

  let left = clientX
  left = Math.max(pad, Math.min(left, vw - w - pad))
  return { top, left }
}

export function WorkspaceFloatingPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(children, document.body)
}
