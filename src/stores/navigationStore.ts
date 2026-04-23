import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

const MAX_HISTORY = 50;

interface NavigationStore {
  noteHistory: string[];
  historyIndex: number;

  pushNote: (id: string) => void;
  navigateBack: () => string | null;
  navigateForward: () => string | null;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  currentNoteId: () => string | null;
}

export const useNavigationStore = create<NavigationStore>()(
  immer((set, get) => ({
    noteHistory: [],
    historyIndex: -1,

    pushNote: (id) =>
      set((state) => {
        // Truncate any forward entries
        const truncated = state.noteHistory.slice(0, state.historyIndex + 1);
        truncated.push(id);
        // Cap at MAX_HISTORY — drop oldest if needed
        if (truncated.length > MAX_HISTORY) {
          truncated.shift();
        }
        state.noteHistory = truncated;
        state.historyIndex = truncated.length - 1;
      }),

    navigateBack: () => {
      const { historyIndex, noteHistory } = get();
      if (historyIndex <= 0) return null;
      set((state) => { state.historyIndex -= 1; });
      return noteHistory[get().historyIndex] ?? null;
    },

    navigateForward: () => {
      const { historyIndex, noteHistory } = get();
      if (historyIndex >= noteHistory.length - 1) return null;
      set((state) => { state.historyIndex += 1; });
      return noteHistory[get().historyIndex] ?? null;
    },

    canGoBack: () => get().historyIndex > 0,
    canGoForward: () => get().historyIndex < get().noteHistory.length - 1,
    currentNoteId: () => {
      const { historyIndex, noteHistory } = get();
      return noteHistory[historyIndex] ?? null;
    },
  })),
);
