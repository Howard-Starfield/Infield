import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import {
  WORKSPACE_APPEARANCE_PREFERENCE_KEY,
  applyWorkspaceAppearanceToDocument,
  defaultWorkspaceAppearanceSettings,
  resolveWorkspaceAppearance,
  sanitizeWorkspaceAppearanceSettings,
  type WorkspaceAppearanceOverrides,
  type WorkspaceAppearanceSettings,
  type WorkspaceDensityPresetId,
  type WorkspaceResolvedAppearance,
  type WorkspaceThemePresetId,
} from "@/lib/workspaceAppearance";
import type { WorkspaceSurfaceTokens } from "@/lib/workspaceSurfaceTokens";

interface WorkspaceAppearanceStore {
  settings: WorkspaceAppearanceSettings;
  resolved: WorkspaceResolvedAppearance;
  /** Widget / calendar / status hex for the active theme (see `resolved.surfaces`). */
  getSurfaceTokens: () => WorkspaceSurfaceTokens;
  isLoading: boolean;
  hasLoaded: boolean;
  initialize: () => Promise<void>;
  setThemePreset: (themePresetId: WorkspaceThemePresetId) => Promise<void>;
  setDensityPreset: (
    densityPresetId: WorkspaceDensityPresetId,
  ) => Promise<void>;
  patchOverrides: (
    patch: Partial<WorkspaceAppearanceOverrides>,
  ) => void;
  resetOverrides: () => Promise<void>;
  resetAll: () => Promise<void>;
}

async function persistSettings(settings: WorkspaceAppearanceSettings) {
  await invoke("set_user_preference", {
    key: WORKSPACE_APPEARANCE_PREFERENCE_KEY,
    value: JSON.stringify(settings),
  });
}

/** Avoid awaiting disk on every range `input` tick while dragging appearance sliders. */
let appearancePersistTimer: ReturnType<typeof setTimeout> | null = null;

function cancelDebouncedAppearancePersist() {
  if (appearancePersistTimer) {
    clearTimeout(appearancePersistTimer);
    appearancePersistTimer = null;
  }
}

function scheduleDebouncedAppearancePersist(
  getSettings: () => WorkspaceAppearanceSettings,
) {
  cancelDebouncedAppearancePersist();
  appearancePersistTimer = setTimeout(() => {
    appearancePersistTimer = null;
    void (async () => {
      try {
        await persistSettings(getSettings());
      } catch (error) {
        console.warn("Failed to save workspace appearance:", error);
      }
    })();
  }, 200);
}

function applySettings(settings: WorkspaceAppearanceSettings) {
  const resolved = resolveWorkspaceAppearance(settings);
  applyWorkspaceAppearanceToDocument(resolved);
  return { settings, resolved };
}

export const useWorkspaceAppearanceStore = create<WorkspaceAppearanceStore>(
  (set, get) => ({
    ...applySettings(defaultWorkspaceAppearanceSettings),
    getSurfaceTokens: () => get().resolved.surfaces,
    isLoading: false,
    hasLoaded: false,

    initialize: async () => {
      if (get().hasLoaded || get().isLoading) return;
      cancelDebouncedAppearancePersist();
      set({ isLoading: true });
      try {
        const raw = await invoke<string | null>("get_user_preference", {
          key: WORKSPACE_APPEARANCE_PREFERENCE_KEY,
        });
        const parsed = raw
          ? sanitizeWorkspaceAppearanceSettings(JSON.parse(raw))
          : defaultWorkspaceAppearanceSettings;
        set({ ...applySettings(parsed), hasLoaded: true, isLoading: false });
      } catch (error) {
        console.warn("Failed to load workspace appearance settings:", error);
        set({
          ...applySettings(defaultWorkspaceAppearanceSettings),
          hasLoaded: true,
          isLoading: false,
        });
      }
    },

    setThemePreset: async (themePresetId) => {
      cancelDebouncedAppearancePersist();
      const next = sanitizeWorkspaceAppearanceSettings({
        ...get().settings,
        themePresetId,
      });
      set(applySettings(next));
      try {
        await persistSettings(next);
      } catch (error) {
        console.warn("Failed to save workspace theme preset:", error);
      }
    },

    setDensityPreset: async (densityPresetId) => {
      cancelDebouncedAppearancePersist();
      const next = sanitizeWorkspaceAppearanceSettings({
        ...get().settings,
        densityPresetId,
      });
      set(applySettings(next));
      try {
        await persistSettings(next);
      } catch (error) {
        console.warn("Failed to save workspace density preset:", error);
      }
    },

    patchOverrides: (patch) => {
      const next = sanitizeWorkspaceAppearanceSettings({
        ...get().settings,
        overrides: {
          ...get().settings.overrides,
          ...patch,
        },
      });
      set(applySettings(next));
      scheduleDebouncedAppearancePersist(() => get().settings);
    },

    resetOverrides: async () => {
      cancelDebouncedAppearancePersist();
      const next = sanitizeWorkspaceAppearanceSettings({
        ...get().settings,
        overrides: {},
      });
      set(applySettings(next));
      try {
        await persistSettings(next);
      } catch (error) {
        console.warn("Failed to reset workspace appearance overrides:", error);
      }
    },

    resetAll: async () => {
      cancelDebouncedAppearancePersist();
      set(applySettings(defaultWorkspaceAppearanceSettings));
      try {
        await persistSettings(defaultWorkspaceAppearanceSettings);
      } catch (error) {
        console.warn("Failed to reset workspace appearance settings:", error);
      }
    },
  }),
);
