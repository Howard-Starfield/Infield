import { useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { X } from "lucide-react"
import {
  normalizeTagsForSave,
  parseTagInput,
} from "@/lib/workspaceDocumentTags"

type WorkspaceDocumentTagsProps = {
  tags: string[]
  disabled?: boolean
  onCommit: (next: string[]) => void | Promise<void>
}

export function WorkspaceDocumentTags({
  tags,
  disabled = false,
  onCommit,
}: WorkspaceDocumentTagsProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)

  const commit = useCallback(
    async (next: string[]) => {
      const normalized = normalizeTagsForSave(next)
      setBusy(true)
      try {
        await onCommit(normalized)
      } finally {
        setBusy(false)
      }
    },
    [onCommit],
  )

  const remove = useCallback(
    (tag: string) => {
      void commit(tags.filter((x) => x !== tag))
    },
    [commit, tags],
  )

  const addDraft = useCallback(() => {
    const parsed = parseTagInput(draft)
    if (!parsed) return
    const lower = parsed.toLowerCase()
    if (tags.some((x) => x.toLowerCase() === lower)) {
      setDraft("")
      return
    }
    void commit([...tags, parsed])
    setDraft("")
  }, [commit, draft, tags])

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        marginTop: 4,
        marginBottom: 10,
        minHeight: 28,
      }}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className="workspace-pill"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            paddingRight: 6,
            maxWidth: "100%",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {tag}
          </span>
          <button
            type="button"
            disabled={disabled || busy}
            aria-label={t("workspace.tagsRemoveAria", { tag })}
            title={t("workspace.tagsRemoveAria", { tag })}
            onClick={() => remove(tag)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              margin: 0,
              border: "none",
              background: "transparent",
              cursor: disabled || busy ? "default" : "pointer",
              color: "var(--workspace-text-soft)",
              borderRadius: 4,
            }}
          >
            <X size={12} strokeWidth={2} aria-hidden />
          </button>
        </span>
      ))}
      <input
        type="text"
        disabled={disabled || busy}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            addDraft()
          }
        }}
        placeholder={t("workspace.tagsPlaceholder")}
        style={{
          flex: "1 1 120px",
          minWidth: 100,
          maxWidth: 220,
          height: 28,
          padding: "0 10px",
          fontSize: 12,
          fontFamily: "inherit",
          color: "var(--workspace-text)",
          background: "color-mix(in srgb, var(--workspace-panel) 65%, transparent)",
          border: "1px solid var(--workspace-border)",
          borderRadius: 999,
          outline: "none",
        }}
      />
    </div>
  )
}
