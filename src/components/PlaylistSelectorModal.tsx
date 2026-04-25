import { useState, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PlaylistEnvelope, PlaylistEntry } from '../bindings';

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function PlaylistSelectorModal({
  envelope, onCancel, onCommit,
}: {
  envelope: PlaylistEnvelope;
  onCancel: () => void;
  onCommit: (selectedEntries: PlaylistEntry[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(envelope.entries.map(e => e.source_id))
  );
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() =>
    envelope.entries.filter(e => e.title.toLowerCase().includes(filter.toLowerCase())),
    [envelope.entries, filter]
  );

  const selectAll = () => setSelected(new Set(envelope.entries.map(e => e.source_id)));
  const selectNone = () => setSelected(new Set());
  const invert = () => setSelected(s => {
    const next = new Set<string>();
    for (const e of envelope.entries) if (!s.has(e.source_id)) next.add(e.source_id);
    return next;
  });
  const toggle = (id: string) => setSelected(s => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 8,
  });

  const handleCommit = () => {
    onCommit(envelope.entries.filter(e => selected.has(e.source_id)));
  };

  return (
    <div className="playlist-modal" role="dialog" aria-modal="true">
      <div className="playlist-modal__backdrop" onClick={onCancel} />
      <div className="playlist-modal__panel heros-glass-panel">
        <header className="playlist-modal__header">
          <div>
            <h2>{envelope.playlist_title}</h2>
            <p>{envelope.channel ?? ''} · {envelope.entries.length} videos</p>
          </div>
          <button className="playlist-modal__close" onClick={onCancel} aria-label="Close">✕</button>
        </header>
        <div className="playlist-modal__toolbar">
          <button className="heros-btn" onClick={selectAll}>Select all</button>
          <button className="heros-btn" onClick={selectNone}>Select none</button>
          <button className="heros-btn" onClick={invert}>Invert</button>
          <input
            className="playlist-modal__filter"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter…"
          />
        </div>
        <div className="playlist-modal__list" ref={parentRef}>
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map(v => {
              const e = filtered[v.index];
              return (
                <label
                  key={e.source_id}
                  className="playlist-row"
                  style={{
                    position: 'absolute', top: 0, left: 0, right: 0,
                    transform: `translateY(${v.start}px)`, height: v.size,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(e.source_id)}
                    onChange={() => toggle(e.source_id)}
                  />
                  {e.thumbnail_url && (
                    <img className="playlist-row__thumb" src={e.thumbnail_url} alt="" />
                  )}
                  <div className="playlist-row__body">
                    <div className="playlist-row__title">{e.title}</div>
                    <small className="playlist-row__meta">
                      {e.channel ?? ''} · {formatDuration(e.duration_seconds)}
                    </small>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
        <footer className="playlist-modal__footer">
          <button className="heros-btn" onClick={onCancel}>Cancel</button>
          <button
            className="heros-btn heros-btn-brand"
            disabled={selected.size === 0}
            onClick={handleCommit}
          >
            Import {selected.size} videos →
          </button>
        </footer>
      </div>
    </div>
  );
}
