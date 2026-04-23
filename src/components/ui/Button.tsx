import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "primary"
    | "primary-soft"
    | "secondary"
    | "danger"
    | "danger-ghost"
    | "ghost";
  size?: "sm" | "md" | "lg";
}

export const Button: React.FC<ButtonProps> = ({
  children,
  className = "",
  variant = "primary",
  size = "md",
  ...props
}) => {
  const baseClasses =
    "font-medium rounded-lg border appearance-none focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";

  const variantClasses = {
    primary:
      "text-[var(--workspace-ui-button-text)] border border-[var(--workspace-ui-button-border)] focus:ring-1 focus:ring-inset focus:ring-[var(--workspace-accent)] [background:linear-gradient(180deg,var(--workspace-ui-button-from),var(--workspace-ui-button-to))] hover:[background:linear-gradient(180deg,var(--workspace-ui-button-hover-from),var(--workspace-ui-button-hover-to))]",
    "primary-soft":
      "text-[var(--workspace-accent)] bg-[var(--workspace-accent-soft)] border-transparent hover:bg-[var(--workspace-accent-strong)] focus:ring-1 focus:ring-inset focus:ring-[var(--workspace-accent)]",
    secondary:
      "text-[var(--workspace-text-muted)] bg-transparent border-[var(--workspace-border-strong)] hover:bg-[var(--workspace-accent-soft)] hover:border-[var(--workspace-accent)] disabled:hover:bg-transparent disabled:hover:border-[var(--workspace-border-strong)] focus:ring-1 focus:ring-inset focus:ring-[var(--workspace-accent)]",
    danger:
      "text-white bg-red-600 border-transparent hover:bg-red-700 focus:ring-1 focus:ring-inset focus:ring-red-400",
    "danger-ghost":
      "text-red-500 border-transparent hover:text-red-600 hover:bg-red-500/10 focus:bg-red-500/20 focus:ring-1 focus:ring-inset focus:ring-red-400",
    ghost:
      "text-[var(--workspace-text-muted)] border-transparent hover:bg-[var(--workspace-bg-soft)] hover:text-[var(--workspace-text)] focus:bg-[var(--workspace-bg-soft)] focus:ring-1 focus:ring-inset focus:ring-[var(--workspace-border-strong)]",
  };

  const sizeClasses = {
    sm: "px-2 py-1 text-xs",
    md: "px-4 py-[5px] text-sm",
    lg: "px-4 py-2 text-base",
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
