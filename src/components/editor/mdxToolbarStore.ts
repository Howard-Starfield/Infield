import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  DEFAULT_MDX_TOOL_ORDER,
  normalizeMdxToolOrder,
  type MdxToolId,
} from "./mdxToolbarIds";

const STORAGE_KEY = "handy.mdxToolbar.v1";

export type MdxToolbarStore = {
  order: MdxToolId[];
  setOrder: (order: MdxToolId[]) => void;
  resetOrder: () => void;
};

export const useMdxToolbarStore = create<MdxToolbarStore>()(
  persist(
    (set) => ({
      order: [...DEFAULT_MDX_TOOL_ORDER],
      setOrder: (next) =>
        set({ order: normalizeMdxToolOrder({ order: next }) }),
      resetOrder: () => set({ order: [...DEFAULT_MDX_TOOL_ORDER] }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ order: s.order }),
      merge: (persisted, current) => {
        const p = persisted as Partial<{ order: unknown }> | undefined;
        if (!p?.order) return current;
        return {
          ...current,
          order: normalizeMdxToolOrder({ order: p.order }),
        };
      },
    },
  ),
);
