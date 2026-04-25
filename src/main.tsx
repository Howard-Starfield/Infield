import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './app.css' // We will keep the kinetic vault styles here
import './styles/onboarding.css'
import './styles/search.css'
import { effectiveUiScale, readStoredLogicalUiScale } from './services/uiScale'

// Initialize UI Scale from localStorage BEFORE React mounts so the
// first paint is at the user's chosen density (no FOUT). VaultContext
// is the runtime source-of-truth after hydration; this just primes
// the CSS vars for that initial frame.
{
  const logicalScale = readStoredLogicalUiScale()
  const visualScale = effectiveUiScale(logicalScale)
  document.documentElement.style.setProperty('--app-zoom', String(visualScale))
  document.documentElement.style.setProperty('--ui-scale', String(visualScale))
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
