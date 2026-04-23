import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

type Memory = {
  id: string;
  content: string;
  category: string;
  source: string;
  importance: number;
  created_at: number;
  last_accessed: number;
};

const CATEGORY_COLORS: Record<string, string> = {
  project: "#ffb783",
  open_loop: "#fca5a5",
  fact: "#c0c1ff",
  preference: "#86efac",
};

const formatRelative = (ts: number) => {
  const diff = Date.now() - ts;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
};

export const MemoryPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [clearConfirm, setClearConfirm] = useState(false);

  useEffect(() => {
    void loadMemories();
  }, []);

  const loadMemories = async () => {
    setIsLoading(true);
    try {
      const data = await invoke<Memory[]>("list_memories");
      setMemories(data);
    } catch {
      setMemories([]);
    }
    setIsLoading(false);
  };

  const handleDelete = async (id: string) => {
    try {
      await invoke("delete_memory", { id });
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch {
      // ignore
    }
  };

  const handleClearAll = async () => {
    if (!clearConfirm) { setClearConfirm(true); return; }
    try {
      await invoke("clear_memories");
      setMemories([]);
      toast.success(t("memory.cleared"));
    } catch {
      // ignore
    }
    setClearConfirm(false);
  };

  const grouped = memories.reduce<Record<string, Memory[]>>((acc, m) => {
    (acc[m.category] ??= []).push(m);
    return acc;
  }, {});

  return (
    <div
      style={{
        width: 260,
        borderLeft: "1px solid rgba(255,255,255,.06)",
        background: "rgba(14,14,16,.9)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid rgba(255,255,255,.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, fontFamily: "Manrope, sans-serif", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "rgba(255,255,255,.5)" }}>
          {t("memory.title")}
        </span>
        <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,.3)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
        {isLoading ? (
          <p style={{ fontSize: 12, color: "rgba(255,255,255,.3)", margin: 0 }}>{t("common.loading")}</p>
        ) : memories.length === 0 ? (
          <p style={{ fontSize: 12, color: "rgba(255,255,255,.3)", margin: 0 }}>{t("memory.empty")}</p>
        ) : (
          Object.entries(grouped).map(([category, items]) => (
            <div key={category} style={{ marginBottom: 14 }}>
              <p style={{ margin: "0 0 6px", fontSize: 10, fontFamily: "Manrope, sans-serif", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: CATEGORY_COLORS[category] ?? "#c0c1ff" }}>
                {category.replace("_", " ")}
              </p>
              {items.map((mem) => (
                <div key={mem.id} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "flex-start" }}>
                  <span style={{ flex: 1, fontSize: 11, color: "rgba(255,255,255,.6)", lineHeight: 1.4 }}>{mem.content}</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end", flexShrink: 0 }}>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,.25)" }}>{formatRelative(mem.created_at)}</span>
                    <button type="button" onClick={() => void handleDelete(mem.id)} style={{ background: "none", border: "none", color: "rgba(255,255,255,.2)", cursor: "pointer", fontSize: 12, lineHeight: 1 }}>×</button>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <div style={{ padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,.06)" }}>
        <button
          type="button"
          onClick={() => void handleClearAll()}
          style={{
            width: "100%",
            background: clearConfirm ? "rgba(239,68,68,.15)" : "rgba(255,255,255,.04)",
            border: `1px solid ${clearConfirm ? "rgba(239,68,68,.3)" : "rgba(255,255,255,.08)"}`,
            borderRadius: 7,
            color: clearConfirm ? "#ef4444" : "rgba(255,255,255,.4)",
            fontSize: 11,
            padding: "6px",
            cursor: "pointer",
          }}
        >
          {clearConfirm ? t("memory.confirmClear", { count: memories.length }) : t("memory.clearAll")}
        </button>
      </div>
    </div>
  );
};
