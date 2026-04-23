import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: "default" | "compact";
}

export const Input: React.FC<InputProps> = ({
  className = "",
  variant = "default",
  disabled,
  style,
  ...props
}) => {
  const padding = variant === "compact" ? "4px 8px" : "7px 10px";

  return (
    <input
      className={className}
      disabled={disabled}
      style={{
        padding,
        fontSize: 13,
        fontFamily: "Inter, sans-serif",
        color: "var(--workspace-text)",
        background: "var(--workspace-panel)",
        border: "1px solid var(--workspace-border-strong)",
        outline: "none",
        width: "100%",
        transition: "border-color 150ms, box-shadow 150ms",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "text",
        ...style,
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = "var(--workspace-accent)";
        e.currentTarget.style.boxShadow = "0 0 0 2px var(--workspace-accent-soft)";
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = "var(--workspace-border-strong)";
        e.currentTarget.style.boxShadow = "none";
        props.onBlur?.(e);
      }}
      {...props}
    />
  );
};
