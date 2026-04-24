import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Command,
  Cpu,
  Database,
  Download,
  Gauge,
  Headphones,
  History,
  Info,
  Keyboard,
  Mic,
  Monitor,
  Palette,
  RefreshCw,
  Settings,
  Shield,
  Sparkles,
  Trash2,
  Volume2,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { ask } from '@tauri-apps/plugin-dialog';
import { useSettings } from '../hooks/useSettings';
import { useModelStore } from '../stores/modelStore';
import type {
  AppSettings,
  AudioDevice,
  ClipboardHandling,
  ModelInfo,
  ModelUnloadTimeout,
  OverlayPosition,
  PasteMethod,
  RecordingRetentionPeriod,
  ShortcutBinding,
  WhisperAcceleratorSetting,
  OrtAcceleratorSetting,
} from '../bindings';

type SettingKey = keyof AppSettings;

interface SettingsViewProps {
  onNavigate?: (page: string) => void;
}

type SelectOption<T extends string> = {
  label: string;
  value: T;
  description?: string;
};

const pasteMethodOptions: SelectOption<PasteMethod>[] = [
  { label: 'Ctrl/Cmd + V', value: 'ctrl_v' },
  { label: 'Direct typing', value: 'direct' },
  { label: 'Do nothing', value: 'none' },
  { label: 'Shift + Insert', value: 'shift_insert' },
  { label: 'Ctrl/Cmd + Shift + V', value: 'ctrl_shift_v' },
  { label: 'External script', value: 'external_script' },
];

const clipboardOptions: SelectOption<ClipboardHandling>[] = [
  { label: "Don't modify clipboard", value: 'dont_modify' },
  { label: 'Copy transcript to clipboard', value: 'copy_to_clipboard' },
];

const overlayOptions: SelectOption<OverlayPosition>[] = [
  { label: 'Bottom', value: 'bottom' },
  { label: 'Top', value: 'top' },
  { label: 'Hidden', value: 'none' },
];

const unloadOptions: SelectOption<ModelUnloadTimeout>[] = [
  { label: 'Never unload', value: 'never' },
  { label: 'Immediately', value: 'immediately' },
  { label: '15 seconds', value: 'sec_15' },
  { label: '2 minutes', value: 'min_2' },
  { label: '5 minutes', value: 'min_5' },
  { label: '10 minutes', value: 'min_10' },
  { label: '15 minutes', value: 'min_15' },
  { label: '1 hour', value: 'hour_1' },
];

const retentionOptions: SelectOption<RecordingRetentionPeriod>[] = [
  { label: 'Never delete', value: 'never' },
  { label: 'Preserve limit', value: 'preserve_limit' },
  { label: '3 days', value: 'days_3' },
  { label: '2 weeks', value: 'weeks_2' },
  { label: '3 months', value: 'months_3' },
];

const whisperAccelerationOptions: SelectOption<WhisperAcceleratorSetting>[] = [
  { label: 'Auto', value: 'auto' },
  { label: 'CPU', value: 'cpu' },
  { label: 'GPU', value: 'gpu' },
];

const ortAccelerationOptions: SelectOption<OrtAcceleratorSetting>[] = [
  { label: 'Auto', value: 'auto' },
  { label: 'CPU', value: 'cpu' },
  { label: 'CUDA', value: 'cuda' },
  { label: 'DirectML', value: 'directml' },
  { label: 'ROCm', value: 'rocm' },
];

const formatModelSize = (sizeMb: number) => {
  if (sizeMb >= 1024) return `${(sizeMb / 1024).toFixed(1)} GB`;
  return `${Math.round(sizeMb)} MB`;
};

const modelStatusLabel = (
  model: ModelInfo,
  currentModel: string,
  downloading: boolean,
  verifying: boolean,
  extracting: boolean,
) => {
  if (extracting) return 'Extracting';
  if (verifying) return 'Verifying';
  if (downloading || model.is_downloading) return 'Downloading';
  if (model.id === currentModel) return 'Active';
  if (model.is_downloaded || model.is_custom) return 'Ready';
  return 'Available';
};

const selectDeviceValue = (device?: string | null) => {
  if (!device || device === 'Default') return 'default';
  return device;
};

const deviceOptions = (devices: AudioDevice[]) => [
  { index: 'default', name: 'Default', is_default: true },
  ...devices.filter((device) => device.index !== 'default' && device.name.toLowerCase() !== 'default'),
];

function SectionHeader({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div style={{ marginBottom: '28px' }}>
      <h3
        style={{
          fontSize: '11px',
          fontWeight: 800,
          color: 'var(--heros-brand)',
          textTransform: 'uppercase',
          letterSpacing: '0.2em',
          margin: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        {icon} {title}
      </h3>
      {description && (
        <p style={{ margin: '10px 0 0 30px', color: 'rgba(255,255,255,0.45)', fontSize: 13, lineHeight: 1.6 }}>
          {description}
        </p>
      )}
    </div>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 24 }}>
      <div>
        <div style={{ fontSize: '16px', fontWeight: 600, color: '#fff' }}>{title}</div>
        <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', marginTop: 4, lineHeight: 1.5 }}>
          {description}
        </div>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        style={{
          width: 46,
          height: 24,
          background: checked ? 'var(--heros-brand)' : 'rgba(255,255,255,0.1)',
          borderRadius: 12,
          border: '1px solid rgba(255,255,255,0.08)',
          position: 'relative',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          transition: 'all 0.25s ease',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            background: '#fff',
            borderRadius: '50%',
            position: 'absolute',
            left: checked ? 24 : 3,
            top: 2,
            transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      </button>
    </div>
  );
}

function SelectRow<T extends string>({
  title,
  description,
  value,
  options,
  onChange,
}: {
  title: string;
  description: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(220px, 280px)', gap: 24, alignItems: 'center' }}>
      <div>
        <div style={{ fontSize: '16px', fontWeight: 600, color: '#fff' }}>{title}</div>
        <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', marginTop: 4, lineHeight: 1.5 }}>
          {description}
        </div>
      </div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        style={{
          width: '100%',
          background: 'rgba(0,0,0,0.24)',
          border: '1px solid rgba(255,255,255,0.1)',
          color: '#fff',
          borderRadius: 12,
          padding: '10px 12px',
          outline: 'none',
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function RangeRow({
  title,
  description,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  title: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: '#fff' }}>{title}</div>
          <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>{description}</div>
        </div>
        <span style={{ fontSize: 14, color: 'var(--heros-brand)', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ width: '100%', accentColor: 'var(--heros-brand)', cursor: 'pointer' }}
      />
    </div>
  );
}

function ShortcutRow({
  binding,
  onUpdate,
  onReset,
}: {
  binding: ShortcutBinding;
  onUpdate: (value: string) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const [value, setValue] = useState(binding.current_binding);

  useEffect(() => {
    setValue(binding.current_binding);
  }, [binding.current_binding]);

  const save = async () => {
    if (value.trim() === binding.current_binding) return;
    await onUpdate(value.trim());
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(220px, 300px)', gap: 24, alignItems: 'center' }}>
      <div>
        <div style={{ fontSize: '16px', fontWeight: 600, color: '#fff' }}>{binding.name}</div>
        <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>{binding.description}</div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save();
          }}
          style={{
            flex: 1,
            minWidth: 0,
            background: 'rgba(0,0,0,0.24)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#fff',
            borderRadius: 12,
            padding: '10px 12px',
            outline: 'none',
          }}
        />
        <button className="heros-btn" type="button" onClick={() => void onReset()} style={{ padding: '10px 12px', borderRadius: 12 }}>
          Reset
        </button>
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />;
}

export function SettingsView({ onNavigate: _onNavigate }: SettingsViewProps) {
  const {
    settings,
    isLoading,
    audioDevices,
    outputDevices,
    updateSetting,
    refreshAudioDevices,
    refreshOutputDevices,
    updateBinding,
    resetBinding,
  } = useSettings();

  const {
    models,
    currentModel,
    downloadingModels,
    verifyingModels,
    extractingModels,
    downloadProgress,
    loading: modelsLoading,
    error: modelError,
    initialized: modelsInitialized,
    initialize: initializeModels,
    selectModel,
    downloadModel,
    cancelDownload,
    deleteModel,
  } = useModelStore();

  useEffect(() => {
    if (!modelsInitialized) void initializeModels();
  }, [initializeModels, modelsInitialized]);

  useEffect(() => {
    void refreshAudioDevices();
    void refreshOutputDevices();
  }, [refreshAudioDevices, refreshOutputDevices]);

  const update = async <K extends SettingKey>(key: K, value: AppSettings[K]) => {
    await updateSetting(key, value);
  };

  const activeModel = useMemo(
    () => models.find((model) => model.id === currentModel),
    [currentModel, models],
  );

  const transcriptionModels = models.filter((model) => model.category === 'Transcription');
  const embeddingModels = models.filter((model) => model.category === 'Embedding');
  const llmModels = models.filter((model) => model.category === 'Llm');

  const shortcutBindings = Object.values(settings?.bindings ?? {}).filter(Boolean) as ShortcutBinding[];
  const primaryShortcuts = shortcutBindings.filter((binding) =>
    ['transcribe', 'transcribe_with_post_process', 'cancel', 'system_audio'].includes(binding.id),
  );

  const sections = [
    { id: 'general', label: 'General', icon: <Settings size={16} /> },
    { id: 'models', label: 'Models', icon: <Cpu size={16} /> },
    { id: 'audio', label: 'Audio', icon: <Mic size={16} /> },
    { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard size={16} /> },
    { id: 'output', label: 'Output', icon: <Command size={16} /> },
    { id: 'ai', label: 'AI', icon: <Sparkles size={16} /> },
    { id: 'advanced', label: 'Advanced', icon: <Shield size={16} /> },
    { id: 'history', label: 'History', icon: <History size={16} /> },
    { id: 'appearance', label: 'Appearance', icon: <Palette size={16} /> },
    { id: 'about', label: 'About', icon: <Info size={16} /> },
  ];

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const runModelAction = async (label: string, action: () => Promise<boolean>) => {
    const ok = await action();
    if (!ok) toast.error(`${label} failed`);
  };

  const handleDeleteModel = async (model: ModelInfo) => {
    const confirmed = await ask(`Delete ${model.name}?`, {
      title: 'Delete model',
      kind: 'warning',
    });
    if (confirmed) {
      await runModelAction('Delete model', () => deleteModel(model.id));
    }
  };

  const renderModelList = (title: string, modelList: ModelInfo[]) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
        {title}
      </div>
      {modelList.length === 0 ? (
        <div style={{ padding: 18, borderRadius: 14, background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
          No models in this category.
        </div>
      ) : (
        modelList.map((model) => {
          const downloading = model.id in downloadingModels;
          const verifying = model.id in verifyingModels;
          const extracting = model.id in extractingModels;
          const progress = downloadProgress[model.id]?.percentage ?? 0;
          const status = modelStatusLabel(model, currentModel, downloading, verifying, extracting);
          const isBusy = downloading || verifying || extracting || model.is_downloading;
          const isReady = model.is_downloaded || model.is_custom;
          const isActive = model.id === currentModel;

          return (
            <div
              key={model.id}
              style={{
                padding: 18,
                borderRadius: 18,
                background: isActive ? 'rgba(204,76,43,0.14)' : 'rgba(255,255,255,0.035)',
                border: isActive ? '1px solid rgba(204,76,43,0.34)' : '1px solid rgba(255,255,255,0.07)',
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 18,
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{model.name}</div>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: isActive ? 'var(--heros-brand)' : 'rgba(255,255,255,0.48)',
                    }}
                  >
                    {status}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.55 }}>
                  {model.description}
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap', color: 'rgba(255,255,255,0.36)', fontSize: 11 }}>
                  <span>{formatModelSize(model.size_mb)}</span>
                  {model.engine_type && <span>{model.engine_type}</span>}
                  {model.supports_translation && <span>Translation</span>}
                  {model.supports_language_selection && <span>{model.supported_languages.length} languages</span>}
                  {model.is_recommended && <span style={{ color: 'var(--heros-brand)' }}>Recommended</span>}
                </div>
                {isBusy && (
                  <div style={{ marginTop: 12, height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.max(4, progress)}%`,
                        height: '100%',
                        borderRadius: 999,
                        background: 'linear-gradient(90deg, var(--heros-brand), #ff8566)',
                      }}
                    />
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {isBusy ? (
                  <button className="heros-btn" type="button" onClick={() => void runModelAction('Cancel download', () => cancelDownload(model.id))}>
                    Cancel
                  </button>
                ) : isReady ? (
                  <>
                    <button
                      className="heros-btn"
                      type="button"
                      disabled={isActive}
                      onClick={() => void runModelAction('Select model', () => selectModel(model.id))}
                      style={{ opacity: isActive ? 0.55 : 1 }}
                    >
                      {isActive ? 'Active' : 'Use'}
                    </button>
                    {!model.is_custom && (
                      <button className="heros-btn" type="button" onClick={() => void handleDeleteModel(model)} style={{ color: '#ff9b9b' }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </>
                ) : (
                  <button className="heros-btn" type="button" onClick={() => void runModelAction('Download model', () => downloadModel(model.id))}>
                    <Download size={14} /> Download
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  if (isLoading || !settings) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'rgba(255,255,255,0.5)' }}>
        <RefreshCw className="spin" size={32} style={{ marginBottom: 16, opacity: 0.5 }} />
      </div>
    );
  }

  const microphoneChoices = deviceOptions(audioDevices).map((device) => ({
    label: device.name,
    value: device.index,
  }));
  const outputChoices = deviceOptions(outputDevices).map((device) => ({
    label: device.name,
    value: device.index,
  }));

  return (
    <div
      className="heros-page-container"
      style={{
        position: 'relative',
        zIndex: 5,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        maxWidth: '1280px',
        margin: '0 auto',
        padding: '40px',
      }}
    >
      <header style={{ marginBottom: '44px', textAlign: 'center', flexShrink: 0 }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            background: 'linear-gradient(135deg, var(--heros-brand) 0%, #ff8566 100%)',
            margin: '0 auto 24px auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 12px 32px rgba(204, 76, 43, 0.2)',
          }}
        >
          <Settings size={32} color="#fff" />
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: '#fff', marginBottom: 8 }}>Handy Settings</h1>
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 16 }}>
          Real transcription, model, audio, and runtime preferences wired into the HerOS shell.
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 200px', gap: 56, flex: 1, overflow: 'hidden', width: '100%' }}>
        <aside style={{ width: 200, position: 'sticky', top: 0, height: 'fit-content' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => scrollToSection(section.id)}
                className="heros-btn"
                type="button"
                style={{
                  justifyContent: 'flex-start',
                  width: '100%',
                  padding: '10px 14px',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 12,
                }}
              >
                <span style={{ color: 'var(--heros-brand)', opacity: 0.85, display: 'flex' }}>{section.icon}</span>
                <span style={{ marginLeft: 10 }}>{section.label}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="custom-scrollbar" style={{ overflowY: 'auto', height: '100%', paddingRight: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28, width: '100%', maxWidth: 840, margin: '0 auto', paddingBottom: 120 }}>
            <section id="general" className="heros-glass-card" style={{ padding: 32 }}>
              <SectionHeader icon={<Settings size={18} />} title="General" description="Startup, tray, and core capture behavior." />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <ToggleRow
                  title="Push to talk"
                  description="Hold the transcription shortcut to record; release to stop."
                  checked={Boolean(settings.push_to_talk)}
                  onChange={(value) => void update('push_to_talk', value)}
                />
                <Divider />
                <ToggleRow
                  title="Start hidden"
                  description="Launch Handy in the background instead of opening the main window."
                  checked={Boolean(settings.start_hidden)}
                  onChange={(value) => void update('start_hidden', value)}
                />
                <ToggleRow
                  title="Autostart"
                  description="Start Handy automatically when you sign in."
                  checked={Boolean(settings.autostart_enabled)}
                  onChange={(value) => void update('autostart_enabled', value)}
                />
                <ToggleRow
                  title="Show tray icon"
                  description="Keep Handy available from the system tray."
                  checked={settings.show_tray_icon ?? true}
                  onChange={(value) => void update('show_tray_icon', value)}
                />
              </div>
            </section>

            <section id="models" className="heros-glass-card" style={{ padding: 32 }}>
              <SectionHeader
                icon={<Cpu size={18} />}
                title="Models"
                description="Download, select, and remove local transcription and embedding models."
              />
              {modelsLoading ? (
                <div style={{ color: 'rgba(255,255,255,0.45)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <RefreshCw className="spin" size={16} /> Loading models...
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                  {modelError && (
                    <div style={{ color: '#ff9b9b', background: 'rgba(255,0,0,0.08)', border: '1px solid rgba(255,0,0,0.14)', borderRadius: 14, padding: 14 }}>
                      {modelError}
                    </div>
                  )}
                  {activeModel && (
                    <div style={{ padding: 18, borderRadius: 18, background: 'rgba(204,76,43,0.12)', border: '1px solid rgba(204,76,43,0.26)' }}>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.48)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 800 }}>
                        Active transcription model
                      </div>
                      <div style={{ marginTop: 8, color: '#fff', fontSize: 20, fontWeight: 800 }}>{activeModel.name}</div>
                      <div style={{ marginTop: 6, color: 'rgba(255,255,255,0.48)', fontSize: 13 }}>{activeModel.description}</div>
                    </div>
                  )}
                  {renderModelList('Transcription', transcriptionModels)}
                  {renderModelList('Embedding', embeddingModels)}
                  {llmModels.length > 0 && renderModelList('Local LLM', llmModels)}
                </div>
              )}
            </section>

            <section id="audio" className="heros-glass-card" style={{ padding: 32 }}>
              <SectionHeader icon={<Mic size={18} />} title="Audio" description="Input, output, feedback, and recording behavior." />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <SelectRow
                  title="Microphone"
                  description="Device used for microphone transcription."
                  value={selectDeviceValue(settings.selected_microphone)}
                  options={microphoneChoices}
                  onChange={(value) => void update('selected_microphone', value)}
                />
                <SelectRow
                  title="Audio feedback output"
                  description="Device used for start/stop feedback sounds."
                  value={selectDeviceValue(settings.selected_output_device)}
                  options={outputChoices}
                  onChange={(value) => void update('selected_output_device', value)}
                />
                <Divider />
                <ToggleRow
                  title="Mute while recording"
                  description="Mute system output while Handy records microphone audio."
                  checked={Boolean(settings.mute_while_recording)}
                  onChange={(value) => void update('mute_while_recording', value)}
                />
                <ToggleRow
                  title="Audio feedback"
                  description="Play a sound when recording starts and stops."
                  checked={Boolean(settings.audio_feedback)}
                  onChange={(value) => void update('audio_feedback', value)}
                />
                <RangeRow
                  title="Feedback volume"
                  description="Volume for recording feedback sounds."
                  value={Math.round((settings.audio_feedback_volume ?? 1) * 100)}
                  min={0}
                  max={100}
                  step={1}
                  suffix="%"
                  onChange={(value) => void update('audio_feedback_volume', value / 100)}
                />
              </div>
            </section>

            <section id="shortcuts" className="heros-glass-card" style={{ padding: 32 }}>
              <SectionHeader icon={<Keyboard size={18} />} title="Shortcuts" description="Edit global shortcut strings and reset defaults." />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {primaryShortcuts.length === 0 ? (
                  <div style={{ color: 'rgba(255,255,255,0.42)' }}>No shortcut bindings loaded.</div>
                ) : (
                  primaryShortcuts.map((binding) => (
                    <ShortcutRow
                      key={binding.id}
                      binding={binding}
                      onUpdate={async (value) => {
                        await updateBinding(binding.id, value);
                      }}
                      onReset={async () => {
                        await resetBinding(binding.id);
                      }}
                    />
                  ))
                )}
              </div>
            </section>

            <section id="output" className="heros-glass-card" style={{ padding: 32 }}>
              <SectionHeader icon={<Command size={18} />} title="Output" description="How transcripts are pasted, copied, and submitted." />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <SelectRow
                  title="Paste method"
                  description="How Handy inserts text into the active app."
                  value={(settings.paste_method ?? 'ctrl_v') as PasteMethod}
                  options={pasteMethodOptions}
                  onChange={(value) => void update('paste_method', value)}
                />
                <SelectRow
                  title="Clipboard handling"
                  description="Whether the transcript should be copied to clipboard."
                  value={(settings.clipboard_handling ?? 'dont_modify') as ClipboardHandling}
                  options={clipboardOptions}
                  onChange={(value) => void update('clipboard_handling', value)}
                />
                <ToggleRow
                  title="Auto submit"
                  description="Press Enter after pasting into chat-style apps."
                  checked={Boolean(settings.auto_submit)}
                  onChange={(value) => void update('auto_submit', value)}
                />
                <ToggleRow
                  title="Append trailing space"
                  description="Add a space after pasted transcript text."
                  checked={Boolean(settings.append_trailing_space)}
                  onChange={(value) => void update('append_trailing_space', value)}
                />
                <RangeRow
                  title="Paste delay"
                  description="Delay before text insertion after clipboard setup."
                  value={settings.paste_delay_ms ?? 60}
                  min={0}
                  max={1000}
                  step={10}
                  suffix="ms"
                  onChange={(value) => void update('paste_delay_ms', value)}
                />
              </div>
            </section>

            <section id="ai" className="heros-glass-card" style={{ padding: 32 }}>
              <SectionHeader icon={<Sparkles size={18} />} title="AI & Language" description="Translation, post-processing, and model-specific language controls." />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <ToggleRow
                  title="Translate to English"
                  description="Ask supported transcription models to translate speech into English."
                  checked={Boolean(settings.translate_to_english)}
                  disabled={!activeModel?.supports_translation}
                  onChange={(value) => void update('translate_to_english', value)}
                />
                <ToggleRow
                  title="Post-processing"
                  description="Run transcript cleanup through the configured post-processing provider."
                  checked={Boolean(settings.post_process_enabled)}
                  onChange={(value) => void update('post_process_enabled', value)}
                />
                <ToggleRow
                  title="Auto tagging"
                  description="Let Handy generate tags for saved transcript notes."
                  checked={Boolean(settings.auto_tag_enabled)}
                  onChange={(value) => void update('auto_tag_enabled', value)}
                />
                <div style={{ padding: 18, borderRadius: 16, background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <div style={{ fontSize: 14, color: '#fff', fontWeight: 800 }}>Post-processing provider</div>
                  <div style={{ marginTop: 6, color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>
                    Active provider: {settings.post_process_provider_id ?? 'not selected'}.
                    Detailed provider keys and prompt editing will be wired into this HerOS surface next.
                  </div>
                </div>
              </div>
            </section>

            <section id="advanced" className="heros-glass-card" style={{ padding: 32 }}>
              <SectionHeader icon={<Shield size={18} />} title="Advanced" description="Runtime behavior, overlay, acceleration, and diagnostics." />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <SelectRow
                  title="Overlay position"
                  description="Where the recording overlay appears."
                  value={(settings.overlay_position ?? 'bottom') as OverlayPosition}
                  options={overlayOptions}
                  onChange={(value) => void update('overlay_position', value)}
                />
                <SelectRow
                  title="Model unload"
                  description="When the transcription model should unload from memory."
                  value={(settings.model_unload_timeout ?? 'never') as ModelUnloadTimeout}
                  options={unloadOptions}
                  onChange={(value) => void update('model_unload_timeout', value)}
                />
                <SelectRow
                  title="Whisper acceleration"
                  description="Hardware backend used by Whisper where supported."
                  value={(settings.whisper_accelerator ?? 'auto') as WhisperAcceleratorSetting}
                  options={whisperAccelerationOptions}
                  onChange={(value) => void update('whisper_accelerator', value)}
                />
                <SelectRow
                  title="Embedding acceleration"
                  description="Hardware backend for ONNX embedding models."
                  value={(settings.ort_accelerator ?? 'auto') as OrtAcceleratorSetting}
                  options={ortAccelerationOptions}
                  onChange={(value) => void update('ort_accelerator', value)}
                />
                <ToggleRow
                  title="Debug mode"
                  description="Enable verbose logs and debug-only settings."
                  checked={Boolean(settings.debug_mode)}
                  onChange={(value) => void update('debug_mode', value)}
                />
                <ToggleRow
                  title="Experimental features"
                  description="Reveal unstable capabilities like alternate keyboard backends."
                  checked={Boolean(settings.experimental_enabled)}
                  onChange={(value) => void update('experimental_enabled', value)}
                />
              </div>
            </section>

            <section id="history" className="heros-glass-card" style={{ padding: 32 }}>
              <SectionHeader icon={<History size={18} />} title="History" description="Transcript retention and saved recording limits." />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <RangeRow
                  title="History limit"
                  description="Maximum saved transcript entries retained in history."
                  value={settings.history_limit ?? 5}
                  min={1}
                  max={100}
                  step={1}
                  suffix=""
                  onChange={(value) => void update('history_limit', value)}
                />
                <SelectRow
                  title="Recording retention"
                  description="How long source audio recordings are preserved."
                  value={(settings.recording_retention_period ?? 'preserve_limit') as RecordingRetentionPeriod}
                  options={retentionOptions}
                  onChange={(value) => void update('recording_retention_period', value)}
                />
              </div>
            </section>

            <section id="appearance" className="heros-glass-card" style={{ padding: 32 }}>
              <SectionHeader icon={<Palette size={18} />} title="Appearance" description="HerOS shell scale and atmospheric rendering." />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18 }}>
                <div style={{ padding: 18, borderRadius: 18, background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <Monitor size={18} color="var(--heros-brand)" />
                  <div style={{ marginTop: 10, fontSize: 15, fontWeight: 800, color: '#fff' }}>Native UI scale</div>
                  <div style={{ marginTop: 6, fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
                    The current HerOS shell handles scale through Vault preferences and native webview zoom.
                  </div>
                </div>
                <div style={{ padding: 18, borderRadius: 18, background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <Gauge size={18} color="var(--heros-brand)" />
                  <div style={{ marginTop: 10, fontSize: 15, fontWeight: 800, color: '#fff' }}>Atmosphere</div>
                  <div style={{ marginTop: 6, fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
                    Theme and background controls remain in the HerOS visual layer and are intentionally not mixed with transcription settings.
                  </div>
                </div>
              </div>
            </section>

            <section id="about" className="heros-glass-card" style={{ padding: 32 }}>
              <SectionHeader icon={<Info size={18} />} title="About" description="Current runtime details." />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  ['Application', 'Handy / Infield'],
                  ['Frontend', 'HerOS port'],
                  ['Active model', activeModel?.name ?? (currentModel || 'None selected')],
                  ['Capture mode', settings.capture_mode ?? 'microphone'],
                  ['Embedding model', settings.embedding_model ?? 'default'],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>{label}</span>
                    <span style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>{value}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </main>

        <div style={{ width: 200, flexShrink: 0 }}>
          <div className="heros-glass-card" style={{ padding: 18, position: 'sticky', top: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--heros-brand)', fontWeight: 800, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
              <Zap size={14} /> Wired
            </div>
            <p style={{ margin: '12px 0 0 0', color: 'rgba(255,255,255,0.45)', fontSize: 12, lineHeight: 1.55 }}>
              This page now writes to Handy settings and model commands. Changes apply immediately unless the underlying backend needs the next capture.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
