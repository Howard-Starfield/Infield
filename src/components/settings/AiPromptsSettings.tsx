import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Circle, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { commands, type LLMPrompt } from "@/bindings";
import { Button, Input, SettingsGroup, Textarea } from "@/components/ui";

type PromptRow = {
  id: string;
  savedId: string | null;
  savedName: string;
  savedPrompt: string;
  name: string;
  prompt: string;
  isBuiltIn: boolean;
  isNew: boolean;
};

const BUILTIN_PROMPT_IDS = new Set(["summarize", "action_items"]);

const toPromptRows = (prompts: LLMPrompt[]): PromptRow[] =>
  prompts.map((prompt) => ({
    id: prompt.id,
    savedId: prompt.id,
    savedName: prompt.name,
    savedPrompt: prompt.prompt,
    name: prompt.name,
    prompt: prompt.prompt,
    isBuiltIn: BUILTIN_PROMPT_IDS.has(prompt.id),
    isNew: false,
  }));

const createDraftPromptRow = (): PromptRow => {
  const tempId = `draft-${crypto.randomUUID()}`;
  return {
    id: tempId,
    savedId: null,
    savedName: "",
    savedPrompt: "",
    name: "",
    prompt: "",
    isBuiltIn: false,
    isNew: true,
  };
};

interface PromptEditorRowProps {
  row: PromptRow;
  defaultPrompt?: LLMPrompt;
  onChange: (rowId: string, updates: Partial<PromptRow>) => void;
  onSave: (row: PromptRow) => Promise<void>;
  onDelete: (row: PromptRow) => Promise<void>;
  onReset: (row: PromptRow, defaultPrompt: LLMPrompt) => Promise<void>;
  onDiscard: (row: PromptRow) => void;
  isBusy: boolean;
}

const PromptEditorRow: React.FC<PromptEditorRowProps> = ({
  row,
  defaultPrompt,
  onChange,
  onSave,
  onDelete,
  onReset,
  onDiscard,
  isBusy,
}) => {
  const { t } = useTranslation();
  const isDirty = row.name !== row.savedName || row.prompt !== row.savedPrompt;

  return (
    <div
      className="rounded-xl border border-[var(--workspace-border)] bg-[var(--workspace-panel)] px-4 py-4 space-y-4"
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (nextTarget && event.currentTarget.contains(nextTarget)) {
          return;
        }

        if (isDirty) {
          onDiscard(row);
        }
      }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-[var(--workspace-text)]">
            {row.isBuiltIn
              ? t("settings.aiPrompts.builtInLabel")
              : t("settings.aiPrompts.customLabel")}
          </div>
          {isDirty && (
            <div className="flex items-center gap-1 text-xs text-[var(--workspace-accent)]">
              <Circle className="w-2.5 h-2.5 fill-current" />
              {t("settings.aiPrompts.unsaved")}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {row.isBuiltIn && defaultPrompt ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isBusy}
              onClick={() => void onReset(row, defaultPrompt)}
              className="inline-flex items-center gap-2"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t("settings.aiPrompts.resetDefault")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="danger-ghost"
              size="sm"
              disabled={isBusy}
              onClick={() => void onDelete(row)}
              className="inline-flex items-center gap-2"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t("common.delete")}
            </Button>
          )}
          <Button
            type="button"
            variant="primary-soft"
            size="sm"
            disabled={isBusy || !isDirty}
            onClick={() => void onSave(row)}
          >
            {t("common.save")}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--workspace-text)]">
          {t("settings.aiPrompts.nameLabel")}
        </label>
        <Input
          value={row.name}
          onChange={(event) =>
            onChange(row.id, {
              name: event.target.value,
            })
          }
          placeholder={t("settings.aiPrompts.namePlaceholder")}
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--workspace-text)]">
          {t("settings.aiPrompts.promptLabel")}
        </label>
        <Textarea
          value={row.prompt}
          onChange={(event) =>
            onChange(row.id, {
              prompt: event.target.value,
            })
          }
          placeholder={t("settings.aiPrompts.promptPlaceholder")}
          className="min-h-[140px] font-medium"
        />
        <p className="text-xs text-[var(--workspace-text-soft)]">{t("settings.aiPrompts.contentHint")}</p>
      </div>
    </div>
  );
};

export const AiPromptsSettings: React.FC = () => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PromptRow[]>([]);
  const [defaultPrompts, setDefaultPrompts] = useState<LLMPrompt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

  const defaultPromptMap = useMemo(
    () => new Map(defaultPrompts.map((prompt) => [prompt.id, prompt])),
    [defaultPrompts],
  );

  const loadPrompts = useCallback(async () => {
    setIsLoading(true);
    try {
      const [settingsResult, defaultsResult] = await Promise.all([
        commands.getAppSettings(),
        commands.getDefaultNotePrompts(),
      ]);

      if (settingsResult.status === "ok") {
        const notePrompts = settingsResult.data.note_prompts ?? [];
        setRows(
          toPromptRows(
            notePrompts.filter((prompt) => prompt.id !== "auto_tag"),
          ),
        );
      }

      if (defaultsResult.status === "ok") {
        setDefaultPrompts(defaultsResult.data);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPrompts();
  }, [loadPrompts]);

  const updateRow = (rowId: string, updates: Partial<PromptRow>) => {
    setRows((currentRows) =>
      currentRows.map((row) => (row.id === rowId ? { ...row, ...updates } : row)),
    );
  };

  const discardRowChanges = (row: PromptRow) => {
    setRows((currentRows) => {
      if (row.isNew) {
        return currentRows.filter((candidate) => candidate.id !== row.id);
      }

      return currentRows.map((candidate) =>
        candidate.id === row.id
          ? {
              ...candidate,
              name: candidate.savedName,
              prompt: candidate.savedPrompt,
            }
          : candidate,
      );
    });
  };

  const handleSave = async (row: PromptRow) => {
    const trimmedName = row.name.trim();
    const trimmedPrompt = row.prompt.trim();
    if (!trimmedName || !trimmedPrompt) {
      toast.error(t("settings.aiPrompts.validationError"));
      return;
    }

    setBusyRowId(row.id);
    try {
      if (row.isNew || !row.savedId) {
        const addResult = await commands.addNotePrompt(trimmedName, trimmedPrompt);
        if (addResult.status !== "ok") {
          toast.error(addResult.error);
          return;
        }
      } else {
        const updateResult = await commands.updateNotePrompt(
          row.savedId,
          trimmedName,
          trimmedPrompt,
        );
        if (updateResult.status !== "ok") {
          toast.error(updateResult.error);
          return;
        }
      }

      await loadPrompts();
    } finally {
      setBusyRowId(null);
    }
  };

  const handleDelete = async (row: PromptRow) => {
    if (row.isNew || !row.savedId) {
      discardRowChanges(row);
      return;
    }

    setBusyRowId(row.id);
    try {
      const deleteResult = await commands.deleteNotePrompt(row.savedId);
      if (deleteResult.status !== "ok") {
        toast.error(deleteResult.error);
        return;
      }

      await loadPrompts();
    } finally {
      setBusyRowId(null);
    }
  };

  const handleReset = async (row: PromptRow, defaultPrompt: LLMPrompt) => {
    if (!row.savedId) {
      return;
    }

    setBusyRowId(row.id);
    try {
      const updateResult = await commands.updateNotePrompt(
        row.savedId,
        defaultPrompt.name,
        defaultPrompt.prompt,
      );
      if (updateResult.status !== "ok") {
        toast.error(updateResult.error);
        return;
      }

      await loadPrompts();
    } finally {
      setBusyRowId(null);
    }
  };

  const addCustomPrompt = () => {
    setRows((currentRows) => [...currentRows, createDraftPromptRow()]);
  };

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">{t("settings.aiPrompts.title")}</h1>
        <p className="text-sm text-[var(--workspace-text-muted)]">{t("settings.aiPrompts.description")}</p>
      </div>

      <SettingsGroup>
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <div className="text-sm text-[var(--workspace-text-muted)]">{t("settings.aiPrompts.header")}</div>
          <Button
            type="button"
            variant="primary-soft"
            size="sm"
            onClick={addCustomPrompt}
            className="inline-flex items-center gap-2"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {t("settings.aiPrompts.addCustomPrompt")}
          </Button>
        </div>
      </SettingsGroup>

      {isLoading ? (
        <div className="text-sm text-[var(--workspace-text-muted)]">{t("common.loading")}</div>
      ) : rows.length > 0 ? (
        <div className="space-y-4">
          {rows.map((row) => (
            <PromptEditorRow
              key={row.id}
              row={row}
              defaultPrompt={
                row.savedId ? defaultPromptMap.get(row.savedId) : undefined
              }
              onChange={updateRow}
              onSave={handleSave}
              onDelete={handleDelete}
              onReset={handleReset}
              onDiscard={discardRowChanges}
              isBusy={busyRowId === row.id}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--workspace-border)] bg-[var(--workspace-bg-soft)] px-4 py-8 text-sm text-[var(--workspace-text-muted)]">
          {t("settings.aiPrompts.empty")}
        </div>
      )}
    </div>
  );
};
