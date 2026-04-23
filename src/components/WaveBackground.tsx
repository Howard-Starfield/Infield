import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;

  // 2D Noise function
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
             -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1;
    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
    + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
      dot(x12.zw,x12.zw)), 0.0);
    m = m*m ;
    m = m*m ;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  void main() {
    vec2 uv = vUv;
    
    // Create multiple layers of noise for "liquid" feel
    float n1 = snoise(uv * 1.5 + uTime * 0.12);
    float n2 = snoise(uv * 2.2 - uTime * 0.08);
    float n3 = snoise(uv * 3.5 + uTime * 0.04);
    
    float combinedNoise = n1 * 0.6 + n2 * 0.3 + n3 * 0.1;
    
    // Map noise to colors
    vec3 color = mix(uColorA, uColorB, combinedNoise * 0.5 + 0.5);
    color = mix(color, uColorC, n2 * 0.4 + 0.6);
    
    // Darken corners slightly for a cinematic look without hard edges
    float dist = distance(uv, vec2(0.5));
    color *= smoothstep(1.5, 0.5, dist);
    
    gl_FragColor = vec4(color, 1.0);
  }
`;

import { useVault } from '../contexts/VaultContext';

function WaveMesh() {
  const meshRef = useRef<THREE.Mesh>(null);
  const { viewport } = useThree();
  const { vaultData } = useVault();
  
  const prefs = vaultData?.uiPreferences;
  
  // Use colors from preferences or fall back to "Blinko" theme
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColorA: { value: new THREE.Color(prefs?.bgColorA || '#2a145c') },
    uColorB: { value: new THREE.Color(prefs?.bgColorB || '#b5369c') },
    uColorC: { value: new THREE.Color(prefs?.bgColorC || '#1a8bb5') },
  }), [prefs?.bgColorA, prefs?.bgColorB, prefs?.bgColorC]);

  useFrame((state) => {
    if (meshRef.current) {
      const speed = (prefs?.bgSpeed !== undefined ? prefs.bgSpeed : 50) / 50; 
      (meshRef.current.material as THREE.ShaderMaterial).uniforms.uTime.value = state.clock.getElapsedTime() * speed;
    }
  });

  return (
    <mesh ref={meshRef} scale={[viewport.width, viewport.height, 1]}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export const WaveBackground: React.FC = () => {
  return (
    <div style={{ 
      position: 'absolute', 
      top: 0, 
      left: 0, 
      width: '100vw', 
      height: '100vh', 
      zIndex: 0, 
      background: '#000' 
    }}>
      <Canvas
        camera={{ position: [0, 0, 1], fov: 75 }}
        gl={{ antialias: true, alpha: false }}
        style={{ width: '100%', height: '100%' }}
      >
        <WaveMesh />
      </Canvas>
    </div>
  );
};
