import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './app.css' // We will keep the kinetic vault styles here
import './styles/onboarding.css'
import './styles/search.css'

// Initialize UI Scale from localStorage BEFORE React mounts so the
// first paint is at the user's chosen scale (no FOUT). VaultContext
// is the runtime source-of-truth after hydration; this just primes
// the CSS vars for that initial frame. Sets BOTH --app-zoom (drives
// `#root { zoom }` for inline-px literals) and --ui-scale (drives
// the token-system multiplier). Range-clamped 0.5–1.5 to match
// VaultContext's clampScale().
{
  const raw = localStorage.getItem('ui-scale');
  const parsed = raw ? parseFloat(raw) : NaN;
  const scale = Number.isFinite(parsed)
    ? Math.max(0.5, Math.min(1.5, parsed))
    : 1.0;
  document.documentElement.style.setProperty('--app-zoom', String(scale));
  document.documentElement.style.setProperty('--ui-scale', String(scale));
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
