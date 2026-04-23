import {
  forwardRef,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";

/** Panel chrome for floating menus / compact popovers (tied to Workspace Appearance). */
export function workspaceMenuSurfaceStyle(
  overrides?: CSSProperties,
): CSSProperties {
  return {
    background: "var(--workspace-menu-surface-bg)",
    backdropFilter: "blur(var(--workspace-panel-blur))",
    WebkitBackdropFilter: "blur(var(--workspace-panel-blur))",
    border: "1px solid var(--workspace-border-strong)",
    borderRadius: "var(--workspace-menu-radius)",
    boxShadow: "var(--workspace-shadow-soft)",
    /* Clip row hovers to the menu radius; horizontal inset replaces per-item side margins. */
    overflow: "hidden",
    padding: "4px",
    ...overrides,
  };
}

export const WorkspaceMenuSurface = forwardRef<
  HTMLDivElement,
  {
    children: ReactNode;
    style?: CSSProperties;
    className?: string;
    onMouseDown?: (e: MouseEvent<HTMLDivElement>) => void;
    role?: string;
  }
>(function WorkspaceMenuSurface(
  { children, style, className, onMouseDown, role },
  ref,
) {
  return (
    <div
      ref={ref}
      role={role}
      className={className}
      style={workspaceMenuSurfaceStyle(style)}
      onMouseDown={onMouseDown}
    >
      {children}
    </div>
  );
});
WorkspaceMenuSurface.displayName = "WorkspaceMenuSurface";

const itemBase: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "6px 12px",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  textAlign: "left" as const,
  fontSize: 12,
  fontFamily: '"Inter", sans-serif',
  borderRadius: 6,
  margin: 0,
  boxSizing: "border-box" as const,
  appearance: "none",
  WebkitAppearance: "none",
  outline: "none",
};

export function WorkspaceMenuItem({
  children,
  danger,
  onMouseDown,
  onClick,
  type = "button",
}: {
  children: ReactNode;
  danger?: boolean;
  onMouseDown?: (e: MouseEvent<HTMLButtonElement>) => void;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  type?: "button" | "submit";
}) {
  const color = danger ? "var(--workspace-menu-danger-fg)" : "var(--workspace-text)";
  const hoverBg = danger
    ? "var(--workspace-menu-danger-hover-bg)"
    : "var(--workspace-tree-hover)";
  return (
    <button
      type={type}
      className="workspace-menu-item"
      onMouseDown={onMouseDown}
      onClick={onClick}
      style={{
        ...itemBase,
        color,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = hoverBg;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

export function WorkspaceMenuDivider() {
  return (
    <div
      role="separator"
      style={{
        height: 1,
        background: "var(--workspace-border)",
        margin: "4px 8px",
      }}
    />
  );
}
