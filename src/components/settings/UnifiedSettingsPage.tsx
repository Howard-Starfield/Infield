import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Cog,
  Cpu,
  MessageSquare,
  Sparkles,
  FlaskConical,
  Info,
  Mic,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import AccessibilityPermissions from "../AccessibilityPermissions";
import { GeneralSettings } from "./general/GeneralSettings";
import { ModelsSettings } from "./models/ModelsSettings";
import { ChatProvidersSettings } from "./ChatProvidersSettings";
import { WorkspaceAppearanceSettings } from "./workspace/WorkspaceAppearanceSettings";
import { AiPromptsSettings } from "./AiPromptsSettings";
import { AdvancedSettings } from "./advanced/AdvancedSettings";
import { PostProcessingSettings } from "./post-processing/PostProcessingSettings";
import { DebugSettings } from "./debug/DebugSettings";
import { AboutSettings } from "./about/AboutSettings";

interface SectionDef {
  id: string;
  title: string;
  eyebrow: string;
  icon: LucideIcon;
  component: React.ComponentType;
}

interface NavGroup {
  label: string;
  sections: SectionDef[];
}

interface UnifiedSettingsPageProps {
  /** When set (e.g. from TopBar), scrolls this section into view. */
  activeSection?: string;
  /** Fired when the visible section changes (nav click, scroll, or external activeSection). */
  onSectionChange?: (sectionId: string) => void;
}

function SectionHeader({ num, title, eyebrow }: { num: number; title: string; eyebrow: string }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div
        style={{
          fontSize: 10,
          fontFamily: "Space Grotesk, sans-serif",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".14em",
          color: "var(--workspace-accent-secondary)",
          marginBottom: 6,
        }}
      >
        {String(num).padStart(2, "0")} — {eyebrow}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 800,
          fontFamily: "Manrope, sans-serif",
          color: "var(--workspace-text)",
          letterSpacing: "-0.025em",
          marginBottom: 16,
        }}
      >
        {title}
      </div>
      <div
        style={{
          height: 1,
          background: "linear-gradient(90deg, var(--workspace-accent) 0%, transparent 55%)",
          opacity: 0.35,
        }}
      />
    </div>
  );
}

export function UnifiedSettingsPage({
  activeSection,
  onSectionChange,
}: UnifiedSettingsPageProps) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const contentRef = useRef<HTMLDivElement>(null);
  // Keep nav highlight aligned with parent `activeSection` on mount (e.g. returning to Settings tab).
  const [activeNav, setActiveNav] = useState<string>(() => activeSection ?? "general");
  const isExternalScrollRef = useRef(false);

  const postProcessEnabled = settings?.post_process_enabled ?? false;
  const debugEnabled = settings?.debug_mode ?? false;

  const coreGroup: NavGroup = {
    label: "Core",
    sections: [
      { id: "general",     title: t("sidebar.general", "General"),     eyebrow: "Audio & Shortcuts", icon: Mic,            component: GeneralSettings },
      { id: "models",      title: t("sidebar.models", "Models"),       eyebrow: "Download & Manage", icon: Cpu,            component: ModelsSettings },
    ],
  };

  const intelligenceGroup: NavGroup = {
    label: "Intelligence",
    sections: [
      { id: "llmProviders", title: t("sidebar.llmProviders", "AI Providers"), eyebrow: "External APIs",    icon: Zap,          component: ChatProvidersSettings },
      { id: "aiPrompts",    title: t("sidebar.aiPrompts", "AI Prompts"),       eyebrow: "Customization",   icon: MessageSquare, component: AiPromptsSettings },
      ...(postProcessEnabled ? [{ id: "postprocessing", title: t("sidebar.postProcessing", "Post Processing"), eyebrow: "Text Pipeline", icon: Sparkles, component: PostProcessingSettings }] : []),
    ],
  };

  const workspaceGroup: NavGroup = {
    label: "Workspace",
    sections: [
      { id: "appearance", title: "Appearance", eyebrow: "Themes & Layout", icon: Sparkles, component: WorkspaceAppearanceSettings },
    ],
  };

  const systemGroup: NavGroup = {
    label: "System",
    sections: [
      { id: "advanced",    title: t("sidebar.advanced", "Advanced"),   eyebrow: "Power User",      icon: Cog,           component: AdvancedSettings },
      ...(debugEnabled ? [{ id: "debug", title: t("sidebar.debug", "Debug"), eyebrow: "Developer Tools", icon: FlaskConical, component: DebugSettings }] : []),
      { id: "about",       title: t("sidebar.about", "About"),         eyebrow: "Version & Credits", icon: Info,        component: AboutSettings },
    ],
  };

  const navGroups: NavGroup[] = [coreGroup, intelligenceGroup, workspaceGroup, systemGroup];
  const allSections: SectionDef[] = navGroups.flatMap((g) => g.sections);

  const onSectionChangeRef = useRef(onSectionChange);
  onSectionChangeRef.current = onSectionChange;

  useEffect(() => {
    onSectionChangeRef.current?.(activeNav);
  }, [activeNav]);

  // Scroll to section when parent `activeSection` changes (sidebar, deep link, remount with saved section).
  // Use "auto" here so remounting Settings does not run a long smooth scroll from top while scroll-spy runs;
  // in-nav clicks still use smooth scroll via scrollToSection().
  useEffect(() => {
    if (!activeSection || !contentRef.current) return;
    const el = contentRef.current.querySelector(`#settings-section-${activeSection}`);
    if (el) {
      isExternalScrollRef.current = true;
      el.scrollIntoView({ behavior: "auto", block: "start" });
      setActiveNav(activeSection);
      setTimeout(() => { isExternalScrollRef.current = false; }, 80);
    }
  }, [activeSection]);

  // Scroll-spy: update active nav as user scrolls through sections
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isExternalScrollRef.current) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.id.replace("settings-section-", "");
            setActiveNav(id);
            break;
          }
        }
      },
      {
        root: container,
        rootMargin: "-5% 0px -80% 0px",
        threshold: 0,
      },
    );

    allSections.forEach((s) => {
      const el = container.querySelector(`#settings-section-${s.id}`);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [postProcessEnabled, debugEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollToSection = (id: string) => {
    if (!contentRef.current) return;
    const el = contentRef.current.querySelector(`#settings-section-${id}`);
    if (el) {
      isExternalScrollRef.current = true;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveNav(id);
      setTimeout(() => { isExternalScrollRef.current = false; }, 600);
    }
  };

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>

      {/* ── Left sticky nav ─────────────────────────────────── */}
      <div
        style={{
          width: 196,
          flexShrink: 0,
          overflowY: "auto",
          borderRight: "1px solid var(--workspace-border)",
          background: "var(--workspace-pane)",
          padding: "32px 0 40px",
          display: "flex",
          flexDirection: "column",
          gap: 0,
        }}
      >
        {/* Page title in nav */}
        <div style={{ padding: "0 18px 20px" }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 800,
              fontFamily: "Manrope, sans-serif",
              color: "var(--workspace-text)",
              letterSpacing: "-0.02em",
            }}
          >
            Settings
          </div>
        </div>

        {/* Nav groups */}
        {navGroups.map((group, gi) => {
          const prevItemCount = navGroups.slice(0, gi).reduce((s, g) => s + g.sections.length, 0);
          return (
            <div key={group.label} className="settings-nav-group" style={{ marginBottom: 20, animationDelay: `${gi * 60}ms` }}>
              <div style={{ fontSize: 9, fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".14em", color: "var(--workspace-text-soft)", padding: "0 18px", marginBottom: 4 }}>
                {group.label}
              </div>
              {group.sections.map((section, si) => {
                const Icon = section.icon;
                const isActive = activeNav === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => scrollToSection(section.id)}
                    className="settings-nav-item sidebar-nav-btn"
                    style={{
                      display: "flex", alignItems: "center", gap: 9,
                      width: "100%", padding: "7px 18px",
                      border: "none",
                      borderLeft: isActive ? "2px solid var(--workspace-accent)" : "2px solid transparent",
                      background: isActive ? "var(--workspace-accent-soft)" : "transparent",
                      color: isActive ? "var(--workspace-accent)" : "var(--workspace-text-muted)",
                      cursor: "pointer", textAlign: "left",
                      animationDelay: `${gi * 60 + si * 40 + 50}ms`,
                    }}
                  >
                    <Icon size={14} color={isActive ? "var(--workspace-accent)" : "var(--workspace-text-soft)"} />
                    <span style={{ fontSize: 12, fontFamily: "Manrope, sans-serif", fontWeight: isActive ? 700 : 500, letterSpacing: "-0.01em" }}>
                      {section.title}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* ── Right scrollable content ────────────────────────── */}
      <div
        ref={contentRef}
        style={{
          flex: 1,
          overflowY: "auto",
          background: "var(--workspace-bg)",
        }}
      >
        <div style={{ padding: "40px 52px 80px", maxWidth: 900, margin: "0 auto" }}>

          {/* Accessibility permissions banner */}
          <div style={{ marginBottom: 36 }}>
            <AccessibilityPermissions />
          </div>

          {allSections.map((section, index) => {
            const Component = section.component;
            return (
              <div
                key={section.id}
                id={`settings-section-${section.id}`}
                style={{ scrollMarginTop: 24, marginBottom: 64 }}
              >
                <SectionHeader num={index + 1} title={section.title} eyebrow={section.eyebrow} />
                <Component />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
