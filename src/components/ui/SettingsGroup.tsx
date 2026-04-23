import React from "react";

interface SettingsGroupProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  description,
  children,
}) => {
  return (
    <div style={{ marginBottom: 8 }}>
      {title && (
        <div style={{ padding: "0 4px", marginBottom: 8 }}>
          <h2
            style={{
              fontSize: 10,
              fontFamily: "Space Grotesk, sans-serif",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: ".14em",
              color: "var(--workspace-text-soft)",
              margin: 0,
            }}
          >
            {title}
          </h2>
          {description && (
            <p
              style={{
                fontSize: 11,
                color: "var(--workspace-text-muted)",
                marginTop: 4,
                fontFamily: "Inter, sans-serif",
              }}
            >
              {description}
            </p>
          )}
        </div>
      )}
      <div
        style={{
          background: "var(--workspace-panel)",
          border: "1px solid var(--workspace-border)",
          boxShadow: "var(--workspace-shadow-soft)",
          borderRadius: "var(--workspace-panel-radius)",
          overflow: "visible",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
          }}
        >
          {React.Children.map(children, (child, i) =>
            child ? (
              <div
                key={i}
                style={
                  i > 0
                    ? { borderTop: "1px solid var(--workspace-border)" }
                    : undefined
                }
              >
                {child}
              </div>
            ) : null
          )}
        </div>
      </div>
    </div>
  );
};
