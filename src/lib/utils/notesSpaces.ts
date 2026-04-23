import type { Note } from "@/bindings";

export const ALL_NOTES_SPACE_ID = "__all_notes__";
export const DEFAULT_NOTES_SPACE_ID = "workspace";

export interface NotesSpace {
  id: string;
  name: string;
  createdAt: number;
}

export const DEFAULT_NOTES_SPACE: NotesSpace = {
  id: DEFAULT_NOTES_SPACE_ID,
  name: "Workspace",
  createdAt: 0,
};

export const ensureDefaultSpace = (spaces: NotesSpace[]): NotesSpace[] => {
  if (spaces.some((space) => space.id === DEFAULT_NOTES_SPACE_ID)) {
    return spaces;
  }

  return [DEFAULT_NOTES_SPACE, ...spaces];
};

export const getAssignedSpaceId = (
  noteId: string,
  assignments: Record<string, string>,
) => assignments[noteId] ?? DEFAULT_NOTES_SPACE_ID;

export const filterNotesBySpace = (
  notes: Note[],
  activeSpaceId: string,
  assignments: Record<string, string>,
) => {
  if (activeSpaceId === ALL_NOTES_SPACE_ID) {
    return notes;
  }

  return notes.filter(
    (note) => getAssignedSpaceId(note.id, assignments) === activeSpaceId,
  );
};
