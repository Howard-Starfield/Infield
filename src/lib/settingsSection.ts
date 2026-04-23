/** Section ids rendered by `UnifiedSettingsPage` (nav + scroll targets). */
export const UNIFIED_SETTINGS_SECTION_IDS = [
  "general",
  "models",
  "llmProviders",
  "aiPrompts",
  "postprocessing",
  "appearance",
  "notes",
  "advanced",
  "debug",
  "about",
] as const;

export type SettingsSectionId = (typeof UNIFIED_SETTINGS_SECTION_IDS)[number];

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "general";

const LABEL_KEY_BY_ID: Record<SettingsSectionId, string> = {
  general: "sidebar.general",
  models: "sidebar.models",
  llmProviders: "sidebar.llmProviders",
  aiPrompts: "sidebar.aiPrompts",
  postprocessing: "sidebar.postProcessing",
  appearance: "settings.section.appearance",
  notes: "sidebar.notes",
  advanced: "sidebar.advanced",
  debug: "sidebar.debug",
  about: "sidebar.about",
};

/** i18n key for TopBar title when Settings tab is active. */
export function settingsSectionLabelKey(section: string): string {
  if (
    (UNIFIED_SETTINGS_SECTION_IDS as readonly string[]).includes(section)
  ) {
    return LABEL_KEY_BY_ID[section as SettingsSectionId];
  }
  return "sidebar.general";
}

export function isSettingsSectionId(id: string): id is SettingsSectionId {
  return (UNIFIED_SETTINGS_SECTION_IDS as readonly string[]).includes(id);
}
