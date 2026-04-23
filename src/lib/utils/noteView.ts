export type NotesListMode = "all" | "recent" | "board" | "calendar";

export function matchesNotesMode(
  note: { note_type?: string },
  mode: NotesListMode,
) {
  switch (mode) {
    case "board":
      return note.note_type === "board";
    case "calendar":
      return note.note_type === "calendar";
    case "recent":
    case "all":
    default:
      return true;
  }
}
