import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Clock, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import type { ImportJobDto } from '../bindings';
import { ScrollShadow } from './ScrollShadow';
import { jobProgress, jobStatusLine, jobTitle } from '../utils/importJobs';

interface ListBaseProps {
  jobs: ImportJobDto[];
  renderThumb: (job: ImportJobDto) => React.ReactNode;
}

export function ImportProcessingList({ jobs, renderThumb }: ListBaseProps) {
  if (jobs.length === 0) return null;
  return (
    <section
      className="heros-glass-card"
      style={{
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingBottom: 8,
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '13px', fontWeight: 600 }}>
          <Clock size={15} color="rgba(255,255,255,0.4)" />
          Processing
          <span
            style={{
              padding: '3px 9px',
              fontSize: '10px',
              background: 'rgba(255,255,255,0.06)',
              borderRadius: 14,
              color: 'var(--heros-text-dim)',
            }}
          >
            {jobs.length} active
          </span>
        </div>
      </div>

      <ScrollShadow style={{ maxHeight: 280 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <AnimatePresence initial={false}>
            {jobs.map((job, i) => (
              <motion.div
                key={job.id}
                layout
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: i * 0.05 }}
                className="import-row-hover"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '32px 1fr auto',
                  gap: 12,
                  alignItems: 'center',
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: 'rgba(0,0,0,0.14)',
                  border: '1px solid rgba(255,255,255,0.04)',
                  transition: 'all 0.2s',
                }}
              >
                {renderThumb(job)}
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '12.5px',
                      color: '#fff',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {jobTitle(job)}
                  </div>
                  <div
                    style={{
                      fontSize: '10.5px',
                      color: 'var(--heros-text-dim)',
                      marginTop: 1,
                      fontFamily: 'monospace',
                    }}
                  >
                    {jobStatusLine(job)}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 80,
                      height: 4,
                      background: 'rgba(0,0,0,0.28)',
                      borderRadius: 2,
                      overflow: 'hidden',
                      position: 'relative',
                    }}
                  >
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${jobProgress(job)}%` }}
                      className="shimmer-bar"
                      style={{
                        height: '100%',
                        background: 'linear-gradient(90deg, #f0d8d0, #fff)',
                        borderRadius: 2,
                        boxShadow: '0 0 8px rgba(253,249,243,0.5)',
                      }}
                    />
                  </div>
                  <div
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      padding: '4px 8px',
                      borderRadius: 8,
                      background: 'rgba(255,255,255,0.08)',
                      color: 'var(--heros-text-dim)',
                      fontFamily: 'monospace',
                    }}
                  >
                    {jobProgress(job)}%
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </ScrollShadow>
    </section>
  );
}

interface CompletedListProps extends ListBaseProps {
  onClear: () => void;
}

export function ImportCompletedList({ jobs, renderThumb, onClear }: CompletedListProps) {
  const [autoExpanded, setAutoExpanded] = useState(false);
  const [manualExpanded, setManualExpanded] = useState(false);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recentIds, setRecentIds] = useState<Set<string>>(new Set());

  const expanded = autoExpanded || manualExpanded;

  useEffect(() => {
    if (!initializedRef.current) {
      jobs.forEach((j) => seenIdsRef.current.add(j.id));
      initializedRef.current = true;
      return;
    }
    const newOnes = jobs.filter((j) => !seenIdsRef.current.has(j.id));
    if (newOnes.length === 0) return;
    newOnes.forEach((j) => seenIdsRef.current.add(j.id));
    setRecentIds((prev) => {
      const next = new Set(prev);
      newOnes.forEach((j) => next.add(j.id));
      return next;
    });
    setAutoExpanded(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setAutoExpanded(false);
      setRecentIds(new Set());
    }, 1000);
  }, [jobs]);

  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    },
    [],
  );

  const visibleJobs = useMemo(() => {
    if (manualExpanded) return jobs;
    if (autoExpanded) return jobs.filter((j) => recentIds.has(j.id));
    return [];
  }, [jobs, manualExpanded, autoExpanded, recentIds]);

  if (jobs.length === 0) return null;

  return (
    <motion.section
      layout
      className="heros-glass-card"
      style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setManualExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setManualExpanded((v) => !v);
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingBottom: 8,
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          cursor: 'pointer',
          width: '100%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '13px', fontWeight: 600 }}>
          <CheckCircle2 size={15} color="#9cf0c9" />
          Completed
          <span
            style={{
              padding: '3px 9px',
              fontSize: '10px',
              background: 'rgba(255,255,255,0.06)',
              borderRadius: 14,
              color: 'var(--heros-text-dim)',
            }}
          >
            {jobs.length}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            className="heros-btn"
            style={{ fontSize: 10, padding: '3px 10px', borderRadius: 6, opacity: 0.7 }}
            title="Clear completed history"
          >
            Clear
          </button>
          {manualExpanded ? (
            <ChevronUp size={14} color="rgba(255,255,255,0.4)" />
          ) : (
            <ChevronDown size={14} color="rgba(255,255,255,0.4)" />
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="completed-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            style={{ overflow: 'hidden' }}
          >
            <ScrollShadow style={{ maxHeight: 320 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <AnimatePresence initial={false}>
                  {visibleJobs.map((job) => {
                    const isRecent = recentIds.has(job.id);
                    return (
                      <motion.div
                        key={job.id}
                        layout
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        className="import-row-hover"
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '32px 1fr auto',
                          gap: 12,
                          alignItems: 'center',
                          padding: '10px 12px',
                          borderRadius: 12,
                          background: isRecent ? 'rgba(16,185,129,0.10)' : 'rgba(0,0,0,0.14)',
                          border: `1px solid ${
                            isRecent ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.04)'
                          }`,
                          opacity: isRecent ? 1 : 0.72,
                          transition: 'background 200ms ease, border 200ms ease',
                        }}
                      >
                        {renderThumb(job)}
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: '12.5px',
                              color: '#fff',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {jobTitle(job)}
                          </div>
                          <div
                            style={{
                              fontSize: '10.5px',
                              color: 'var(--heros-text-dim)',
                              marginTop: 1,
                              fontFamily: 'monospace',
                            }}
                          >
                            {jobStatusLine(job)}
                          </div>
                        </div>
                        <div
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            padding: '4px 8px',
                            borderRadius: 8,
                            background:
                              job.state === 'done'
                                ? 'rgba(16,185,129,0.18)'
                                : 'rgba(239,68,68,0.18)',
                            color: job.state === 'done' ? '#9cf0c9' : '#ffb4b4',
                            textTransform: 'uppercase',
                            letterSpacing: '0.1em',
                          }}
                        >
                          {job.state}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </ScrollShadow>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
