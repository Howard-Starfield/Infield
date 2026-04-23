import { type FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingContainer } from "../ui/SettingContainer";
import { Dropdown, type DropdownOption } from "../ui/Dropdown";
import { useSettings } from "../../hooks/useSettings";
import { RefreshCw } from "lucide-react";
import { commands, type EmbeddingModel } from "@/bindings";

const MODEL_OPTIONS: DropdownOption[] = [
  {
    value: "nomic_embed_text",
    label: "Nomic Embed Text v1.5 (768-dim)",
  },
  {
    value: "bge_m3",
    label: "BGE-M3 (1024-dim)",
  },
];

interface EmbeddingModelSelectorProps {
  descriptionMode?: "tooltip" | "inline";
  grouped?: boolean;
}

export const EmbeddingModelSelector: FC<EmbeddingModelSelectorProps> = ({
  descriptionMode = "tooltip",
  grouped = false,
}) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const [isReindexing, setIsReindexing] = useState(false);
  const [showReindexHint, setShowReindexHint] = useState(false);

  const currentModel = (getSetting("embedding_model") as string) ?? "nomic_embed_text";

  const handleModelChange = async (value: string) => {
    const previous = currentModel;
    await updateSetting("embedding_model", value as EmbeddingModel);
    if (value !== previous) {
      setShowReindexHint(true);
    }
  };

  const handleReindex = async () => {
    setIsReindexing(true);
    try {
      await commands.reindexAllEmbeddings();
      setShowReindexHint(false);
    } finally {
      setIsReindexing(false);
    }
  };

  return (
    <div>
      <SettingContainer
        title={t("settings.advanced.embeddingModel.title", "Embedding Model")}
        description={t(
          "settings.advanced.embeddingModel.description",
          "Model used for semantic search. Changing requires re-indexing all notes."
        )}
        descriptionMode={descriptionMode}
        grouped={grouped}
        layout="horizontal"
      >
        <div className="flex items-center gap-2">
          <Dropdown
            options={MODEL_OPTIONS}
            selectedValue={currentModel}
            onSelect={handleModelChange}
            disabled={isUpdating("embedding_model") || isReindexing}
          />
          <button
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors
              ${isReindexing
                ? "bg-neutral-200 dark:bg-neutral-700 text-neutral-400 cursor-not-allowed"
                : "bg-blue-500 text-white hover:bg-blue-600"
              }`}
            onClick={handleReindex}
            disabled={isReindexing}
            title={t("settings.advanced.embeddingModel.reindex", "Re-index")}
          >
            <RefreshCw size={12} className={isReindexing ? "animate-spin" : ""} />
            {t("settings.advanced.embeddingModel.reindex", "Re-index")}
          </button>
        </div>
      </SettingContainer>
      {showReindexHint && (
        <div className="mx-4 mb-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-300">
          {t(
            "settings.advanced.embeddingModel.reindexHint",
            "You changed the embedding model. Click Re-index to rebuild the search index with the new model. Search may return incomplete results until re-indexing completes."
          )}
        </div>
      )}
      <div className="mx-4 mb-2 text-xs text-neutral-400">
        {currentModel === "nomic_embed_text"
          ? t("settings.advanced.embeddingModel.nomicDescription", "Fast, lightweight (768-dim). Great for English content and lower resource usage.")
          : t("settings.advanced.embeddingModel.bgeDescription", "Multilingual (1024-dim). Best retrieval quality for 100+ languages. Larger model.")}
      </div>
    </div>
  );
};
