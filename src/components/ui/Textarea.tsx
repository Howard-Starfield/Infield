import React from "react";

interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: "default" | "compact";
}

export const Textarea: React.FC<TextareaProps> = ({
  className = "",
  variant = "default",
  ...props
}) => {
  const baseClasses =
    "w-full text-sm font-semibold text-[var(--workspace-text)] bg-[var(--workspace-pane)] border border-[var(--workspace-border-strong)] rounded-md text-start transition-[background-color,border-color] duration-150 hover:bg-[var(--workspace-accent-soft)] hover:border-[var(--workspace-accent)] focus:outline-none focus:bg-[var(--workspace-accent-soft)] focus:border-[var(--workspace-accent)] focus:ring-1 focus:ring-[var(--workspace-accent)] resize-y";

  const variantClasses = {
    default: "px-3 py-2 min-h-[100px]",
    compact: "px-2 py-1 min-h-[80px]",
  };

  return (
    <textarea
      className={`${baseClasses} ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
};
