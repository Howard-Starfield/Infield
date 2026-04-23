import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { MdxToolId } from "./mdxToolbarIds";
import { useMdxToolbarStore } from "./mdxToolbarStore";
import { workspaceModalZ } from "@/lib/workspaceFloatingLayer";

type Props = {
  open: boolean;
  onClose: () => void;
};

function SortableRow({ id }: { id: MdxToolId }) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--workspace-border)",
    background: "var(--workspace-panel)",
    cursor: "grab",
  };

  return (
    <div ref={setNodeRef} style={style}>
      <button
        type="button"
        aria-label={t("notes.mdxToolbar.dragHandle")}
        {...attributes}
        {...listeners}
        style={{
          border: "none",
          background: "none",
          padding: 4,
          cursor: "grab",
          color: "var(--workspace-text-muted)",
          display: "flex",
        }}
      >
        <GripVertical size={18} aria-hidden />
      </button>
      <span
        style={{
          flex: 1,
          fontSize: 13,
          color: "var(--workspace-text)",
          fontFamily: "var(--font-body, Inter, sans-serif)",
        }}
      >
        {t(`notes.mdxToolbar.tools.${id}`)}
      </span>
    </div>
  );
}

export function MdxToolbarCustomizeModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const storeOrder = useMdxToolbarStore((s) => s.order);
  const setOrder = useMdxToolbarStore((s) => s.setOrder);
  const resetOrder = useMdxToolbarStore((s) => s.resetOrder);
  const [localOrder, setLocalOrder] = useState<MdxToolId[]>(storeOrder);

  useEffect(() => {
    if (open) setLocalOrder(storeOrder);
  }, [open, storeOrder]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localOrder.indexOf(active.id as MdxToolId);
    const newIndex = localOrder.indexOf(over.id as MdxToolId);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(localOrder, oldIndex, newIndex);
    setLocalOrder(next);
    setOrder(next);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="handy-mdx-toolbar-customize-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: Number.parseInt(workspaceModalZ(), 10) || 12030,
        background: "var(--workspace-chat-backdrop)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(420px, 100%)",
          maxHeight: "min(80vh, 560px)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          borderRadius: "var(--workspace-menu-radius)",
          border: "1px solid var(--workspace-border)",
          background: "var(--workspace-panel)",
          boxShadow: "var(--workspace-chat-modal-shadow)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "16px 18px",
            borderBottom: "1px solid var(--workspace-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <h2
            id="handy-mdx-toolbar-customize-title"
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 700,
              color: "var(--workspace-text)",
            }}
          >
            {t("notes.mdxToolbar.customizeToolbar")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "none",
              background: "color-mix(in srgb, var(--workspace-text) 6%, transparent)",
              borderRadius: 8,
              padding: "6px 12px",
              cursor: "pointer",
              fontSize: 13,
              color: "var(--workspace-text)",
            }}
          >
            {t("notes.mdxToolbar.close")}
          </button>
        </div>
        <p
          style={{
            margin: 0,
            padding: "10px 18px 0",
            fontSize: 12,
            color: "var(--workspace-text-muted)",
            lineHeight: 1.45,
          }}
        >
          {t("notes.mdxToolbar.dragHint")}
        </p>
        <div style={{ padding: 14, overflowY: "auto", flex: 1 }}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={localOrder}
              strategy={verticalListSortingStrategy}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {localOrder.map((id) => (
                  <SortableRow key={id} id={id} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
        <div
          style={{
            padding: "12px 18px",
            borderTop: "1px solid var(--workspace-border)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={() => {
              resetOrder();
              setLocalOrder([...useMdxToolbarStore.getState().order]);
            }}
            style={{
              border: "1px solid var(--workspace-border)",
              background: "transparent",
              borderRadius: 8,
              padding: "8px 14px",
              cursor: "pointer",
              fontSize: 13,
              color: "var(--workspace-text)",
            }}
          >
            {t("notes.mdxToolbar.reset")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
