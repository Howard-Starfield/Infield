import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  ChangeAdmonitionType,
  ChangeCodeMirrorLanguage,
  CodeToggle,
  ConditionalContents,
  CreateLink,
  DiffSourceToggleWrapper,
  HighlightToggle,
  InsertAdmonition,
  InsertCodeBlock,
  InsertFrontmatter,
  InsertImage,
  InsertSandpack,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  Separator,
  ShowSandpackInfo,
  StrikeThroughSupSubToggles,
  UndoRedo,
} from "@mdxeditor/editor";
import type { EditorInFocus } from "@mdxeditor/editor";
import { Settings2 } from "lucide-react";
import {
  computePinnedToolCount,
  DEFAULT_MDX_TOOL_ORDER,
  MDX_TOOLBAR_PINNED_COUNT,
  type MdxToolId,
} from "./mdxToolbarIds";
import { useMdxToolbarStore } from "./mdxToolbarStore";
import { MdxToolbarCustomizeModal } from "./MdxToolbarCustomizeModal";

function whenInAdmonition(editorInFocus: EditorInFocus | null) {
  const node = editorInFocus?.rootNode;
  if (!node || node.getType() !== "directive") {
    return false;
  }
  const mdast = (node as unknown as { getMdastNode: () => { name?: string } }).getMdastNode();
  const name = mdast?.name;
  return (
    typeof name === "string" &&
    (["note", "tip", "danger", "info", "caution"] as string[]).includes(name)
  );
}

function renderTool(id: MdxToolId): React.ReactNode {
  switch (id) {
    case "undoRedo":
      return <UndoRedo />;
    case "boldItalicUnderline":
      return <BoldItalicUnderlineToggles />;
    case "codeToggle":
      return <CodeToggle />;
    case "highlightToggle":
      return <HighlightToggle />;
    case "strikeSupSub":
      return <StrikeThroughSupSubToggles />;
    case "listsToggle":
      return <ListsToggle />;
    case "blockType":
      return (
        <ConditionalContents
          options={[
            {
              when: whenInAdmonition,
              contents: () => <ChangeAdmonitionType />,
            },
            { fallback: () => <BlockTypeSelect /> },
          ]}
        />
      );
    case "createLink":
      return <CreateLink />;
    case "insertImage":
      return <InsertImage />;
    case "insertTable":
      return <InsertTable />;
    case "insertThematicBreak":
      return <InsertThematicBreak />;
    case "insertCodeBlock":
      return <InsertCodeBlock />;
    case "insertSandpack":
      return <InsertSandpack />;
    case "insertAdmonition":
      return (
        <ConditionalContents
          options={[
            {
              when: (editorInFocus) => !whenInAdmonition(editorInFocus),
              contents: () => <InsertAdmonition />,
            },
          ]}
        />
      );
    case "insertFrontmatter":
      return <InsertFrontmatter />;
    default:
      return null;
  }
}

function HandyMdxRichToolbarOrdered() {
  const { t } = useTranslation();
  const order = useMdxToolbarStore((s) => s.order);
  const widthRowRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [morePos, setMorePos] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [widthPinnedCap, setWidthPinnedCap] = useState(MDX_TOOLBAR_PINNED_COUNT);

  const effectiveOrder = useMemo(
    () => (order.length ? order : DEFAULT_MDX_TOOL_ORDER),
    [order],
  );

  useLayoutEffect(() => {
    const el = widthRowRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      const cap = computePinnedToolCount(w, effectiveOrder);
      setWidthPinnedCap(
        Number.isFinite(cap) && cap > 0
          ? cap
          : Math.min(MDX_TOOLBAR_PINNED_COUNT, effectiveOrder.length),
      );
    };
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [effectiveOrder]);

  const mainCount = Math.min(widthPinnedCap, effectiveOrder.length);
  const visible = effectiveOrder.slice(0, mainCount);
  const hidden = effectiveOrder.slice(mainCount);
  const showMore = hidden.length > 0;

  useLayoutEffect(() => {
    if (!moreOpen || !moreBtnRef.current) {
      setMorePos(null);
      return;
    }
    const r = moreBtnRef.current.getBoundingClientRect();
    const maxPanelW = Math.min(920, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - maxPanelW - 8));
    setMorePos({ top: r.bottom + 4, left });
  }, [moreOpen, hidden.length]);

  useLayoutEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (moreBtnRef.current?.contains(t)) return;
      const panel = document.getElementById("handy-mdx-toolbar-more-panel");
      if (panel?.contains(t)) return;
      setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDoc, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDoc, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [moreOpen]);

  return (
    <>
      <div
        ref={widthRowRef}
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          flex: 1,
          minWidth: 0,
          gap: 4,
        }}
      >
        <div className="handy-mdx-toolbar-rich">
          {visible.map((id, idx) => (
            <React.Fragment key={id}>
              {idx > 0 ? <Separator /> : null}
              <span className="handy-mdx-toolbar-slot">{renderTool(id)}</span>
            </React.Fragment>
          ))}
        </div>
        <button
          type="button"
          className="handy-mdx-toolbar-more-btn"
          aria-label={t("notes.mdxToolbar.customizeToolbar")}
          title={t("notes.mdxToolbar.customizeToolbar")}
          onClick={() => setCustomizeOpen(true)}
        >
          <Settings2 size={15} strokeWidth={2} aria-hidden />
        </button>
        {showMore ? (
          <div className="handy-mdx-toolbar-more-wrap" style={{ position: "relative" }}>
            <button
              ref={moreBtnRef}
              type="button"
              className="handy-mdx-toolbar-more-btn"
              aria-label={t("notes.mdxToolbar.moreTools")}
              aria-expanded={moreOpen}
              title={t("notes.mdxToolbar.moreTools")}
              onClick={() => setMoreOpen((o) => !o)}
            >
              {t("notes.mdxToolbar.moreMenuGlyph")}
            </button>
          </div>
        ) : null}
      </div>
      {moreOpen && morePos && hidden.length > 0
        ? createPortal(
            <div
              id="handy-mdx-toolbar-more-panel"
              className="handy-mdx-toolbar-more-panel handy-mdx-toolbar-more-panel--stripe"
              style={{
                position: "fixed",
                top: morePos.top,
                left: morePos.left,
                maxWidth: Math.min(920, window.innerWidth - 16),
              }}
              role="menu"
            >
              {hidden.map((id, idx) => (
                <React.Fragment key={id}>
                  {idx > 0 ? <Separator /> : null}
                  <span className="handy-mdx-toolbar-slot">{renderTool(id)}</span>
                </React.Fragment>
              ))}
            </div>,
            document.body,
          )
        : null}
      <MdxToolbarCustomizeModal
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
      />
    </>
  );
}

/** Drop-in replacement for `KitchenSinkToolbar` with reorder, persistence, and overflow. */
export function HandyMdxToolbar() {
  return (
    <DiffSourceToggleWrapper>
      <ConditionalContents
        options={[
          {
            when: (editor) => editor?.editorType === "codeblock",
            contents: () => <ChangeCodeMirrorLanguage />,
          },
          {
            when: (editor) => editor?.editorType === "sandpack",
            contents: () => <ShowSandpackInfo />,
          },
          {
            fallback: () => <HandyMdxRichToolbarOrdered />,
          },
        ]}
      />
    </DiffSourceToggleWrapper>
  );
}
