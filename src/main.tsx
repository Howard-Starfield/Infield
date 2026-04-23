import "temporal-polyfill/global";
import React from "react";
import ReactDOM from "react-dom/client";
import { platform } from "@tauri-apps/plugin-os";
import App from "./App";
import { ThemeProvider } from "./theme/ThemeProvider";
import { ThemeEditorRoot } from "./theme/ThemeEditorRoot";
import { AppCrashBoundary } from "./theme/AppCrashBoundary";
import "./glide-data-grid-overlay-preload";

// Initialize i18n
import "./i18n";
import "./workspace.css";
// Semantic cascade MUST load LAST so its derivations from theme primitives
// win over App.css's hardcoded literals. Do not reorder.
import "./theme/semantic.css";
// Phase B concern-files — load AFTER semantic.css so component-prefixed
// classes can reference every semantic token. Per Rule 18 each concern
// file stays under ~500 lines.
import "./styles/entry.css";

try {
  // Set platform before render so CSS can scope per-platform.
  document.documentElement.dataset.platform = platform();
} catch (error) {
  console.warn("Failed to detect platform during startup:", error);
  document.documentElement.dataset.platform = "unknown";
}

// Window focus/blur → `data-window-focused` attribute on <html>. Consumed
// by App.css to dim the rim/shadow when the window is inactive, matching
// native macOS vibrancy conventions. Initialized to `true` so the first
// paint doesn't flash a dimmed state; the listeners keep it in sync.
document.documentElement.dataset.windowFocused = "true";
if (typeof window !== "undefined") {
  window.addEventListener("focus", () => {
    document.documentElement.dataset.windowFocused = "true";
  });
  window.addEventListener("blur", () => {
    document.documentElement.dataset.windowFocused = "false";
  });
}

// ThemeProvider wraps the outermost boundary so LoadingScreen + LoginPage
// (mounted inside <App />) inherit the user's theme before the first paint.
// See CLAUDE.md → Theme Module → Senior-level notes #4.
//
// ThemeEditorRoot is a SIBLING of <App /> on purpose: the theme editor must
// remain openable even when the main app tree throws (e.g. a bad theme made
// a critical surface unreadable, or an upstream permission / IPC error
// crashed a downstream component). Users need a guaranteed path back to
// working settings. See `ThemeEditorRoot.tsx` for the rationale.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ThemeProvider>
    <AppCrashBoundary>
      <App />
    </AppCrashBoundary>
    <ThemeEditorRoot />
  </ThemeProvider>,
);
