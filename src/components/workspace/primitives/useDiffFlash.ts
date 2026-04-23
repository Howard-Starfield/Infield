/**
 * useDiffFlash — trigger a 900ms amber pulse on an element after a value
 * changes. Pure utility; no state coupling, no render pressure.
 *
 * Usage:
 *   const ref = useDiffFlash(cellValue)
 *   return <td ref={ref}>{cellValue}</td>
 *
 * The flash only fires on UPDATE, not initial mount. That's deliberate —
 * flashing every cell on page render would be a seizure-inducing strobe.
 *
 * Animation lives in `src/theme/semantic.css → @keyframes infield-diff-flash`.
 * The class removes itself on `animationend`, so a second edit re-triggers
 * cleanly without ref juggling.
 */

import { useEffect, useRef } from 'react'

export function useDiffFlash<T>(value: T): React.RefObject<HTMLElement | null> {
  const ref = useRef<HTMLElement | null>(null)
  const firstMount = useRef(true)
  const prev = useRef(value)

  useEffect(() => {
    if (firstMount.current) {
      firstMount.current = false
      prev.current = value
      return
    }
    // Shallow-equal guard — don't flash when reference changes but content doesn't
    if (Object.is(prev.current, value)) return
    prev.current = value

    const el = ref.current
    if (!el) return

    // Re-apply the class even if it's already present (for rapid consecutive edits)
    el.classList.remove('infield-diff-flash')
    // Force reflow so the animation restarts
    void el.offsetWidth
    el.classList.add('infield-diff-flash')

    const onEnd = () => {
      el.classList.remove('infield-diff-flash')
      el.removeEventListener('animationend', onEnd)
    }
    el.addEventListener('animationend', onEnd)
    return () => {
      el.removeEventListener('animationend', onEnd)
    }
  }, [value])

  return ref
}
