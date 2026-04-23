import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const svgSize = 86;
const cx = svgSize / 2;
const cy = svgSize / 2;
const innerR = 15;
const maxBarLen = 28;
const barCount = 64;
const level = 0.38;
const avgLevel = level;
const isRecording = false;
const sig = "#b72301";

const bars = [];
for (let i = 0; i < barCount; i++) {
  const angleFrac = i / barCount;
  const angle = angleFrac * Math.PI * 2 - Math.PI / 2;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const x1 = cx + cosA * innerR;
  const y1 = cy + sinA * innerR;
  const barLen = 3.5 + level * maxBarLen;
  const x2 = cx + cosA * (innerR + barLen);
  const y2 = cy + sinA * (innerR + barLen);
  const opacity = isRecording ? 0.3 + level * 0.7 : 0.08 + level * 0.15;
  bars.push({ x1, y1, x2, y2, opacity });
}

const outerRingR = innerR + maxBarLen + 4;
const ringR = innerR + (avgLevel * maxBarLen) / 2 + 3;
const ringOpacity = isRecording ? 0.15 + avgLevel * 0.35 : 0.06 + avgLevel * 0.1;
const rOuter = outerRingR + avgLevel * 10;

let bloom = "";
let main = "";
for (const b of bars) {
  bloom += `  <line x1="${b.x1.toFixed(2)}" y1="${b.y1.toFixed(2)}" x2="${b.x2.toFixed(2)}" y2="${b.y2.toFixed(2)}" stroke="${sig}" stroke-opacity="${(0.35 * b.opacity * 0.5).toFixed(4)}" stroke-width="6.5" stroke-linecap="round" filter="url(#orb-blur)"/>\n`;
  main += `  <line x1="${b.x1.toFixed(2)}" y1="${b.y1.toFixed(2)}" x2="${b.x2.toFixed(2)}" y2="${b.y2.toFixed(2)}" stroke="${sig}" stroke-opacity="${b.opacity.toFixed(4)}" stroke-width="1.6" stroke-linecap="round"/>\n`;
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Backup: System Audio header orb (mirrors SystemAudioSession.tsx / AudioLevelBars).
  Rendering: SVG + SMIL — not Canvas, not Lottie, not a server "backend".
  Live app: React updates bar lengths from audio levels; this file uses a fixed mid-level snapshot + pulse.
  Open in any browser or embed. Accent color #b72301 matches default theme signal.
-->
<svg xmlns="http://www.w3.org/2000/svg" width="${svgSize}" height="${svgSize}" viewBox="0 0 ${svgSize} ${svgSize}" overflow="visible">
  <defs>
    <filter id="orb-blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter>
    <filter id="orb-core" x="-15%" y="-15%" width="130%" height="130%"><feGaussianBlur stdDeviation="2"/></filter>
    <radialGradient id="orb-center" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${sig}" stop-opacity="0.88"/>
      <stop offset="60%" stop-color="${sig}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${sig}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="orb-outer" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${sig}" stop-opacity="0"/>
      <stop offset="70%" stop-color="${sig}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${sig}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="${cx}" cy="${cy}" r="${rOuter.toFixed(2)}" fill="url(#orb-outer)" opacity="${ringOpacity.toFixed(3)}" filter="url(#orb-blur)"/>
  <circle cx="${cx}" cy="${cy}" r="${ringR.toFixed(2)}" fill="none" stroke="${sig}" stroke-opacity="0.22" stroke-width="1.5" stroke-dasharray="3 5" opacity="${(ringOpacity * 0.6).toFixed(3)}"/>
${bloom}${main}  <g transform="translate(${cx} ${cy})">
    <g>
      <animateTransform attributeName="transform" type="scale" values="1;1.34;1" keyTimes="0;0.5;1" dur="2.5s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"/>
      <circle cx="0" cy="0" r="${innerR}" fill="url(#orb-center)" opacity="0.2" filter="url(#orb-core)"/>
    </g>
  </g>
  <circle cx="${cx}" cy="${cy}" r="3" fill="${sig}" opacity="0.35"/>
</svg>
`;

const outDir = path.join(root, "src", "assets");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "system-audio-visualization-backup.svg");
fs.writeFileSync(outPath, xml, "utf8");
console.log("Wrote", outPath);
