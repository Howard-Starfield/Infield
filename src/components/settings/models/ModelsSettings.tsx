import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ask } from "@tauri-apps/plugin-dialog";
import { ChevronDown, Globe } from "lucide-react";
import type { ModelCardStatus } from "@/components/ModelCard";
import ModelCard from "@/components/ModelCard";
import { useModelStore } from "@/stores/modelStore";
import { LANGUAGES } from "@/lib/constants/languages.ts";
import { getModelCategory } from "@/lib/utils/modelTranslation";
import { commands, type ModelInfo } from "@/bindings";

// check if model supports a language based on its supported_languages list
const modelSupportsLanguage = (model: ModelInfo, langCode: string): boolean => {
  return model.supported_languages.includes(langCode);
};

export const ModelsSettings: React.FC = () => {
  const { t } = useTranslation();
  const [switchingModelId, setSwitchingModelId] = useState<string | null>(null);
  const [languageFilter, setLanguageFilter] = useState("all");
  const [languageDropdownOpen, setLanguageDropdownOpen] = useState(false);
  const [languageSearch, setLanguageSearch] = useState("");
  const languageDropdownRef = useRef<HTMLDivElement>(null);
  const languageSearchInputRef = useRef<HTMLInputElement>(null);
  const {
    models,
    currentModel,
    currentEmbeddingModel,
    currentLlmModel,
    downloadingModels,
    downloadProgress,
    downloadStats,
    verifyingModels,
    extractingModels,
    loading,
    downloadModel,
    cancelDownload,
    selectModel,
    selectEmbeddingModel,
    selectLlmModel,
    deleteModel,
  } = useModelStore();

  // click outside handler for language dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        languageDropdownRef.current &&
        !languageDropdownRef.current.contains(event.target as Node)
      ) {
        setLanguageDropdownOpen(false);
        setLanguageSearch("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // focus search input when dropdown opens
  useEffect(() => {
    if (languageDropdownOpen && languageSearchInputRef.current) {
      languageSearchInputRef.current.focus();
    }
  }, [languageDropdownOpen]);

  // filtered languages for dropdown (exclude "auto")
  const filteredLanguages = useMemo(() => {
    return LANGUAGES.filter(
      (lang) =>
        lang.value !== "auto" &&
        lang.label.toLowerCase().includes(languageSearch.toLowerCase()),
    );
  }, [languageSearch]);

  // Get selected language label
  const selectedLanguageLabel = useMemo(() => {
    if (languageFilter === "all") {
      return t("settings.models.filters.allLanguages");
    }
    return LANGUAGES.find((lang) => lang.value === languageFilter)?.label || "";
  }, [languageFilter, t]);

  const getModelStatus = (modelId: string): ModelCardStatus => {
    const model = models.find((m: ModelInfo) => m.id === modelId);

    if (modelId in extractingModels) {
      return "extracting";
    }
    if (modelId in verifyingModels) {
      return "verifying";
    }
    if (modelId in downloadingModels) {
      return "downloading";
    }
    if (switchingModelId === modelId) {
      return "switching";
    }
    if (model && getModelCategory(model) === "Transcription" && modelId === currentModel) {
      return "active";
    }
    if (model && getModelCategory(model) === "Embedding" && modelId === currentEmbeddingModel) {
      return "active";
    }
    if (model && getModelCategory(model) === "Llm" && modelId === currentLlmModel) {
      return "active";
    }
    if (model?.is_downloaded) {
      return "available";
    }
    return "downloadable";
  };

  const getDownloadProgress = (modelId: string): number | undefined => {
    const progress = downloadProgress[modelId];
    return progress?.percentage;
  };

  const getDownloadSpeed = (modelId: string): number | undefined => {
    const stats = downloadStats[modelId];
    return stats?.speed;
  };

  const handleModelSelect = async (modelId: string) => {
    setSwitchingModelId(modelId);
    try {
      const model = models.find((m: ModelInfo) => m.id === modelId);
      if (model && getModelCategory(model) === "Llm") {
        await selectLlmModel(modelId);
      } else if (model && getModelCategory(model) === "Embedding") {
        // D1b locked: bge-small-en-v1.5 is the only embedding model in v1.
        // selectEmbeddingModel is a no-op (runtime swap removed); clicking
        // the card does nothing for "select" — download/delete still work.
      } else {
        await selectModel(modelId);
      }
    } finally {
      setSwitchingModelId(null);
    }
  };

  const handleModelDownload = async (modelId: string) => {
    await downloadModel(modelId);
  };

  const handleModelDelete = async (modelId: string) => {
    const model = models.find((m: ModelInfo) => m.id === modelId);
    const modelName = model?.name || modelId;
    const category = model ? getModelCategory(model) : "Transcription";
    const isActive =
      (category === "Transcription" && modelId === currentModel) ||
      (category === "Embedding" && modelId === currentEmbeddingModel) ||
      (category === "Llm" && modelId === currentLlmModel);

    const confirmed = await ask(
      isActive
        ? category === "Llm"
          ? t("settings.models.deleteActiveLlmConfirm", { modelName })
          : t("settings.models.deleteActiveConfirm", { modelName })
        : t("settings.models.deleteConfirm", { modelName }),
      {
        title: t("settings.models.deleteTitle"),
        kind: "warning",
      },
    );

    if (confirmed) {
      try {
        await deleteModel(modelId);
      } catch (err) {
        console.error(`Failed to delete model ${modelId}:`, err);
      }
    }
  };

  const handleModelCancel = async (modelId: string) => {
    try {
      await cancelDownload(modelId);
    } catch (err) {
      console.error(`Failed to cancel download for ${modelId}:`, err);
    }
  };

  const transcriptionModels = useMemo(() => {
    return models.filter(
      (model: ModelInfo) => getModelCategory(model) === "Transcription",
    );
  }, [models]);

  const embeddingModels = useMemo(() => {
    return models.filter(
      (model: ModelInfo) => getModelCategory(model) === "Embedding",
    );
  }, [models]);

  const llmModels = useMemo(() => {
    return models.filter((model: ModelInfo) => getModelCategory(model) === "Llm");
  }, [models]);

  // Filter transcription models based on language filter
  const filteredTranscriptionModels = useMemo(() => {
    return transcriptionModels.filter((model: ModelInfo) => {
      if (languageFilter !== "all") {
        if (!modelSupportsLanguage(model, languageFilter)) return false;
      }
      return true;
    });
  }, [transcriptionModels, languageFilter]);

  const splitModelsByAvailability = (
    sourceModels: ModelInfo[],
    activeModelId: string | null,
  ) => {
    const downloaded: ModelInfo[] = [];
    const available: ModelInfo[] = [];

    for (const model of sourceModels) {
      if (
        model.is_custom ||
        model.is_downloaded ||
        model.id in downloadingModels ||
        model.id in extractingModels
      ) {
        downloaded.push(model);
      } else {
        available.push(model);
      }
    }

    downloaded.sort((a, b) => {
      if (activeModelId && a.id === activeModelId) return -1;
      if (activeModelId && b.id === activeModelId) return 1;
      if (a.is_custom !== b.is_custom) return a.is_custom ? 1 : -1;
      return 0;
    });

    return {
      downloadedModels: downloaded,
      availableModels: available,
    };
  };

  const {
    downloadedModels: downloadedTranscriptionModels,
    availableModels: availableTranscriptionModels,
  } = useMemo(
    () => splitModelsByAvailability(filteredTranscriptionModels, currentModel),
    [filteredTranscriptionModels, downloadingModels, extractingModels, currentModel],
  );

  const {
    downloadedModels: downloadedEmbeddingModels,
    availableModels: availableEmbeddingModels,
  } = useMemo(
    () => splitModelsByAvailability(embeddingModels, currentEmbeddingModel),
    [embeddingModels, downloadingModels, extractingModels, currentEmbeddingModel],
  );

  // Manual re-index trigger removed — Rule 19's automatic reindex on model
  // swap covers v1. A user-facing "Rebuild embeddings" button can land later
  // if the UX case emerges. `commands.reindexAllEmbeddings` still exists
  // Rust-side and can be wired back when needed.

  const {
    downloadedModels: downloadedLlmModels,
    availableModels: availableLlmModels,
  } = useMemo(
    () => splitModelsByAvailability(llmModels, currentLlmModel),
    [llmModels, downloadingModels, extractingModels, currentLlmModel],
  );

  if (loading) {
    return (
      <div className="max-w-3xl w-full mx-auto">
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-logo-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl w-full mx-auto space-y-4">
      <div className="mb-4">
        <h1 className="text-xl font-semibold mb-2">
          {t("settings.models.title")}
        </h1>
        <p className="text-sm text-[var(--workspace-text-muted)]">
          {t("settings.models.description")}
        </p>
      </div>
      {filteredTranscriptionModels.length > 0 ||
      embeddingModels.length > 0 ||
      llmModels.length > 0 ? (
        <div className="space-y-6">
          {/* Downloaded Transcription Models Section — header always visible so filter stays accessible */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-[var(--workspace-text-muted)]">
                {t("settings.models.transcriptionYourModels")}
              </h2>
              {/* Language filter dropdown */}
              <div className="relative" ref={languageDropdownRef}>
                <button
                  type="button"
                  onClick={() => setLanguageDropdownOpen(!languageDropdownOpen)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    languageFilter !== "all"
                      ? "bg-[var(--workspace-accent-soft)] text-[var(--workspace-accent)]"
                      : "bg-[var(--workspace-bg-soft)] text-[var(--workspace-text-muted)] hover:bg-[var(--workspace-accent-soft)]"
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span className="max-w-[120px] truncate">
                    {selectedLanguageLabel}
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${
                      languageDropdownOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {languageDropdownOpen && (
                  <div className="absolute top-full right-0 mt-1 w-56 bg-[var(--workspace-panel)] border border-[var(--workspace-border-strong)] rounded-lg shadow-lg z-50 overflow-hidden">
                    <div className="p-2 border-b border-[var(--workspace-border)]">
                      <input
                        ref={languageSearchInputRef}
                        type="text"
                        value={languageSearch}
                        onChange={(e) => setLanguageSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            filteredLanguages.length > 0
                          ) {
                            setLanguageFilter(filteredLanguages[0].value);
                            setLanguageDropdownOpen(false);
                            setLanguageSearch("");
                          } else if (e.key === "Escape") {
                            setLanguageDropdownOpen(false);
                            setLanguageSearch("");
                          }
                        }}
                        placeholder={t(
                          "settings.general.language.searchPlaceholder",
                        )}
                        className="w-full px-2 py-1 text-sm text-[var(--workspace-text)] bg-[var(--workspace-bg-soft)] border border-[var(--workspace-border)] rounded-md focus:outline-none focus:ring-1 focus:ring-[var(--workspace-accent)]"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => {
                          setLanguageFilter("all");
                          setLanguageDropdownOpen(false);
                          setLanguageSearch("");
                        }}
                        className={`w-full px-3 py-1.5 text-sm text-left transition-colors ${
                          languageFilter === "all"
                            ? "bg-[var(--workspace-accent-soft)] text-[var(--workspace-accent)] font-semibold"
                            : "hover:bg-[var(--workspace-accent-soft)]"
                        }`}
                      >
                        {t("settings.models.filters.allLanguages")}
                      </button>
                      {filteredLanguages.map((lang) => (
                        <button
                          key={lang.value}
                          type="button"
                          onClick={() => {
                            setLanguageFilter(lang.value);
                            setLanguageDropdownOpen(false);
                            setLanguageSearch("");
                          }}
                          className={`w-full px-3 py-1.5 text-sm text-left transition-colors ${
                            languageFilter === lang.value
                              ? "bg-[var(--workspace-accent-soft)] text-[var(--workspace-accent)] font-semibold"
                              : "hover:bg-[var(--workspace-accent-soft)]"
                          }`}
                        >
                          {lang.label}
                        </button>
                      ))}
                      {filteredLanguages.length === 0 && (
                        <div className="px-3 py-2 text-sm text-[var(--workspace-text-soft)] text-center">
                          {t("settings.general.language.noResults")}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
            {downloadedTranscriptionModels.map((model: ModelInfo) => (
              <ModelCard
                key={model.id}
                model={model}
                status={getModelStatus(model.id)}
                onSelect={handleModelSelect}
                onDownload={handleModelDownload}
                onDelete={handleModelDelete}
                onCancel={handleModelCancel}
                downloadProgress={getDownloadProgress(model.id)}
                downloadSpeed={getDownloadSpeed(model.id)}
                showRecommended={false}
              />
            ))}
          </div>

          {/* Available Transcription Models Section */}
          {availableTranscriptionModels.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-[var(--workspace-text-muted)]">
                {t("settings.models.transcriptionAvailableModels")}
              </h2>
              {availableTranscriptionModels.map((model: ModelInfo) => (
                <ModelCard
                  key={model.id}
                  model={model}
                  status={getModelStatus(model.id)}
                  onSelect={handleModelSelect}
                  onDownload={handleModelDownload}
                  onDelete={handleModelDelete}
                  onCancel={handleModelCancel}
                  downloadProgress={getDownloadProgress(model.id)}
                  downloadSpeed={getDownloadSpeed(model.id)}
                  showRecommended={false}
                />
              ))}
            </div>
          )}

          <div className="space-y-3">
            <div>
              <h2 className="text-sm font-medium text-[var(--workspace-text-muted)]">
                {t("settings.models.embeddingTitle")}
              </h2>
              <p className="text-sm text-[var(--workspace-text-soft)] mt-1">
                {t("settings.models.embeddingDescription")}
              </p>
            </div>

            {downloadedEmbeddingModels.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-[var(--workspace-text-muted)]">
                  {t("settings.models.embeddingYourModels")}
                </h3>
                {downloadedEmbeddingModels.map((model: ModelInfo) => (
                  <ModelCard
                    key={model.id}
                    model={model}
                    status={getModelStatus(model.id)}
                    onSelect={handleModelSelect}
                    onDownload={handleModelDownload}
                    onDelete={handleModelDelete}
                    onCancel={handleModelCancel}
                    downloadProgress={getDownloadProgress(model.id)}
                    downloadSpeed={getDownloadSpeed(model.id)}
                    showRecommended={false}
                  />
                ))}
              </div>
            )}

            {availableEmbeddingModels.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-[var(--workspace-text-muted)]">
                  {t("settings.models.embeddingAvailableModels")}
                </h3>
                {availableEmbeddingModels.map((model: ModelInfo) => (
                  <ModelCard
                    key={model.id}
                    model={model}
                    status={getModelStatus(model.id)}
                    onSelect={handleModelSelect}
                    onDownload={handleModelDownload}
                    onDelete={handleModelDelete}
                    onCancel={handleModelCancel}
                    downloadProgress={getDownloadProgress(model.id)}
                    downloadSpeed={getDownloadSpeed(model.id)}
                    showRecommended={false}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <h2 className="text-sm font-medium text-[var(--workspace-text-muted)]">
                {t("settings.models.llmTitle")}
              </h2>
              <p className="text-sm text-[var(--workspace-text-soft)] mt-1">
                {t("settings.models.llmDescription")}
              </p>
            </div>

            {downloadedLlmModels.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-[var(--workspace-text-muted)]">
                  {t("settings.models.llmYourModels")}
                </h3>
                {downloadedLlmModels.map((model: ModelInfo) => (
                  <ModelCard
                    key={model.id}
                    model={model}
                    status={getModelStatus(model.id)}
                    onSelect={handleModelSelect}
                    onDownload={handleModelDownload}
                    onDelete={handleModelDelete}
                    onCancel={handleModelCancel}
                    downloadProgress={getDownloadProgress(model.id)}
                    downloadSpeed={getDownloadSpeed(model.id)}
                    showRecommended={false}
                  />
                ))}
              </div>
            )}

            {availableLlmModels.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-[var(--workspace-text-muted)]">
                  {t("settings.models.llmAvailableModels")}
                </h3>
                {availableLlmModels.map((model: ModelInfo) => (
                  <ModelCard
                    key={model.id}
                    model={model}
                    status={getModelStatus(model.id)}
                    onSelect={handleModelSelect}
                    onDownload={handleModelDownload}
                    onDelete={handleModelDelete}
                    onCancel={handleModelCancel}
                    downloadProgress={getDownloadProgress(model.id)}
                    downloadSpeed={getDownloadSpeed(model.id)}
                    showRecommended={false}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center py-8 text-[var(--workspace-text-soft)]">
          {t("settings.models.noModelsMatch")}
        </div>
      )}
    </div>
  );
};
