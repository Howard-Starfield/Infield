import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { useVault } from '../contexts/VaultContext';
import { useYtDlpPlugin } from '../hooks/useYtDlpPlugin';
import { OnboardingStepFrame } from './OnboardingStepFrame';
import '../styles/onboarding-extensions.css';

export function OnboardingStepExtensions() {
  const { completeStep } = useVault();
  const plugin = useYtDlpPlugin();
  const [installSelected, setInstallSelected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNext = async () => {
    if (installSelected) {
      try { await plugin.install(); }
      catch (e) {
        setError(String(e));
        // Don't block — let user continue and retry from Settings later.
      }
    }
    await completeStep({
      current_step: 'done',
      mic_permission: null,
      accessibility_permission: null,
      models_downloaded: null,
      vault_root: null,
      completed_at: Math.floor(Date.now() / 1000),
    });
  };

  const handleSkip = async () => {
    await completeStep({
      current_step: 'done',
      mic_permission: null,
      accessibility_permission: null,
      models_downloaded: null,
      vault_root: null,
      completed_at: Math.floor(Date.now() / 1000),
    });
  };

  return (
    <OnboardingStepFrame
      stepIndex={5}
      icon={<Download size={20} />}
      title="Optional extensions"
      canContinue={!plugin.installing}
      continueLabel={plugin.installing ? 'Installing…' : (installSelected ? 'Install selected' : 'Continue')}
      onSkip={() => void handleSkip()}
      skipLabel="Skip for now"
      onContinue={() => void handleNext()}
    >
      <p>Add extra capabilities. Install now or later from Settings → Extensions.</p>

      <label className="onboarding-extension-option">
        <input
          type="checkbox"
          checked={installSelected}
          onChange={e => setInstallSelected(e.target.checked)}
          disabled={plugin.installing}
        />
        <div className="onboarding-extension-option__body">
          <strong>Media downloader</strong>
          <span className="onboarding-extension-option__size">(12 MB)</span>
          <p className="onboarding-extension-option__desc">
            Import from URLs — YouTube, podcasts, social platforms, 1000+ sites.
          </p>
        </div>
      </label>

      {error && <p className="onboarding-extensions__error">{error}</p>}
    </OnboardingStepFrame>
  );
}
