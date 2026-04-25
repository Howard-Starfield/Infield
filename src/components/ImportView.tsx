import { useState } from 'react';
import { ImportFilesTab } from './ImportFilesTab';
import { ImportUrlTab } from './ImportUrlTab';

type Tab = 'files' | 'url';

export function ImportView() {
  const [tab, setTab] = useState<Tab>('files');

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '20px 40px 0 40px',
          flexShrink: 0,
        }}
      >
        <div
          role="tablist"
          aria-label="Import source"
          style={{
            display: 'inline-flex',
            padding: 4,
            gap: 4,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 'var(--segmented-radius, 999px)',
          }}
        >
          {(['files', 'url'] as const).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t)}
                style={{
                  padding: '8px 18px',
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  background: active ? 'var(--heros-brand)' : 'transparent',
                  color: active ? '#fff' : 'rgba(255,255,255,0.55)',
                  border: 'none',
                  borderRadius: 'var(--segmented-radius, 999px)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'background 180ms ease, color 180ms ease',
                }}
              >
                {t === 'files' ? 'Files' : 'URL Downloader'}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tab === 'files' ? <ImportFilesTab /> : <ImportUrlTab />}
      </div>
    </div>
  );
}
