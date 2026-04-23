import React from "react";

/**
 * Legacy notes-scoped search UI.
 *
 * Phase A Commit 3 deleted NotesManager + the notes.db backend this
 * component was built on. Phase F (Search v2, per PLAN.md) rebuilds search
 * from scratch against `workspace_nodes` + `vec_embeddings` in the flat
 * IRS-style component layout — that includes the Cmd+K quick-open overlay
 * which CLAUDE.md's keyboard contract specifies but doesn't yet exist in
 * the frontend.
 *
 * Stubbed in the interim so App.tsx continues to mount something for the
 * `search` tab. The only live search surface until Phase F is in-sidebar
 * tree scroll-to-name; a Phases C-E bridge (minimal floating overlay
 * wired to `search_workspace_hybrid`) is worth considering if search
 * absence becomes painful before Phase F lands.
 */
interface SearchTabProps {
  // Prop kept for App.tsx signature compatibility; re-wired in Phase F.
  semanticPanelOpen?: boolean;
}

export const SearchTab: React.FC<SearchTabProps> = ({ semanticPanelOpen }) => {
  void semanticPanelOpen;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        flexDirection: "column",
        gap: 12,
        padding: 32,
        color: "var(--workspace-text-soft, #888)",
        fontSize: 13,
        fontFamily: "Space Grotesk, sans-serif",
        textAlign: "center",
      }}
    >
      <span style={{ fontSize: 15, fontWeight: 600 }}>
        Search under reconstruction
      </span>
      <span style={{ opacity: 0.7, maxWidth: 420, lineHeight: 1.5 }}>
        The legacy notes search surface retired with Phase A Commit 3.
        Phase F rebuilds this view against workspace nodes + semantic
        embeddings. For now, use the workspace tree to navigate.
      </span>
    </div>
  );
};
