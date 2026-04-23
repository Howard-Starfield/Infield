import { lazy, Suspense, useCallback, useEffect, useState, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast, Toaster } from "sonner";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { ModelStateEvent, RecordingErrorEvent } from "./lib/types/events";
import "./App.css";
import { SystemAudioSession } from "./components/settings/SystemAudioSession";
import { UnifiedSettingsPage } from "./components/settings/UnifiedSettingsPage";
import {
  EntryProvider,
  LoadingScreen,
  LoginPage,
  useEntry,
  type EntryStage,
} from "./entry";
import { OnboardingShell } from "./components/OnboardingShell";
import { AppShell } from "./shell/AppShell";

const OPEN_SETTINGS_EVENT = "handy-open-settings";
import { useSettings } from "./hooks/useSettings";
import { useModelStore } from "./stores/modelStore";
// `useNotesStore` retired with Phase A Commit 3 — NotesManager and notes.db
// deleted backend-side. The "notes" tab in the app-view route still exists
// as a string ID but routes to workspace_nodes now; no dedicated notes
// collection to initialize.
import { useSettingsStore } from "./stores/settingsStore";
import { useWorkspaceAppearanceStore } from "./stores/workspaceAppearanceStore";
import { commands } from "@/bindings";
import { getLanguageDirection, initializeRTL } from "@/lib/utils/rtl";
import {
  DEFAULT_SETTINGS_SECTION,
  isSettingsSectionId,
  type SettingsSectionId,
} from "@/lib/settingsSection";

const HomeTab = lazy(async () => {
  const module = await import("./components/home/HomeTab");
  return { default: module.HomeTab };
});

const WorkspaceLayout = lazy(async () => {
  const module = await import("./components/workspace/WorkspaceLayout");
  return { default: module.WorkspaceLayout };
});

const SearchTab = lazy(async () => {
  const module = await import("./components/search/SearchTab");
  return { default: module.SearchTab };
});

const ImportTab = lazy(async () => {
  const module = await import("./components/import/ImportTab");
  return { default: module.ImportTab };
});

// Legacy TopBar / BottomBar / ChatWindow / Sidebar / WorkspaceShell
// imports removed in Phase 3. Files retained on disk (unreferenced)
// for Phase 7 deletion per frontendplan.md.

export type AppTab =
  | "home"
  | "search"
  | "import"
  | "audio"
  | "notes"
  | "databases"
  | "settings"
  | "help";

export interface AppView {
  tab: AppTab;
  nodeId?: string;
}

/**
 * Top-level wrapper. Reads the Rust `onboarding_state` once, then hands off
 * to `EntryProvider` which owns the loading → onboarding → login → app
 * stage machine. `AppBody` consumes `useEntry()` and renders the right
 * surface. Keeping the provider here (not deeper) is deliberate — every
 * surface below this point may want to read `stage` / `progress` without
 * prop-drilling.
 */
function App() {
  const [onboardingStep, setOnboardingStep] = useState<string | null>(null);
  const { isLoading: settingsLoading } = useSettings();

  useEffect(() => {
    let cancelled = false;
    // Direct `invoke` here (not `commands.getOnboardingState`) — the new
    // command was registered in Phase B commit 1 but bindings.ts still
    // regenerates on next `bun run tauri dev`. Swapping to `commands.*` is
    // a trivial follow-up once specta emits the typed wrapper.
    void invoke<{ current_step: string }>("get_onboarding_state")
      .then((data) => {
        if (cancelled) return;
        setOnboardingStep(data.current_step);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[onboarding] get_onboarding_state failed:", err);
        // Fail-open to `done` so a Rust-side bug can't trap users in the
        // loading stage forever.
        setOnboardingStep("done");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <EntryProvider
      settingsLoading={settingsLoading}
      onboardingStep={onboardingStep}
    >
      <AppBody />
    </EntryProvider>
  );
}

function AppBody() {
  const { t, i18n } = useTranslation();
  const { stage, progress, finishOnboarding, lock, unlock } = useEntry();
  const [appView, setAppView] = useState<AppView>({ tab: "home" });
  const [settingsSection, setSettingsSection] =
    useState<SettingsSectionId>(DEFAULT_SETTINGS_SECTION);
  const handleUnifiedSettingsSectionChange = useCallback((id: string) => {
    setSettingsSection((prev) => {
      const next = isSettingsSectionId(id) ? id : prev;
      return prev === next ? prev : next;
    });
  }, []);
  const [semanticPanelOpen, setSemanticPanelOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "grid" | "gallery">("list");
  const [activeProvider, setActiveProvider] = useState<string | undefined>(undefined);
  const { settings, updateSetting } = useSettings();
  const direction = getLanguageDirection(i18n.language);
  const refreshAudioDevices = useSettingsStore(
    (state) => state.refreshAudioDevices,
  );
  const refreshOutputDevices = useSettingsStore(
    (state) => state.refreshOutputDevices,
  );
  const initializeModels = useModelStore((state) => state.initialize);
  const initializeWorkspaceAppearance = useWorkspaceAppearanceStore(
    (state) => state.initialize,
  );
  const hasCompletedPostOnboardingInit = useRef(false);

  useEffect(() => {
    initializeWorkspaceAppearance().catch((error) => {
      console.warn("Failed to initialize workspace appearance:", error);
    });
  }, [initializeWorkspaceAppearance]);

  // Cmd/Ctrl+L → app lock (H2.5). Per CLAUDE.md Keyboard Contracts.
  // Only fires when stage === 'app' so we don't trip during boot/
  // onboarding. preventDefault() blocks the browser address-bar focus
  // shortcut on the same chord.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key.toLowerCase() !== "l") return;
      if (stage !== "app") return;
      e.preventDefault();
      lock();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [stage, lock]);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const ce = e as CustomEvent<{ section?: string }>;
      const sec = ce.detail?.section;
      if (!sec) return;
      setAppView({ tab: "settings" });
      setSettingsSection(
        isSettingsSectionId(sec) ? sec : DEFAULT_SETTINGS_SECTION,
      );
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, onOpen);
  }, []);

  useEffect(() => {
    initializeModels().catch((error) => {
      console.warn("Failed to initialize model store:", error);
    });
  }, [initializeModels]);

  // Initialize RTL direction when language changes
  useEffect(() => {
    initializeRTL(i18n.language);
  }, [i18n.language]);

  // Post-onboarding init — runs once when the user arrives at the main
  // shell. Previously gated on `onboardingStep === "done"`; now gated on
  // `stage === "app"` which fires at the same moment via EntryContext.
  useEffect(() => {
    if (stage !== "app" || hasCompletedPostOnboardingInit.current) return;
    hasCompletedPostOnboardingInit.current = true;
    Promise.all([commands.initializeEnigo(), commands.initializeShortcuts()])
      .then(async () => {
        // Migration is idempotent (uses INSERT OR IGNORE), safe to call on every startup
        const result = await commands.runWorkspaceMigration();
        if (result.status === "ok") {
          console.info(`[workspace] Migration complete: ${result.data} records migrated`);
        } else {
          console.error(`[workspace] Migration failed:`, result.error);
        }
      })
      .catch((e) => {
        console.warn("Failed to initialize:", e);
      });
    refreshAudioDevices();
    refreshOutputDevices();
  }, [stage, refreshAudioDevices, refreshOutputDevices]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ candidates: unknown[] }>("import-recovery-pending", (ev) => {
      const n = Array.isArray(ev.payload.candidates) ? ev.payload.candidates.length : 0;
      if (n > 0) {
        toast.message(t("import.recoveryToastTitle", { count: n }), {
          description: t("import.recoveryToast"),
        });
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      void unlisten?.();
    };
  }, [t]);

  // Handle keyboard shortcuts for debug mode toggle
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Ctrl+Shift+D (Windows/Linux) or Cmd+Shift+D (macOS)
      const isDebugShortcut =
        event.shiftKey &&
        event.key.toLowerCase() === "d" &&
        (event.ctrlKey || event.metaKey);

      if (isDebugShortcut) {
        event.preventDefault();
        const currentDebugMode = settings?.debug_mode ?? false;
        updateSetting("debug_mode", !currentDebugMode);
      }

      // Cmd+Shift+J: Open today's daily note
      const isDailyNoteShortcut =
        event.shiftKey &&
        event.key.toLowerCase() === "j" &&
        (event.metaKey || event.ctrlKey);

      if (isDailyNoteShortcut) {
        event.preventDefault();
        const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
        invoke<{ id: string }>("get_or_create_daily_note", { date: today }).then((node) => {
          if (node) {
            useWorkspaceStore.getState().navigateTo(node.id, { source: "daily_note" });
          }
        }).catch(() => {});
      }
    };

    // Add event listener when component mounts
    document.addEventListener("keydown", handleKeyDown);

    // Cleanup event listener when component unmounts
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [settings?.debug_mode, updateSetting]);

  // Listen for recording errors from the backend and show a toast
  useEffect(() => {
    const unlisten = listen<RecordingErrorEvent>("recording-error", (event) => {
      const { error_type, detail } = event.payload;

      if (error_type === "microphone_permission_denied") {
        const currentPlatform = platform();
        const platformKey = `errors.micPermissionDenied.${currentPlatform}`;
        const description = t(platformKey, {
          defaultValue: t("errors.micPermissionDenied.generic"),
        });
        toast.error(t("errors.micPermissionDeniedTitle"), { description });
      } else if (error_type === "no_input_device") {
        toast.error(t("errors.noInputDeviceTitle"), {
          description: t("errors.noInputDevice"),
        });
      } else {
        toast.error(
          t("errors.recordingFailed", { error: detail ?? "Unknown error" }),
        );
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  // Listen for model loading failures and show a toast
  useEffect(() => {
    const unlisten = listen<ModelStateEvent>("model-state-changed", (event) => {
      if (event.payload.event_type === "loading_failed") {
        toast.error(
          t("errors.modelLoadFailed", {
            model:
              event.payload.model_name || t("errors.modelLoadFailedUnknown"),
          }),
          {
            description: event.payload.error,
          },
        );
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [t]);

  // Phase A: surface embedding worker unavailability (load_failed /
  // load_timeout / respawn_exhausted) as a toast so users aren't silently
  // degraded to FTS-only search. Event is emitted from
  // `managers::embedding_ort::emit_unavailable`. Reason strings match
  // `UnavailableReason::as_str()` on the Rust side.
  useEffect(() => {
    type UnavailablePayload = { reason: string };
    const unlisten = listen<UnavailablePayload>(
      "vector-search-unavailable",
      (event) => {
        const reason = event.payload.reason;
        const description =
          reason === "load_failed"
            ? "Semantic search model failed to load. FTS-only search remains available."
            : reason === "load_timeout"
              ? "Semantic search model is still loading — search will improve once it's ready."
              : reason === "respawn_exhausted"
                ? "Semantic search worker crashed repeatedly and has been disabled. Restart the app to retry."
                : "Semantic search is temporarily unavailable.";
        // Timeout is a soft signal — worker may complete load in background.
        // Use info level rather than error so users don't panic.
        if (reason === "load_timeout") {
          toast.message("Semantic search warming up", { description });
        } else {
          toast.error("Semantic search unavailable", { description });
        }
      },
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    type WorkspaceTranscriptionSyncedPayload = { node_id: string; source: string };
    const unlisten = listen<WorkspaceTranscriptionSyncedPayload>(
      "workspace-transcription-synced",
      async (event) => {
        const { node_id, source } = event.payload;
        try {
          useWorkspaceStore.getState().loadRootNodes();
          useWorkspaceStore.getState().bumpWorkspaceTreeRevision();
          // System Audio creates a workspace mirror but the live UI is the Audio tab — do not
          // switch tabs (voice_memo / mic flow still jumps to Workspace to show the doc).
          // Older backends used source "media_recording" for this event only (never for voice_memo).
          if (source === "system_audio" || source === "media_recording") {
            return;
          }
          await useWorkspaceStore.getState().navigateTo(node_id);
          // Voice-memo and mic transcription always produce document nodes
          // under the "Mic Transcribe" folder, so the notes surface is the
          // right destination. System audio returns earlier (no tab switch).
          setAppView({ tab: "notes", nodeId: node_id });
        } catch (err) {
          console.error("Failed to navigate to transcription workspace doc:", err);
        }
      },
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    type WorkspaceImportSyncedPayload = { node_id: string; source: string };
    const unlisten = listen<WorkspaceImportSyncedPayload>(
      "workspace-import-synced",
      async () => {
        try {
          await useWorkspaceStore.getState().loadRootNodes();
          useWorkspaceStore.getState().bumpWorkspaceTreeRevision();
        } catch (err) {
          console.error("Failed to refresh workspace tree after import:", err);
        }
      },
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    type WorkspaceNodeBodyUpdatedPayload = {
      node_id: string;
      body: string;
      updated_at: number;
    };
    const unlisten = listen<WorkspaceNodeBodyUpdatedPayload>(
      "workspace-node-body-updated",
      (event) => {
        const { node_id, body, updated_at } = event.payload;
        useWorkspaceStore
          .getState()
          .applyExternalNodeBodyPatch(node_id, body, updated_at);
      },
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<{ display_name: string }>("chat-provider-changed", (event) => {
      setActiveProvider(event.payload.display_name);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Entry surfaces — routed via `stage` from EntryContext.
  //   "loading"     → LoadingScreen
  //   "onboarding"  → OnboardingShell (4-step Mic/A11y/Models/Vault)
  //   "locked"      → LoginPage as Cmd+L overlay (D-H1)
  //   "app"         → no overlay; render the main shell below
  const entryStageKey: EntryStage | null =
    stage === "app" ? null : stage;

  const entryElement =
    entryStageKey === "loading" ? (
      <LoadingScreen progress={progress} />
    ) : entryStageKey === "onboarding" ? (
      <OnboardingShell onComplete={finishOnboarding} />
    ) : entryStageKey === "locked" ? (
      <LoginPage onUnlock={() => unlock()} />
    ) : null;

  if (entryElement) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={entryStageKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
          style={{ position: "fixed", inset: 0, zIndex: 1000 }}
        >
          {entryElement}
        </motion.div>
      </AnimatePresence>
    );
  }

  const renderContent = () => {
    const { tab, nodeId } = appView;

    if (tab === "audio") {
      return (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <SystemAudioSession />
        </div>
      );
    }

    if (tab === "search") {
      return (
        <Suspense fallback={<div className="flex-1 flex items-center justify-center text-sm" style={{ color: "var(--on-surface)", opacity: 0.6 }}>{t("common.loading")}</div>}>
          <SearchTab semanticPanelOpen={semanticPanelOpen} />
        </Suspense>
      );
    }

    if (tab === "import") {
      return (
        <Suspense fallback={<div className="flex-1 flex items-center justify-center text-sm" style={{ color: "var(--on-surface)", opacity: 0.6 }}>{t("common.loading")}</div>}>
          <ImportTab onNavigate={setAppView} />
        </Suspense>
      );
    }

    if (tab === "notes" || tab === "databases") {
      return (
        <Suspense fallback={<div className="flex-1 flex items-center justify-center text-sm" style={{ color: "var(--on-surface)", opacity: 0.6 }}>{t("common.loading")}</div>}>
          <WorkspaceLayout nodeId={nodeId} mode={tab} />
        </Suspense>
      );
    }

    if (tab === "settings") {
      return (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <UnifiedSettingsPage
            activeSection={settingsSection}
            onSectionChange={handleUnifiedSettingsSectionChange}
          />
        </div>
      );
    }

    if (tab === "help") {
      return (
        <div className="flex-1 flex items-center justify-center text-sm" style={{ color: "var(--on-surface)", opacity: 0.6 }}>
          {t("common.comingSoon")}
        </div>
      );
    }

    // default: home (absorbs the old "chat" tab per D5 decision)
    return <HomeTab onNavigate={setAppView} />;
  };

  // `databases`, `viewMode`, `semanticPanelOpen`, `activeProvider` were
  // previously piped through TopBar / BottomBar / Sidebar. With AppShell
  // the legacy chrome is gone; some of that state still wires internal
  // components. Keep what's live, drop what only fed the old chrome
  // (provider pill, view mode selector).
  void viewMode;
  void setViewMode;
  void activeProvider;

  return (
    <div
      dir={direction}
      className="cursor-default"
      style={{ color: "var(--on-surface)", height: "100vh", width: "100vw" }}
    >
      <Toaster
        theme="light"
        toastOptions={{
          unstyled: true,
          classNames: {
            toast:
              "bg-[#fffef9] border border-[rgba(143,112,105,0.22)] rounded-lg shadow-lg px-4 py-3 flex items-center gap-3 text-sm",
            title: "font-medium text-[#1c1c19]",
            description: "text-[#5b403a]/80",
          },
        }}
      />
      <AppShell
        appView={appView}
        onNavigate={setAppView}
        onOpenSettings={() => setAppView({ tab: "settings" })}
        onOpenNotifications={() =>
          setSemanticPanelOpen((v) => !v)
        }
      >
        {renderContent()}
      </AppShell>
    </div>
  );
}

export default App;
