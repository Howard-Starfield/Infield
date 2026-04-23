import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Database, FileText, Table2 } from "lucide-react";
import { commands } from "@/bindings";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorkspaceRecents } from "@/hooks/useWorkspaceRecents";
import { toast } from "sonner";
import { MemoryPanel } from "./MemoryPanel";
import { HomeNotePreviewModal } from "./HomeNotePreviewModal";
import type { AppView } from "@/App";
import type { WorkspaceNode } from "@/types/workspace";
import {
  averageWordsPerNode,
  countRootDatabases,
  nodeWordCount,
  nodesUpdatedTodayCount,
  totalWordsFromNodes,
  weekActivityFromNodes,
} from "@/lib/homeWorkspaceMetrics";
import { formatRelativeTime } from "@/lib/formatRelativeTime";

const CARD_RADIUS = "max(12px, calc(var(--workspace-panel-radius) * 1.35))";

const dashboardCardStyle: React.CSSProperties = {
  background: "var(--workspace-widget-card-bg)",
  backdropFilter: "blur(16px) saturate(1.05)",
  borderRadius: CARD_RADIUS,
  border: "1px solid var(--workspace-border)",
  boxShadow: "var(--workspace-shadow)",
  overflow: "hidden",
};

const QUICK_CREATE_CHIPS: { label: string; noteType: string }[] = [
  { label: "To-do", noteType: "todo" },
  { label: "New Board", noteType: "board" },
  { label: "New Calendar", noteType: "calendar" },
  { label: "Gallery", noteType: "gallery" },
  { label: "Chart", noteType: "chart" },
  { label: "Table", noteType: "table" },
  { label: "Voice Note", noteType: "voice_memo" },
];

function nodeTypeIcon(nodeType: WorkspaceNode["node_type"]) {
  if (nodeType === "database") return Database;
  if (nodeType === "row") return Table2;
  return FileText;
}

type DashboardDocument = WorkspaceNode & {
  title?: string;
  word_count?: number;
};

interface HomeTabProps {
  onNavigate: (view: AppView) => void;
}

export const HomeTab: React.FC<HomeTabProps> = ({ onNavigate }) => {
  const { t } = useTranslation();
  const [previewNoteId, setPreviewNoteId] = useState<string | null>(null);
  const workspaceCreateNode = useWorkspaceStore((s) => s.createNode);
  const workspaceSetActiveNode = useWorkspaceStore((s) => s.setActiveNode);
  const workspaceLoadViews = useWorkspaceStore((s) => s.loadViews);
  const workspaceCreateView = useWorkspaceStore((s) => s.createView);
  const workspaceAddField = useWorkspaceStore((s) => s.addField);
  const workspaceNavigateTo = useWorkspaceStore((s) => s.navigateTo);
  const workspaceUpdateNode = useWorkspaceStore((s) => s.updateNode);
  const workspaceTreeRevision = useWorkspaceStore((s) => s.workspaceTreeRevision);
  const { recents } = useWorkspaceRecents();
  const [rootNodes, setRootNodes] = useState<WorkspaceNode[]>([]);
  const [workspaceDocuments, setWorkspaceDocuments] = useState<DashboardDocument[]>([]);

  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const sessionId = React.useRef(crypto.randomUUID());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const roots = await invoke<WorkspaceNode[]>("get_root_nodes");
        if (!cancelled) setRootNodes(roots);
      } catch {
        if (!cancelled) setRootNodes([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceTreeRevision]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const roots = await invoke<WorkspaceNode[]>("get_root_nodes");
        const all: WorkspaceNode[] = [...roots];
        const queue = roots
          .filter((node) => node.node_type === "document" || node.node_type === "database")
          .map((node) => node.id);

        while (queue.length > 0) {
          const parentId = queue.shift();
          if (!parentId) continue;
          const children = await invoke<WorkspaceNode[]>("get_node_children", { parentId });
          for (const child of children) {
            all.push(child);
            if (child.node_type === "document" || child.node_type === "database") {
              queue.push(child.id);
            }
          }
        }

        if (cancelled) return;
        setWorkspaceDocuments(
          all
            .filter((node) => !node.deleted_at && node.node_type === "document")
            .map((node) => ({
              ...node,
              title: node.name,
              word_count: nodeWordCount(node),
            }))
            .sort((a, b) => b.updated_at - a.updated_at),
        );
      } catch {
        if (!cancelled) setWorkspaceDocuments([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceTreeRevision]);

  const recentNotesForDashboard = useMemo(
    () => workspaceDocuments.slice(0, 5),
    [workspaceDocuments],
  );

  const weekStats = useMemo(() => weekActivityFromNodes(workspaceDocuments), [workspaceDocuments]);
  const capturesToday = useMemo(() => nodesUpdatedTodayCount(workspaceDocuments), [workspaceDocuments]);
  const avgWords = useMemo(() => averageWordsPerNode(workspaceDocuments), [workspaceDocuments]);
  const rootDbCount = useMemo(() => countRootDatabases(rootNodes), [rootNodes]);
  const totalWords = useMemo(() => totalWordsFromNodes(workspaceDocuments), [workspaceDocuments]);

  const weekdaysShort = t("home.dashboard.weekdaysShort", { returnObjects: true }) as unknown as string[];
  const dayLabels = Array.isArray(weekdaysShort) && weekdaysShort.length === 7
    ? weekdaysShort
    : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const mostActiveDay = dayLabels[weekStats.mostActiveIndex] ?? "—";

  const copyToClipboard = (text: string) => {
    if (!navigator.clipboard?.writeText) {
      toast.error(t("home.dashboard.copyFailed"));
      return;
    }
    void navigator.clipboard.writeText(text).then(
      () => toast.success(t("home.dashboard.copiedName")),
      () => toast.error(t("home.dashboard.copyFailed")),
    );
  };

  useEffect(() => {
    const unlisten = listen<{ session_id: string; token: string; done: boolean }>(
      "chat-token",
      (event) => {
        if (event.payload.session_id !== sessionId.current) return;
        if (event.payload.done) {
          setIsStreaming(false);
          return;
        }
        setChatMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== "assistant") {
            return [...prev, { role: "assistant", content: event.payload.token }];
          }
          return [...prev.slice(0, -1), { ...last, content: last.content + event.payload.token }];
        });
      },
    );
    const unlistenError = listen<{ session_id: string; error: string }>(
      "chat-error",
      (event) => {
        if (event.payload.session_id !== sessionId.current) return;
        setIsStreaming(false);
        toast.error(event.payload.error ?? t("home.chat.noProviderConfigured"));
      },
    );
    return () => {
      unlisten.then((fn) => fn());
      unlistenError.then((fn) => fn());
    };
  }, [t]);

  const handleSend = async () => {
    if (!chatInput.trim() || isStreaming) return;
    const userMsg = { role: "user" as const, content: chatInput };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setIsStreaming(true);

    const allMessages = [...chatMessages, userMsg];
    const result = await commands.sendChatMessage(sessionId.current, allMessages);
    if (result.status !== "ok") {
      toast.error(result.error ?? t("home.chat.noProviderConfigured"));
      setIsStreaming(false);
    }
  };

  const openNotePreview = (id: string) => {
    if (!workspaceDocuments.some((n) => n.id === id)) return;
    setPreviewNoteId(id);
  };

  const openNoteInEditor = (id: string) => {
    setPreviewNoteId(null);
    void workspaceNavigateTo(id, { source: "tree" });
    onNavigate({ tab: "notes", nodeId: id });
  };

  const handleOpenWorkspaceNode = (nodeId: string) => {
    void workspaceNavigateTo(nodeId, { source: "tree" });
    onNavigate({ tab: "notes", nodeId });
  };

  const handleQuickCreate = async (noteType: string) => {
    if (noteType === "voice_memo") {
      toast.info(t("home.quickCreate.voiceError"));
      return;
    }

    if (noteType === "board") {
      const title = `${QUICK_CREATE_CHIPS.find((c) => c.noteType === noteType)?.label ?? "New Board"} — ${new Date().toLocaleDateString()}`;
      try {
        const node = await workspaceCreateNode(null, "database", title);
        workspaceSetActiveNode(node);
        onNavigate({ tab: "databases", nodeId: node.id });
      } catch (e) {
        toast.error(`Failed to create ${noteType}: ${e}`);
      }
      return;
    }

    if (noteType === "calendar") {
      const title = `${QUICK_CREATE_CHIPS.find((c) => c.noteType === noteType)?.label ?? "New Calendar"} — ${new Date().toLocaleDateString()}`;
      try {
        const node = await workspaceCreateNode(null, "database", title);
        await workspaceLoadViews(node.id);
        const viewLabel = (layout: string) =>
          layout === "board"
            ? t("tree.newDbBoard", { defaultValue: "Board" })
            : layout === "grid"
              ? t("tree.newDbTable", { defaultValue: "Table" })
              : t("tree.newDbCalendar", { defaultValue: "Calendar" });
        for (const layout of ["calendar", "board", "grid"] as const) {
          await workspaceCreateView(node.id, viewLabel(layout), layout);
        }
        await workspaceAddField(
          node.id,
          t("tree.calendarDefaultStartField", { defaultValue: "Start" }),
          "date_time",
        );
        await workspaceAddField(
          node.id,
          t("tree.calendarDefaultEndField", { defaultValue: "End" }),
          "date_time",
        );
        workspaceSetActiveNode(node);
        onNavigate({ tab: "databases", nodeId: node.id });
      } catch (e) {
        toast.error(`Failed to create ${noteType}: ${e}`);
      }
      return;
    }

    const title = `${QUICK_CREATE_CHIPS.find((c) => c.noteType === noteType)?.label ?? "New Note"} — ${new Date().toLocaleDateString()}`;
    const node = await workspaceCreateNode(null, "document", title);
    if (node) {
      setPreviewNoteId(node.id);
    }
  };

  const handleCreateQuickCapture = async (title: string, body: string) => {
    try {
      const node = await workspaceCreateNode(null, "document", title);
      await workspaceUpdateNode(
        node.id,
        title,
        node.icon,
        node.properties,
        body,
      );
      return {
        ...node,
        name: title,
        body,
      };
    } catch (error) {
      toast.error(
        t("home.quickCreate.noteError", {
          defaultValue: "Couldn't save quick note",
        }),
        {
          description: error instanceof Error ? error.message : String(error),
        },
      );
      return null;
    }
  };

  const statMiniLabel: React.CSSProperties = {
    fontSize: 10,
    color: "var(--workspace-text-soft)",
    textTransform: "uppercase",
    letterSpacing: ".06em",
    fontFamily: "Manrope, sans-serif",
    fontWeight: 700,
  };

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "28px 30px 34px",
          position: "relative",
          background: "transparent",
        }}
      >
        <div className="animate-orb1" style={{ position: "fixed", width: 520, height: 520, borderRadius: "50%", background: "var(--workspace-orb-1)", filter: "blur(80px)", top: -90, left: "28%", pointerEvents: "none", zIndex: 0 }} />
        <div className="animate-orb2" style={{ position: "fixed", width: 420, height: 420, borderRadius: "50%", background: "var(--workspace-orb-2)", filter: "blur(80px)", bottom: -80, right: "12%", pointerEvents: "none", zIndex: 0 }} />
        <div className="animate-orb3" style={{ position: "fixed", width: 340, height: 340, borderRadius: "50%", background: "var(--workspace-orb-3)", filter: "blur(72px)", top: "42%", left: -40, pointerEvents: "none", zIndex: 0 }} />

        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ marginBottom: 18 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--workspace-text-muted)" }}>
              {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </p>
          </div>

          {/* Dashboard: welcome + week chart */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 14,
              marginBottom: 22,
            }}
          >
            <div style={{ ...dashboardCardStyle, flex: "1 1 320px", padding: "20px 22px 22px" }}>
              <div className="workspace-eyebrow" style={{ marginBottom: 8 }}>
                {t("home.dashboard.eyebrow")}
              </div>
              <h2 className="workspace-display-heading" style={{ fontSize: 22, marginBottom: 10 }}>
                {t("home.dashboard.welcomeBack")}
              </h2>
              <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--workspace-text)", fontFamily: "Manrope, system-ui, sans-serif", lineHeight: 1.05 }}>
                {totalWords.toLocaleString()}
              </div>
              <p className="workspace-display-subtitle" style={{ fontSize: 13, marginTop: 6, marginBottom: 18 }}>
                {t("home.dashboard.primaryMetricLabel")}
              </p>
              <p style={{ fontSize: 12, color: "var(--workspace-text-muted)", margin: "0 0 18px" }}>
                {t("home.dashboard.secondaryLine")}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "var(--workspace-accent)", fontFamily: "Manrope, sans-serif" }}>{capturesToday}</div>
                  <div style={statMiniLabel}>{t("home.dashboard.statsCapturesToday")}</div>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "var(--workspace-accent)", fontFamily: "Manrope, sans-serif" }}>{workspaceDocuments.length}</div>
                  <div style={statMiniLabel}>{t("home.dashboard.statsTotalNotes")}</div>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "var(--workspace-accent)", fontFamily: "Manrope, sans-serif" }}>{rootDbCount}</div>
                  <div style={statMiniLabel}>{t("home.dashboard.statsBasesAtRoot")}</div>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "var(--workspace-accent)", fontFamily: "Manrope, sans-serif" }}>{avgWords}</div>
                  <div style={statMiniLabel}>{t("home.dashboard.statsAvgWords")}</div>
                </div>
              </div>
            </div>

            <div style={{ ...dashboardCardStyle, flex: "1 1 280px", padding: "20px 22px 22px" }}>
              <h3 className="workspace-display-heading" style={{ fontSize: 18, marginBottom: 4 }}>
                {t("home.dashboard.thisWeek")}
              </h3>
              <p style={{ fontSize: 12, color: "var(--workspace-text-muted)", margin: "0 0 16px" }}>
                {t("home.dashboard.weekActivity", { count: weekStats.total, day: mostActiveDay })}
              </p>
              <div style={{ display: "flex", alignItems: "stretch", justifyContent: "space-between", gap: 6, height: 128, paddingTop: 4 }}>
                {weekStats.counts.map((c, i) => {
                  const weekMax = Math.max(...weekStats.counts);
                  const barPct = weekMax === 0 ? 0 : (c / weekMax) * 100;
                  const isMax = c > 0 && c === weekMax;
                  return (
                    <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--workspace-text-muted)", minHeight: 14 }}>{c > 0 ? c : ""}</span>
                      <div
                        style={{
                          flex: 1,
                          width: "100%",
                          maxWidth: 36,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "flex-end",
                          alignItems: "center",
                        }}
                      >
                        <div
                          style={{
                            width: "80%",
                            height: `${Math.max(c === 0 ? 2 : 6, barPct)}%`,
                            maxHeight: "100%",
                            borderRadius: 6,
                            background: isMax ? "var(--workspace-home-chart-bar)" : "var(--workspace-home-chart-bar-muted)",
                            transition: "height 200ms ease",
                          }}
                        />
                      </div>
                      <span style={{ fontSize: 10, color: "var(--workspace-home-chart-axis)", fontFamily: "Manrope, sans-serif" }}>
                        {dayLabels[i]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Recent activity */}
          <div style={{ ...dashboardCardStyle, marginBottom: 22, padding: "18px 20px 20px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
              <h3 className="workspace-display-heading" style={{ fontSize: 18 }}>
                {t("home.dashboard.recentActivity")}
              </h3>
              <button
                type="button"
                onClick={() => onNavigate({ tab: "search" })}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--workspace-accent)",
                  fontFamily: "Manrope, sans-serif",
                }}
              >
                {t("home.dashboard.viewAllSearch")}
              </button>
            </div>

            <p style={{ ...statMiniLabel, margin: "0 0 8px" }}>{t("home.dashboard.workspaceSection")}</p>
            {recents.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--workspace-text-soft)", margin: "0 0 16px" }}>{t("home.dashboard.emptyRecents")}</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: 18 }}>
                {recents.slice(0, 5).map((r) => {
                  const Icon = nodeTypeIcon(r.node_type);
                  return (
                    <div
                      key={r.nodeId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 0",
                        borderBottom: "1px solid var(--workspace-border)",
                      }}
                    >
                      <Icon size={18} strokeWidth={1.75} style={{ color: "var(--workspace-text-muted)", flexShrink: 0 }} aria-hidden />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: "var(--workspace-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.name}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--workspace-text-muted)", marginTop: 2 }}>
                          {formatRelativeTime(r.viewedAt)}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(r.name)}
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: "4px 10px",
                            borderRadius: "var(--workspace-menu-radius)",
                            border: "1px solid var(--workspace-border)",
                            background: "var(--workspace-chat-surface-raised)",
                            color: "var(--workspace-text-muted)",
                            cursor: "pointer",
                            fontFamily: "Manrope, sans-serif",
                          }}
                        >
                          {t("home.dashboard.copy")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenWorkspaceNode(r.nodeId)}
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: "4px 10px",
                            borderRadius: "var(--workspace-menu-radius)",
                            border: "1px solid var(--workspace-border-strong)",
                            background: "var(--workspace-accent-soft)",
                            color: "var(--workspace-text)",
                            cursor: "pointer",
                            fontFamily: "Manrope, sans-serif",
                          }}
                        >
                          {t("home.dashboard.open")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <p style={{ ...statMiniLabel, margin: "0 0 8px" }}>{t("home.dashboard.notesSection")}</p>
            {recentNotesForDashboard.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--workspace-text-soft)", margin: 0 }}>{t("notes.empty")}</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {recentNotesForDashboard.map((note) => (
                  <div
                    key={note.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openNotePreview(note.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openNotePreview(note.id);
                      }
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 0",
                      borderBottom: "1px solid var(--workspace-border)",
                      cursor: "pointer",
                    }}
                  >
                    <FileText size={18} strokeWidth={1.75} style={{ color: "var(--workspace-text-muted)", flexShrink: 0 }} aria-hidden />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "var(--workspace-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {note.name || t("notes.untitled")}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--workspace-text-muted)", marginTop: 2 }}>
                        {formatRelativeTime(note.updated_at)}
                        {nodeWordCount(note) > 0
                          ? ` · ${t("home.dashboard.wordCountShort", { count: nodeWordCount(note) })}`
                          : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(note.name || t("notes.untitled"))}
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "4px 10px",
                          borderRadius: "var(--workspace-menu-radius)",
                          border: "1px solid var(--workspace-border)",
                          background: "var(--workspace-chat-surface-raised)",
                          color: "var(--workspace-text-muted)",
                          cursor: "pointer",
                          fontFamily: "Manrope, sans-serif",
                        }}
                      >
                        {t("home.dashboard.copy")}
                      </button>
                      <button
                        type="button"
                        onClick={() => openNotePreview(note.id)}
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "4px 10px",
                          borderRadius: "var(--workspace-menu-radius)",
                          border: "1px solid var(--workspace-border-strong)",
                          background: "var(--workspace-accent-soft)",
                          color: "var(--workspace-text)",
                          cursor: "pointer",
                          fontFamily: "Manrope, sans-serif",
                        }}
                      >
                        {t("home.dashboard.previewNote")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="workspace-eyebrow" style={{ marginBottom: 10 }}>
            {t("home.dashboard.assistantEyebrow")}
          </div>

          <div
            style={{
              background: "var(--workspace-chat-home-bar-bg)",
              border: "1px solid var(--workspace-border-strong)",
              borderRadius: CARD_RADIUS,
              padding: "16px 18px",
              marginBottom: 22,
              position: "relative",
              boxShadow: "var(--workspace-shadow)",
            }}
          >
            <div
              className="animate-glow-pulse"
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: 3,
                borderRadius: `${CARD_RADIUS} 0 0 ${CARD_RADIUS}` as React.CSSProperties["borderRadius"],
                background: "var(--workspace-chat-home-accent-stripe)",
              }}
            />

            {chatMessages.length > 0 && (
              <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 8, maxHeight: 240, overflowY: "auto" }}>
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    style={{
                      alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                      background:
                        msg.role === "user"
                          ? "var(--workspace-chat-home-user-bubble-bg)"
                          : "var(--workspace-chat-home-assistant-bubble-bg)",
                      border: "1px solid var(--workspace-border)",
                      borderRadius: 14,
                      padding: "8px 12px",
                      fontSize: 12,
                      color: "var(--workspace-chat-input-text)",
                      maxWidth: "85%",
                      fontFamily: "Segoe UI Variable Text, Segoe UI, sans-serif",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {msg.content}
                  </div>
                ))}
                {isStreaming && (
                  <div style={{ alignSelf: "flex-start", fontSize: 11, color: "var(--workspace-text-soft)", fontFamily: "Inter, sans-serif" }}>
                    …
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="text"
                placeholder={t("home.chat.inputPlaceholder")}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                style={{
                  flex: 1,
                  background: "var(--workspace-chat-input-bg)",
                  border: "1px solid var(--workspace-border-strong)",
                  borderRadius: 999,
                  padding: "8px 14px",
                  color: "var(--workspace-chat-input-text)",
                  fontSize: 13,
                  outline: "none",
                  fontFamily: "Segoe UI Variable Text, Segoe UI, sans-serif",
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleSend();
                  }
                }}
              />
              <button
                type="button"
                disabled={isStreaming || !chatInput.trim()}
                onClick={() => void handleSend()}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 12,
                  background: isStreaming || !chatInput.trim()
                    ? "var(--workspace-chat-home-send-idle-bg)"
                    : "var(--workspace-chat-send-btn-bg)",
                  border: "1px solid var(--workspace-border-strong)",
                  color: isStreaming || !chatInput.trim()
                    ? "var(--workspace-text-soft)"
                    : "var(--workspace-chat-send-btn-text)",
                  cursor: isStreaming || !chatInput.trim() ? "default" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  position: "relative",
                }}
              >
                <span className="ms" style={{ fontSize: 16 }}>send</span>
              </button>
              <button
                type="button"
                onClick={() => setShowMemoryPanel((v) => !v)}
                style={{
                  background: showMemoryPanel ? "var(--workspace-accent-soft)" : "var(--workspace-chat-surface-raised)",
                  border: "1px solid var(--workspace-border)",
                  color: showMemoryPanel ? "var(--workspace-text)" : "var(--workspace-text-muted)",
                  cursor: "pointer",
                  padding: "6px 8px",
                  borderRadius: 10,
                  fontSize: 16,
                }}
                title={t("memory.title")}
              >
                <span className="ms">psychology</span>
              </button>
            </div>

            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              {QUICK_CREATE_CHIPS.map((chip, i) => (
                <button
                  key={chip.noteType}
                  type="button"
                  onClick={() => void handleQuickCreate(chip.noteType)}
                  style={{
                    background: "var(--workspace-chat-chip-bg)",
                    border: "1px solid var(--workspace-border)",
                    borderRadius: 999,
                    color: "var(--workspace-text-muted)",
                    fontSize: 11,
                    padding: "5px 10px",
                    cursor: "pointer",
                    fontFamily: "Segoe UI Variable Text, Segoe UI, sans-serif",
                    animation: `chipIn 200ms cubic-bezier(.34,1.2,.64,1) ${i * 40}ms both`,
                    transition: "background 150ms, color 150ms",
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

        </div>
      </div>
      <HomeNotePreviewModal
        noteId={previewNoteId}
        onClose={() => setPreviewNoteId(null)}
        onOpenInEditor={openNoteInEditor}
      />
      {showMemoryPanel && <MemoryPanel onClose={() => setShowMemoryPanel(false)} />}
    </div>
  );
};
