import React, { useEffect, useRef, useState } from "react";

interface PromptDialogProps {
  open: boolean;
  title: string;
  description?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  initialValue?: string;
  onConfirm: (value: string) => void | Promise<void>;
  onClose: () => void;
}

export function PromptDialog({
  open,
  title,
  description,
  placeholder,
  confirmLabel = "Save",
  cancelLabel = "Cancel",
  initialValue = "",
  onConfirm,
  onClose,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setValue(initialValue);
    setIsSubmitting(false);

    const timeout = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 20);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [initialValue, onClose, open]);

  if (!open) {
    return null;
  }

  const handleSubmit = async () => {
    const trimmed = value.trim();
    if (!trimmed || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm(trimmed);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="workspace-dialog-backdrop" onClick={onClose}>
      <div
        className="workspace-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="workspace-dialog-glow" />
        <div className="workspace-dialog-header">
          <div className="workspace-eyebrow">Infield Prompt</div>
          <h2 className="workspace-dialog-title">{title}</h2>
          {description ? (
            <p className="workspace-dialog-description">{description}</p>
          ) : null}
        </div>

        <div className="workspace-dialog-body">
          <input
            ref={inputRef}
            className="workspace-dialog-input"
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSubmit();
              }
            }}
          />
        </div>

        <div className="workspace-dialog-actions">
          <button
            type="button"
            className="workspace-dialog-button workspace-dialog-button-secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="workspace-dialog-button workspace-dialog-button-primary"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || value.trim().length === 0}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
