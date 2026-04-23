import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { WorkspaceMenuSurface } from "@/components/workspace/chrome/workspaceMenuChrome";
import {
  WorkspaceFloatingPortal,
  placeBelowAnchor,
  workspaceFloatingBackdropZ,
  workspaceFloatingZ,
} from "@/lib/workspaceFloatingLayer";

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface DropdownProps {
  options: DropdownOption[];
  className?: string;
  selectedValue: string | null;
  onSelect: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onRefresh?: () => void;
}

export const Dropdown: React.FC<DropdownProps> = ({
  options,
  selectedValue,
  onSelect,
  className = "",
  placeholder = "Select an option...",
  disabled = false,
  onRefresh,
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuPortalRef = useRef<HTMLDivElement>(null);
  const [menuLayout, setMenuLayout] = useState<{ top: number; left: number; width: number } | null>(null);

  const syncMenuLayout = () => {
    const btn = triggerRef.current;
    if (!btn || !isOpen) {
      setMenuLayout(null);
      return;
    }
    const r = btn.getBoundingClientRect();
    const { top, left } = placeBelowAnchor(r, { gap: 4, menuWidth: r.width, menuHeight: 240 });
    setMenuLayout({ top, left, width: r.width });
  };

  useLayoutEffect(() => {
    if (!isOpen || disabled) {
      setMenuLayout(null);
      return;
    }
    syncMenuLayout();
  }, [isOpen, disabled]);

  useEffect(() => {
    if (!isOpen) return;
    const onScroll = () => syncMenuLayout();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const t = event.target as Node;
      if (dropdownRef.current?.contains(t)) return;
      if (menuPortalRef.current?.contains(t)) return;
      setIsOpen(false);
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const selectedOption = options.find((o) => o.value === selectedValue);

  const handleToggle = () => {
    if (disabled) return;
    if (!isOpen && onRefresh) onRefresh();
    setIsOpen(!isOpen);
  };

  const handleSelect = (value: string) => {
    onSelect(value);
    setIsOpen(false);
  };

  return (
    <div style={{ position: "relative" }} className={className} ref={dropdownRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          minWidth: 200,
          padding: "6px 10px",
          background: "var(--workspace-panel)",
          border: `1px solid ${isOpen ? "var(--workspace-accent)" : "var(--workspace-border-strong)"}`,
          color: "var(--workspace-text)",
          fontSize: 13,
          fontFamily: "Inter, sans-serif",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          outline: "none",
          transition: "border-color 150ms",
          boxShadow: isOpen ? `0 0 0 2px var(--workspace-accent-soft)` : "none",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selectedOption ? "var(--workspace-text)" : "var(--workspace-text-soft)" }}>
          {selectedOption?.label ?? placeholder}
        </span>
        <svg
          width={12}
          height={12}
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--workspace-text-soft)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 180ms ease", flexShrink: 0 }}
        >
          <path d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && !disabled && menuLayout && (
        <WorkspaceFloatingPortal>
          <div
            role="presentation"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: workspaceFloatingBackdropZ(),
              background: "transparent",
            }}
            onMouseDown={() => setIsOpen(false)}
          />
          <WorkspaceMenuSurface
            ref={menuPortalRef}
            style={{
              position: "fixed",
              top: menuLayout.top,
              left: menuLayout.left,
              width: menuLayout.width,
              zIndex: Number.parseInt(workspaceFloatingZ(), 10) || 12001,
              maxHeight: 240,
              overflowY: "auto",
              padding: 0,
              boxShadow: "var(--workspace-shadow)",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {options.length === 0 ? (
              <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--workspace-text-soft)", fontFamily: "Inter, sans-serif" }}>
                {t("common.noOptionsFound")}
              </div>
            ) : (
              options.map((option) => {
                const isSelected = selectedValue === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => !option.disabled && handleSelect(option.value)}
                    disabled={option.disabled}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "7px 10px",
                      textAlign: "left",
                      fontSize: 13,
                      fontFamily: "Inter, sans-serif",
                      color: "var(--workspace-text)",
                      background: isSelected ? "var(--workspace-accent-soft)" : "transparent",
                      border: "none",
                      borderLeft: isSelected ? "2px solid var(--workspace-accent)" : "2px solid transparent",
                      cursor: option.disabled ? "not-allowed" : "pointer",
                      opacity: option.disabled ? 0.45 : 1,
                      fontWeight: isSelected ? 600 : 400,
                      outline: "none",
                      transition: "background 120ms",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected && !option.disabled)
                        (e.currentTarget as HTMLButtonElement).style.background = "var(--workspace-accent-soft)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected)
                        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                    }}
                  >
                    {option.label}
                  </button>
                );
              })
            )}
          </WorkspaceMenuSurface>
        </WorkspaceFloatingPortal>
      )}
    </div>
  );
};
