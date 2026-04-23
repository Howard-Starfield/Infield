import "temporal-polyfill/global";
import React from "react";
import ReactDOM from "react-dom/client";
import { platform } from "@tauri-apps/plugin-os";
import App from "./App";
import { AppCrashBoundary } from "./shell/primitives/AppCrashBoundary";
import "./glide-data-grid-overlay-preload";

import "./i18n";
// App.css is already imported by App.tsx; do not duplicate.
import "./workspace.css";
import "./styles/entry.css";

// Theme module deletion (H1 Task 3): drop orphan localStorage entries
// the previous ThemeProvider wrote on every theme/preset change. Without
// this, stale blobs sit in storage forever after the module is gone.
try {
  localStorage.removeItem("infield:theme:state");
  localStorage.removeItem("infield:theme:vars");
} catch {
  // localStorage can throw in private modes; safe to ignore.
}

try {
  document.documentElement.dataset.platform = platform();
} catch (error) {
  console.warn("Failed to detect platform during startup:", error);
  document.documentElement.dataset.platform = "unknown";
}

document.documentElement.dataset.windowFocused = "true";
if (typeof window !== "undefined") {
  window.addEventListener("focus", () => {
    document.documentElement.dataset.windowFocused = "true";
  });
  window.addEventListener("blur", () => {
    document.documentElement.dataset.windowFocused = "false";
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppCrashBoundary>
      <App />
    </AppCrashBoundary>
  </React.StrictMode>,
);
