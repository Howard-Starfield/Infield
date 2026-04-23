import { useEffect, useRef } from 'react'

/** Tracks last pointer position during an active board drag (for cross-`DndContext` hit-test on drag end). */
export function useBoardDragPointerTracking(active: boolean) {
  const boardPointerRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!active) {
      boardPointerRef.current = null
      return
    }
    const track = (e: PointerEvent) => {
      boardPointerRef.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('pointermove', track, true)
    window.addEventListener('pointerup', track, true)
    return () => {
      window.removeEventListener('pointermove', track, true)
      window.removeEventListener('pointerup', track, true)
    }
  }, [active])

  return boardPointerRef
}
