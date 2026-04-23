import React, { useEffect, useState } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  checkboxLabel?: string;
  tone?: "default" | "danger";
  onConfirm: (skipNextTime: boolean) => void | Promise<void>;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  checkboxLabel,
  tone = "default",
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [skipNextTime, setSkipNextTime] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSkipNextTime(false);
    setIsSubmitting(false);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const handleSubmit = async () => {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm(skipNextTime);
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
        <div className={`workspace-dialog-glow workspace-dialog-glow-${tone}`} />
        <div className="workspace-dialog-header">
          <div className="workspace-eyebrow">
            {tone === "danger" ? "Confirm Delete" : "Confirm Action"}
          </div>
          <h2 className="workspace-dialog-title">{title}</h2>
          {description ? (
            <p className="workspace-dialog-description">{description}</p>
          ) : null}
        </div>

        {checkboxLabel ? (
          <label className="workspace-dialog-checkbox">
            <input
              type="checkbox"
              checked={skipNextTime}
              onChange={(event) => setSkipNextTime(event.target.checked)}
            />
            <span>{checkboxLabel}</span>
          </label>
        ) : null}

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
            className={`workspace-dialog-button ${
              tone === "danger"
                ? "workspace-dialog-button-danger"
                : "workspace-dialog-button-primary"
            }`}
            onClick={() => void handleSubmit()}
            disabled={isSubmitting}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
