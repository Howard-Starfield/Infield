/**
 * 3D lemniscate ribbon — the orb at the top of the LoadingScreen.
 *
 * Extracted into its own file (and isolated behind an error boundary in
 * `LoadingScreen.tsx`) so a WebGL init failure or a Three.js runtime error
 * falls back to 2D without crashing the entry flow.
 *
 * Colors come from CSS vars: we read `--on-surface` on mount (plain JS,
 * not inside render) and pass it to the material so that the material
 * doesn't recreate every frame.
 *
 * Geometry + animation match the HerOS_UI_Kit reference 1:1 — same curve
 * math, same tube + ring proportions, same progress-driven fade/spin.
 * Drag-to-spin is preserved so the orb responds to pointer drag exactly
 * like the kit.
 */
import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const TUBE_LENGTH = 30
const TUBE_RADIUS = 5.6
const ROTATE_BASE = 0.035
const TAU = Math.PI * 2

class LemniscateCurve extends THREE.Curve<THREE.Vector3> {
  constructor() {
    super()
  }
  override getPoint(p: number, out = new THREE.Vector3()) {
    const x = TUBE_LENGTH * Math.sin(TAU * p)
    const y = TUBE_RADIUS * Math.cos(TAU * 3 * p)
    let t = (p % 0.25) / 0.25
    t = (p % 0.25) - (2 * (1 - t) * t * -0.0185 + t * t * 0.25)
    if (Math.floor(p / 0.25) === 0 || Math.floor(p / 0.25) === 2) t *= -1
    const z = TUBE_RADIUS * Math.sin(TAU * 2 * (p - t))
    return out.set(x, y, z)
  }
}

function easeInOutQuad(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

/**
 * Resolve a CSS custom property to a concrete color at mount time. Returns
 * the fallback when the var isn't registered (ThemeProvider hasn't flushed
 * yet or we're in a test env).
 */
function readCssColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return raw || fallback
}

function Lemniscate({
  progress,
  dragVelocity,
}: {
  progress: number
  dragVelocity: React.RefObject<number>
}) {
  const groupRef = useRef<THREE.Group>(null)
  const tubeRef = useRef<THREE.Mesh>(null)
  const ringRef = useRef<THREE.Mesh>(null)

  const curve = useMemo(() => new LemniscateCurve(), [])
  const tubeGeo = useMemo(
    () => new THREE.TubeGeometry(curve, 512, 1.1, 2, true),
    [curve],
  )
  const ringGeo = useMemo(() => new THREE.RingGeometry(7, 8.5, 64), [])

  // Read color tokens ONCE at mount. If the user edits brand in the theme
  // editor mid-load, the existing orb keeps its color — fine, it's onscreen
  // for a second or two at most.
  //
  // Tube is cream-pink (`--heros-ribbon-cream`, #f0d8d0) to carry the
  // terracotta warmth into the ribbon — kit-exact. Ring is pure white
  // (`#ffffff` hardcoded in kit, not a token) for the frosted-glass
  // overlay effect during collapse phase.
  const tubeColor = useMemo(
    () => readCssColor('--heros-ribbon-cream', '#f0d8d0'),
    [],
  )
  const ringColor = useMemo(() => readCssColor('--on-surface', '#ffffff'), [])

  useFrame(() => {
    const tube = tubeRef.current
    const ring = ringRef.current
    if (!tube || !ring) return

    // The last 15% of progress is the "collapse" phase: the tube fades out,
    // the ring fades in. Below that, just spin steadily.
    const finalPhaseStart = 85
    const p =
      progress > finalPhaseStart
        ? Math.min(1, (progress - finalPhaseStart) / (100 - finalPhaseStart))
        : 0

    const fastSpin = Math.pow(p, 4) * 0.8
    const dragSpin = dragVelocity.current * 0.005
    dragVelocity.current *= 0.92
    tube.rotation.x += ROTATE_BASE + fastSpin + dragSpin

    // Ribbon → ring crossfade (overlapping on purpose so the scene
    // never reads as "empty" mid-transition):
    //
    //   p 0.0 ─ tube 1.0, ring 0.0
    //   p 0.3 ─ tube ~0.5, ring starts fading in
    //   p 0.6 ─ tube 0.0, ring ~0.43 (peak 0.4 reached shortly after)
    //   p 1.0 ─ tube 0.0, ring 0.4 (steady)
    //
    // The two curves overlap between p=0.3 and p=0.6 so there's always
    // something luminous on screen during the collapse phase.
    const tubeFade = Math.min(1, p * 1.7)
    const tubeMat = tube.material as THREE.MeshBasicMaterial
    tubeMat.opacity = 1 - easeInOutQuad(tubeFade)
    tube.visible = tubeMat.opacity > 0.001

    const ringFade = Math.max(0, (p - 0.3) / 0.7)
    ring.visible = ringFade > 0
    if (ring.visible) {
      const ringMat = ring.material as THREE.MeshBasicMaterial
      ringMat.opacity = easeInOutQuad(ringFade) * 0.4
      ring.scale.setScalar(0.9 + 0.1 * ringFade)
    }
  })

  return (
    // Group lifted +14 in world-space Y so the ribbon clears the
    // progress bar + wordmark block in the lower third. Matches the
    // kit's `groupRef.current.position.y = 14` setter (which was
    // re-applied every frame; static declaration is equivalent because
    // nothing else mutates the Y).
    <group ref={groupRef} position={[0, 14, 0]}>
      <mesh ref={tubeRef} geometry={tubeGeo}>
        <meshBasicMaterial
          color={tubeColor}
          transparent
          opacity={1}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh ref={ringRef} geometry={ringGeo}>
        <meshBasicMaterial
          color={ringColor}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  )
}

export interface LemniscateOrbProps {
  /** 0..100. Drives the final-phase tube→ring transition. */
  progress: number
}

export function LemniscateOrb({ progress }: LemniscateOrbProps) {
  // Pointer-drag state — same as the HerOS kit: vertical drag adds impulse
  // to the ribbon rotation, velocity decays over time. Refs (not state) so
  // every frame reads the latest value without causing React re-renders.
  const isDragging = useRef(false)
  const previousY = useRef(0)
  const dragVelocity = useRef(0)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    isDragging.current = true
    previousY.current = e.clientY
    dragVelocity.current = 0
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return
    const deltaY = e.clientY - previousY.current
    dragVelocity.current = deltaY
    previousY.current = e.clientY
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    isDragging.current = false
    try {
      ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
    } catch {
      /* pointer may already be released */
    }
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      style={{
        width: '100%',
        height: '100%',
        touchAction: 'none',
        cursor: 'grab',
      }}
    >
      <Canvas
        camera={{ fov: 65, position: [0, 0, 150] }}
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: true,
          toneMapping: THREE.NoToneMapping,
          outputColorSpace: THREE.SRGBColorSpace,
          precision: 'highp',
        }}
      >
        <Lemniscate progress={progress} dragVelocity={dragVelocity} />
      </Canvas>
    </div>
  )
}
