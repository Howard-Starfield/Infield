export interface NotesDeleteConfirmationPreferences {
  note: boolean;
  space: boolean;
}

export const NOTES_DELETE_CONFIRMATION_PREFS_KEY =
  "handy-notes-delete-confirm-v1";

export const getDefaultNotesDeleteConfirmationPreferences =
  (): NotesDeleteConfirmationPreferences => ({
    note: false,
    space: false,
  });

export const loadNotesDeleteConfirmationPreferences =
  (): NotesDeleteConfirmationPreferences => {
    if (typeof window === "undefined") {
      return getDefaultNotesDeleteConfirmationPreferences();
    }

    try {
      const parsed = JSON.parse(
        window.localStorage.getItem(NOTES_DELETE_CONFIRMATION_PREFS_KEY) ??
          "null",
      ) as Partial<NotesDeleteConfirmationPreferences> | null;

      return {
        note: parsed?.note ?? false,
        space: parsed?.space ?? false,
      };
    } catch {
      return getDefaultNotesDeleteConfirmationPreferences();
    }
  };

export const persistNotesDeleteConfirmationPreferences = (
  preferences: NotesDeleteConfirmationPreferences,
) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    NOTES_DELETE_CONFIRMATION_PREFS_KEY,
    JSON.stringify(preferences),
  );
};

export const resetNotesDeleteConfirmationPreferences = () => {
  persistNotesDeleteConfirmationPreferences(
    getDefaultNotesDeleteConfirmationPreferences(),
  );
};
