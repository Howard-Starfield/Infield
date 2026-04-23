import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './app.css' // We will keep the kinetic vault styles here

// Initialize UI Scale from localStorage
const savedScale = localStorage.getItem('ui-scale');
if (savedScale) {
  document.documentElement.style.setProperty('--ui-scale', savedScale);
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
