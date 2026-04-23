import React, { useEffect, useState, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';

/**
 * OS1 Advanced 3D Loading Screen - High Fidelity
 * Optimized to remove banding and artifacts.
 */

const TUBE_LENGTH = 30;
const TUBE_RADIUS = 5.6;
const ROTATE_BASE = 0.035;
const pi2 = Math.PI * 2;
const BG_COLOR = '#cc4c2b'; 
const TUBE_COLOR = '#f0d8d0';

class LemniscateCurve extends THREE.Curve<THREE.Vector3> {
  getPoint(percent: number, optionalTarget = new THREE.Vector3()) {
    const x = TUBE_LENGTH * Math.sin(pi2 * percent);
    const y = TUBE_RADIUS * Math.cos(pi2 * 3 * percent);
    let t = (percent % 0.25) / 0.25;
    t = (percent % 0.25) - (2 * (1 - t) * t * -0.0185 + t * t * 0.25);
    if (Math.floor(percent / 0.25) === 0 || Math.floor(percent / 0.25) === 2) t *= -1;
    const z = TUBE_RADIUS * Math.sin(pi2 * 2 * (percent - t));
    return optionalTarget.set(x, y, z);
  }
}

function easeInOut(t: number, b: number, c: number, d: number) {
  if ((t /= d / 2) < 1) return (c / 2) * t * t + b;
  return (c / 2) * ((t -= 2) * t * t + 2) + b;
}

function Logo3D({ progress, dragVelocity }: { progress: number, dragVelocity: React.MutableRefObject<number> }) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  const curve = useMemo(() => new LemniscateCurve(), []);
  const tubeGeo = useMemo(() => new THREE.TubeGeometry(curve, 512, 1.1, 2, true), [curve]);
  
  // Reduced size to prevent overlap with the progress bar below
  const ringGeo = useMemo(() => new THREE.RingGeometry(7, 8.5, 64), []);

  useFrame(() => {
    if (!groupRef.current || !meshRef.current || !ringRef.current) return;

    const finalPhaseStart = 85;
    let p = 0; 
    if (progress > finalPhaseStart) {
      p = Math.min(1, (progress - finalPhaseStart) / (100 - finalPhaseStart));
    }

    const fastSpin = Math.pow(p, 4) * 0.8; 
    const dragSpin = dragVelocity.current * 0.005;
    dragVelocity.current *= 0.92; 

    meshRef.current.rotation.x += ROTATE_BASE + dragSpin + fastSpin;
    groupRef.current.position.y = 14; 

    const ribbonFadeP = Math.min(1, p * 2.5); 
    const ringFadeP = Math.max(0, (p - 0.4) / 0.6); 
    
    ringRef.current.visible = false;

    if (ribbonFadeP >= 1) {
      meshRef.current.visible = false;
    } else {
      meshRef.current.visible = true;
      (meshRef.current.material as THREE.MeshBasicMaterial).opacity = 1 - easeInOut(ribbonFadeP, 0, 1, 1);
    }
  });

  return (
    <group ref={groupRef} position={[0, 14, 0]}>
      <mesh ref={meshRef} geometry={tubeGeo}>
        <meshBasicMaterial color={TUBE_COLOR} transparent opacity={1} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ringRef} geometry={ringGeo} position={[0, 0, 0]}>
        {/* Changed to pure white for the frosted glass overlay effect */}
        <meshBasicMaterial color="#ffffff" transparent opacity={0} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

export default function LoadingScreen() {
  const [progress, setProgress] = useState(0);
  
  // Drag state
  const isDragging = useRef(false);
  const previousY = useRef(0);
  const dragVelocity = useRef(0);

  useEffect(() => {
    const duration = 2500;
    const interval = 50;
    const increment = 100 / (duration / interval);
    const timer = setInterval(() => {
      setProgress(prev => (prev >= 100 ? 100 : prev + increment));
    }, interval);
    return () => clearInterval(timer);
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    isDragging.current = true;
    previousY.current = e.clientY;
    dragVelocity.current = 0;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const deltaY = e.clientY - previousY.current;
    dragVelocity.current = deltaY;
    previousY.current = e.clientY;
  };

  const handlePointerUp = () => {
    isDragging.current = false;
  };

  return (
    <div 
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      style={{ 
        height: '100vh', 
        width: '100vw', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        color: '#fff',
        cursor: isDragging.current ? 'grabbing' : 'grab',
        touchAction: 'none',
        background: 'transparent'
      }}
    >
      {/* ── 3D Canvas Layer ── */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 2 }}>
        <Canvas 
          camera={{ fov: 65, position: [0, 0, 150] }} 
          dpr={[1, 2]}
          gl={{ 
            antialias: true, 
            alpha: true,
            toneMapping: THREE.NoToneMapping,
            outputColorSpace: THREE.SRGBColorSpace,
            precision: 'highp'
          }}
        >
          <Logo3D progress={progress} dragVelocity={dragVelocity} />
        </Canvas>
      </div>

      {/* Grain removed per request */}

      {/* ── Drag Region ── */}
      <div data-tauri-drag-region style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 120, zIndex: 10, cursor: 'grab' }} />

      {/* ── UI Layer ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 2.5 }}
        style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none' }}
      >
        <div style={{ height: '240px', marginBottom: '80px' }} />
        <div style={{ width: '420px', height: '10px', background: 'rgba(255,255,255,0.06)', borderRadius: '100px', position: 'relative', marginBottom: '80px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
          <motion.div animate={{ width: `${progress}%` }} transition={{ ease: "linear", duration: 0.1 }} style={{ position: 'absolute', top: 0, left: 0, height: '100%', background: 'linear-gradient(90deg, rgba(255,255,255,0.4), #fff)', borderRadius: '100px' }} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '24px', fontWeight: 400, letterSpacing: '0.15em', margin: '0 0 20px 0', color: 'rgba(255,255,255,0.4)' }}>Welcome to Element Softaware's</p>
          <h1 style={{ fontSize: '112px', fontWeight: 100, letterSpacing: '0.04em', lineHeight: 1, margin: 0 }}>OS<sup>1</sup></h1>
          <p style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '0.45em', marginTop: '32px', textTransform: 'uppercase', opacity: 0.25 }}>Operating System</p>
        </div>
      </motion.div>

      {/* Credits */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.25 }} transition={{ delay: 1, duration: 2 }} style={{ position: 'absolute', bottom: '80px', right: '120px', textAlign: 'right', pointerEvents: 'none', zIndex: 10 }}>
        <p style={{ fontSize: '22px', fontWeight: 800, margin: '0 0 8px 0' }}>Her</p>
        <p style={{ fontSize: '20px', fontStyle: 'italic', margin: '0 0 24px 0' }}>a Spike Jonze love story</p>
        <div style={{ fontSize: '18px', lineHeight: 1.8, letterSpacing: '0.06em', color: 'rgba(255,255,255,0.7)' }}>Joaquin Phoenix<br />Scarlett Johansson<br />Amy Adams<br />Rooney Mara</div>
      </motion.div>
    </div>
  );
}
