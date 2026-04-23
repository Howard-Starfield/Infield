import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Download, AlertTriangle } from 'lucide-react'
import { commands, type ModelInfo, type OnboardingStatePatch } from '../bindings'
import { useVault } from '../contexts/VaultContext'
import { OnboardingStepFrame } from './OnboardingStepFrame'
import { HerOSButton } from './HerOS'

const BGE_ID = 'bge-small-en-v1.5'

type DownloadState = 'idle' | 'downloading' | 'done' | 'failed'

interface ModelProgress {
  modelId: string
  state: DownloadState
  pct: number // 0..100
  attempts: number
}

function formatMb(sizeMb: number | null | undefined): string {
  if (!sizeMb) return '—'
  return `${Math.round(sizeMb)} MB`
}

/** Always-defined patch builder so we never violate the OnboardingStatePatch
 *  shape (which has all-explicit-null fields). */
function buildPatch(overrides: Partial<OnboardingStatePatch>): OnboardingStatePatch {
  return {
    current_step: null,
    mic_permission: null,
    accessibility_permission: null,
    models_downloaded: null,
    vault_root: null,
    completed_at: null,
    ...overrides,
  }
}

export function OnboardingStepModels() {
  const { completeStep } = useVault()
  const [models, setModels] = useState<ModelInfo[]>([])
  const [whisperPick, setWhisperPick] = useState<string | null>(null)
  const [progress, setProgress] = useState<Record<string, ModelProgress>>({})
  const [error, setError] = useState<string | null>(null)
  const [showSkip, setShowSkip] = useState(false)
  const pollHandle = useRef<number | null>(null)

  // Load model registry once.
  useEffect(() => {
    const load = async () => {
      const result = await commands.getAvailableModels()
      if (result.status !== 'ok') {
        setError(result.error)
        return
      }
      setModels(result.data)
      const whispers = result.data.filter(
        (m) => m.category === 'Transcription' && m.engine_type === 'Whisper',
      )
      const recommended = whispers.find((m) => m.is_recommended) ?? whispers[0]
      if (recommended) setWhisperPick(recommended.id)
    }
    void load()
  }, [])

  const whisperOptions = useMemo(
    () =>
      models.filter(
        (m) => m.category === 'Transcription' && m.engine_type === 'Whisper',
      ),
    [models],
  )
  const bge = useMemo(() => models.find((m) => m.id === BGE_ID) ?? null, [models])

  const updateProgress = (modelId: string, patch: Partial<ModelProgress>) => {
    setProgress((prev) => ({
      ...prev,
      [modelId]: {
        modelId,
        state: 'idle',
        pct: 0,
        attempts: 0,
        ...prev[modelId],
        ...patch,
      },
    }))
  }

  // Poll the registry while a download is active. Granular per-byte progress
  // events aren't surfaced via specta, so polling is_downloading + partial_size
  // is the safe path. 500ms keeps the UI lively without spamming.
  const startPolling = () => {
    if (pollHandle.current) return
    pollHandle.current = window.setInterval(async () => {
      const result = await commands.getAvailableModels()
      if (result.status === 'ok') {
        setModels(result.data)
        let activeCount = 0
        for (const m of result.data) {
          if (m.is_downloading) {
            activeCount += 1
            // partial_size and size_mb units differ across registry entries;
            // take the ratio when both are positive, fall back to indeterminate.
            const totalBytes = m.size_mb * 1024 * 1024
            const pct =
              totalBytes > 0 && m.partial_size > 0
                ? Math.min(99, (m.partial_size / totalBytes) * 100)
                : 30 // indeterminate-ish
            updateProgress(m.id, { state: 'downloading', pct })
          } else if (m.is_downloaded) {
            updateProgress(m.id, { state: 'done', pct: 100 })
          }
        }
        if (activeCount === 0) {
          if (pollHandle.current) {
            window.clearInterval(pollHandle.current)
            pollHandle.current = null
          }
        }
      }
    }, 500)
  }

  useEffect(() => {
    return () => {
      if (pollHandle.current) window.clearInterval(pollHandle.current)
    }
  }, [])

  const downloadOne = async (modelId: string, attemptsSoFar = 0): Promise<boolean> => {
    updateProgress(modelId, { state: 'downloading', attempts: attemptsSoFar + 1 })
    startPolling()
    const result = await commands.downloadModel(modelId)
    if (result.status === 'ok') {
      updateProgress(modelId, { state: 'done', pct: 100 })
      return true
    }
    // Backoff on failure: 2s → 8s → 32s, max 3 attempts (per D14).
    if (attemptsSoFar < 2) {
      const delayMs = [2000, 8000, 32000][attemptsSoFar]
      updateProgress(modelId, { state: 'failed' })
      await new Promise((r) => setTimeout(r, delayMs))
      return downloadOne(modelId, attemptsSoFar + 1)
    }
    updateProgress(modelId, { state: 'failed' })
    return false
  }

  const beginDownloads = async () => {
    setError(null)
    setShowSkip(false)
    if (!whisperPick) {
      setError('Pick a Whisper model first.')
      return
    }
    // Run both downloads in parallel; they're CPU/network independent.
    const [whisperOk, bgeOk] = await Promise.all([
      downloadOne(whisperPick),
      bge && !bge.is_downloaded ? downloadOne(bge.id) : Promise.resolve(true),
    ])

    if (whisperOk) {
      const setRes = await commands.setActiveModel(whisperPick)
      if (setRes.status !== 'ok') {
        console.warn('[OnboardingStepModels] setActiveModel failed:', setRes.error)
      }
    }

    if (whisperOk && bgeOk) {
      const downloaded: string[] = []
      if (whisperOk) downloaded.push(whisperPick)
      if (bgeOk && bge) downloaded.push(bge.id)
      await completeStep(
        buildPatch({ models_downloaded: downloaded, current_step: 'vault' }),
      )
    } else {
      setError(
        'Downloads failed after retries. Continue without and configure later in Settings → Models.',
      )
      setShowSkip(true)
    }
  }

  const skipDownloads = async () => {
    const downloaded = Object.values(progress)
      .filter((p) => p.state === 'done')
      .map((p) => p.modelId)
    await completeStep(
      buildPatch({ models_downloaded: downloaded, current_step: 'vault' }),
    )
  }

  const allDone =
    whisperPick != null &&
    progress[whisperPick]?.state === 'done' &&
    (bge == null || bge.is_downloaded || progress[bge?.id]?.state === 'done')

  const downloading = Object.values(progress).some((p) => p.state === 'downloading')

  const continueAction = () => {
    if (showSkip) {
      void skipDownloads()
    } else if (allDone) {
      void completeStep(buildPatch({ current_step: 'vault' }))
    }
  }

  return (
    <OnboardingStepFrame
      stepIndex={3}
      icon={<Download size={20} />}
      title="Download models"
      canContinue={allDone || showSkip}
      continueLabel={showSkip ? 'Skip and continue' : 'Continue'}
      onContinue={continueAction}
    >
      <p>
        Infield needs a transcription model (Whisper) and a semantic-search
        model (bge-small) to work end-to-end. Both run locally on your machine.
      </p>

      <div>
        <div className="onboarding-muted" style={{ marginBottom: 8 }}>
          Whisper size — bigger is more accurate but slower
        </div>
        <div className="onboarding-pick-list">
          {whisperOptions.map((m) => {
            const active = whisperPick === m.id
            return (
              <div
                key={m.id}
                className={
                  active ? 'onboarding-pick-row onboarding-pick-row--active' : 'onboarding-pick-row'
                }
                onClick={() => setWhisperPick(m.id)}
                role="radio"
                aria-checked={active}
                tabIndex={0}
              >
                <div className="onboarding-pick-row__main">
                  <span className="onboarding-pick-row__label">
                    {m.name}
                    {m.is_recommended && (
                      <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--heros-brand)' }}>
                        RECOMMENDED
                      </span>
                    )}
                  </span>
                  <span className="onboarding-pick-row__sub">
                    {formatMb(m.size_mb)} ·{' '}
                    {m.is_downloaded ? 'Already downloaded' : 'Not downloaded'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {bge && (
        <div className="onboarding-progress-row">
          <span>Semantic search · {bge.name} (required)</span>
          <span style={{ color: 'rgba(255,255,255,0.5)' }}>
            {bge.is_downloaded ? 'Already downloaded' : formatMb(bge.size_mb)}
          </span>
          <div className="onboarding-progress-row__bar">
            <div
              className="onboarding-progress-row__bar-fill"
              style={{
                width: `${bge.is_downloaded ? 100 : progress[bge.id]?.pct ?? 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {whisperPick && progress[whisperPick] && (
        <div className="onboarding-progress-row">
          <span>{whisperPick}</span>
          <span style={{ color: 'rgba(255,255,255,0.5)' }}>
            {progress[whisperPick].state === 'done'
              ? 'Done'
              : progress[whisperPick].state === 'downloading'
              ? 'Downloading…'
              : progress[whisperPick].state === 'failed'
              ? `Failed (attempt ${progress[whisperPick].attempts}/3)`
              : 'Idle'}
          </span>
          <div className="onboarding-progress-row__bar">
            <div
              className="onboarding-progress-row__bar-fill"
              style={{ width: `${progress[whisperPick].pct}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="onboarding-banner onboarding-banner--warn">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {!allDone && !downloading && (
        <div>
          <HerOSButton onClick={() => void beginDownloads()} disabled={!whisperPick}>
            Download
          </HerOSButton>
        </div>
      )}
    </OnboardingStepFrame>
  )
}
