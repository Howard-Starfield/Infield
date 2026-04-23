import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface Props {
  onCreateCard: () => void | Promise<void>
}

export function BoardColumnFooter({ onCreateCard }: Props) {
  const { t } = useTranslation()

  return (
    <button
      type="button"
      onClick={() => void onCreateCard()}
      className="workspace-board-new-row"
    >
      <Plus size={14} />
      {t('database.newCard')}
    </button>
  )
}
