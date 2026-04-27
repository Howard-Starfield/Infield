import React, { useState } from 'react';
import {
  Bot,
  ChevronRight,
  Gift,
  ShieldCheck,
  Sparkles,
  Trophy,
  Zap,
} from 'lucide-react';
import { motion } from 'motion/react';
import buddyWingSprite from '../assets/sprite.png';
import { useBuddy } from '../contexts/BuddyContext';
import { ChestRevealModal } from './ChestRevealModal';
import { GearInventoryPanel } from './GearInventoryPanel';
import { lootBonusPct } from '../buddy/teamPower';
import type { ClaimResult } from '../buddy/types';

// Sprite row map for roster buddies (index 1-based to match sprite sheet)
const BUDDY_SPRITE_ROW: Record<string, string> = {
  'scout-wings':   'buddy-wing-sprite--row-1',
  'hover-wings':   'buddy-wing-sprite--row-2',
  'glide-wings':   'buddy-wing-sprite--row-3',
  'lookout-wings': 'buddy-wing-sprite--row-4',
  'sleepy-wings':  'buddy-wing-sprite--row-5',
  'patrol-wings':  'buddy-wing-sprite--row-6',
};

// Capitalize words for display
function displayName(id: string) {
  return id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function BuddyView() {
  const { state, actions } = useBuddy();
  const [chestResult, setChestResult] = useState<ClaimResult | null>(null);

  if (!state) return <div className="heros-page-container">Loading buddy…</div>;

  const claimable = state.points_balance + state.points_overflow;
  const canClaim = claimable >= 50;
  const active = state.roster.find(b => b.buddy_id === state.active_buddy_id);
  const activeSpriteRow = active ? (BUDDY_SPRITE_ROW[active.buddy_id] ?? 'buddy-wing-sprite--row-1') : 'buddy-wing-sprite--row-1';
  const lootBonus = lootBonusPct(state.team_power);

  const onClaim = async () => {
    try {
      const result = await actions.claim();
      setChestResult(result);
    } catch (e) {
      console.error('[buddy] claim failed', e);
    }
  };

  return (
    <div
      style={{
        height: '100%',
        overflow: 'auto',
        padding: 24,
        display: 'grid',
        gridTemplateColumns: 'minmax(520px, 1.25fr) minmax(360px, 0.75fr)',
        gap: 16,
      }}
      className="custom-scrollbar"
    >
      <section style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        {/* Hero card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="heros-glass-card"
          style={{
            minHeight: 360,
            padding: 28,
            position: 'relative',
            overflow: 'hidden',
            display: 'grid',
            gridTemplateColumns: '280px 1fr',
            gap: 28,
            background:
              'radial-gradient(circle at 18% 22%, rgba(204,76,43,0.22), transparent 34%), rgba(0,0,0,0.16)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(115deg, rgba(255,255,255,0.06), transparent 32%, rgba(204,76,43,0.05) 72%, transparent)',
              pointerEvents: 'none',
            }}
          />

          {/* Active buddy sprite */}
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div
              className="buddy-sprite-stage"
              style={{
                ['--buddy-sprite' as string]: `url(${buddyWingSprite})`,
              }}
            >
              <div
                className={`buddy-wing-sprite buddy-wing-sprite--hero ${activeSpriteRow}`}
                aria-label="Winged workspace buddy"
              />
            </div>
            <div
              style={{
                marginTop: -22,
                padding: '9px 14px',
                borderRadius: 999,
                background: 'rgba(10,11,15,0.72)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#fff',
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: '0.04em',
                boxShadow: '0 14px 34px rgba(0,0,0,0.34)',
              }}
            >
              {active ? displayName(active.buddy_id) : 'Winged Workspace Buddy'}
              {active?.shiny ? ' ★' : ''}
              {active ? ` · L${active.level}` : ''}
            </div>
          </div>

          {/* Stats column */}
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 24 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 11, fontWeight: 900, color: 'var(--heros-brand)', textTransform: 'uppercase', letterSpacing: '0.18em' }}>
                  Buddy System
                </span>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 12px #10b981' }} />
              </div>
              <h1 style={{ margin: 0, color: '#fff', fontSize: 44, lineHeight: 1, fontWeight: 900, letterSpacing: 0 }}>
                {active ? `${displayName(active.buddy_id)} is watching the workspace.` : 'Buddy is watching the workspace.'}
              </h1>
              <p style={{ margin: '18px 0 0', maxWidth: 560, color: 'rgba(255,255,255,0.62)', fontSize: 15, lineHeight: 1.7 }}>
                A deterministic companion that reacts to indexing, search, and workflow events. Rewards stay cosmetic, utility stays untouched.
                {lootBonus > 0 && ` Loot bonus: +${lootBonus}% from team power.`}
              </p>
            </div>

            {/* Live stat cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              <StatCard label="Discovery points" value={Math.floor(claimable).toLocaleString()} icon={<Sparkles size={16} color="var(--heros-brand)" />} />
              <StatCard label="Chest fill" value={`${Math.round((state.points_balance / state.cap_total) * 100)}%`} icon={<Gift size={16} color="var(--heros-brand)" />} />
              <StatCard label="Codex seen" value={`${state.roster.length} / 18`} icon={<Trophy size={16} color="var(--heros-brand)" />} />
              <StatCard label="Team Power" value={Math.floor(state.team_power).toLocaleString()} icon={<Zap size={16} color="var(--heros-brand)" />} />
            </div>
          </div>
        </motion.div>

        {/* Gear inventory (new B1 panel) */}
        <GearInventoryPanel />

        {/* Bottom row: Activity Log + Ethical Loop */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Activity Log — B2 stub (replaces Reaction Hub mock) */}
          <section className="heros-glass-card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <PanelTitle icon={<Zap size={18} />} label="Activity Log" action="Coming in B2" />
            <p style={{ color: 'rgba(255,255,255,0.42)', fontSize: 13, margin: 0 }}>
              Live workspace events will appear here once the B2 event stream is wired.
            </p>
          </section>

          <section className="heros-glass-card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <PanelTitle icon={<ShieldCheck size={18} />} label="Ethical Loop" action="Cosmetic only" />
            {[
              'No feature gating',
              'No paid card draws',
              'One-click gamification off',
              'Transparent deterministic seed',
            ].map((rule) => (
              <div key={rule} style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'rgba(255,255,255,0.72)', fontSize: 13, fontWeight: 700 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--heros-brand)', boxShadow: '0 0 12px rgba(204,76,43,0.4)' }} />
                {rule}
              </div>
            ))}
          </section>
        </div>
      </section>

      <aside style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        {/* Workspace Expedition — live claim */}
        <section className="heros-glass-card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <PanelTitle
            icon={<Gift size={18} />}
            label="Workspace Expedition"
            action={canClaim ? 'Ready!' : `${Math.ceil(50 - claimable)} pt to claim`}
          />
          <div style={{ padding: 18, borderRadius: 18, background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <div style={{ color: '#fff', fontWeight: 900, fontSize: 18 }}>Exploring workspace.db</div>
                <div style={{ color: 'rgba(255,255,255,0.42)', fontSize: 12, marginTop: 4 }}>
                  {Math.floor(claimable)} / {state.cap_total} pts accumulated
                </div>
              </div>
              <Sparkles size={24} color="var(--heros-brand)" />
            </div>
            <div style={{ height: 10, borderRadius: 999, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.min(100, (state.points_balance / state.cap_total) * 100)}%`,
                  height: '100%',
                  borderRadius: 999,
                  background: 'linear-gradient(90deg, var(--heros-brand), #ffb199)',
                }}
              />
            </div>
            <button
              className="heros-btn-brand"
              disabled={!canClaim}
              onClick={onClaim}
              style={{ marginTop: 16, width: '100%', height: 42, borderRadius: 12, fontSize: 13, fontWeight: 900 }}
            >
              {state.points_balance >= state.cap_total ? 'Claim chest (full!)' : canClaim ? 'Claim chest' : `Need ${Math.ceil(50 - claimable)} more pt`}
            </button>
          </div>
        </section>

        {/* Milestones — live from context */}
        <section className="heros-glass-card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <PanelTitle
            icon={<Trophy size={18} />}
            label="Milestones"
            action={`${state.milestones.length} active`}
          />
          {state.milestones.length === 0 ? (
            <p style={{ color: 'rgba(255,255,255,0.42)', fontSize: 13, margin: 0 }}>No milestones yet — keep using the workspace!</p>
          ) : (
            state.milestones.map((m) => {
              const pct = m.target > 0 ? Math.min(100, Math.round((m.progress / m.target) * 100)) : 0;
              return (
                <div key={m.milestone_id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                    <span style={{ color: '#fff', fontSize: 13, fontWeight: 800 }}>{m.milestone_id}</span>
                    <span style={{ color: 'var(--heros-brand)', fontSize: 11, fontWeight: 900 }}>{pct}%</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'rgba(204,76,43,0.85)' }} />
                  </div>
                  <div style={{ marginTop: 6, color: 'rgba(255,255,255,0.36)', fontSize: 11 }}>
                    {m.progress} / {m.target}
                  </div>
                </div>
              );
            })
          )}
        </section>

        {/* Roster — click to set active */}
        <section className="heros-glass-card" style={{ padding: 22, flex: 1, minHeight: 260 }}>
          <PanelTitle icon={<Bot size={18} />} label="Buddy Codex" action={`${state.roster.length} / 18 seen`} />
          <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {state.roster.map((b) => {
              const isActive = b.buddy_id === state.active_buddy_id;
              const spriteRow = BUDDY_SPRITE_ROW[b.buddy_id] ?? 'buddy-wing-sprite--row-1';
              return (
                <button
                  key={b.buddy_id}
                  onClick={() => actions.switchActiveBuddy(b.buddy_id)}
                  style={{
                    padding: 14,
                    minHeight: 104,
                    borderRadius: 16,
                    background: isActive ? 'rgba(204,76,43,0.12)' : 'rgba(255,255,255,0.035)',
                    border: isActive ? '1px solid rgba(204,76,43,0.24)' : '1px solid rgba(255,255,255,0.06)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div
                    style={
                      {
                        width: 58,
                        height: 42,
                        borderRadius: 12,
                        background: isActive ? 'rgba(204,76,43,0.12)' : 'rgba(255,255,255,0.05)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        ['--buddy-sprite' as string]: `url(${buddyWingSprite})`,
                      } as React.CSSProperties
                    }
                  >
                    <div className={`buddy-wing-sprite buddy-wing-sprite--mini ${spriteRow}`} />
                  </div>
                  <div>
                    <div style={{ color: '#fff', fontSize: 13, fontWeight: 900 }}>
                      {displayName(b.buddy_id)}{b.shiny ? ' ★' : ''}
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.36)', fontSize: 11, marginTop: 2 }}>
                      L{b.level}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </aside>

      <ChestRevealModal result={chestResult} onClose={() => setChestResult(null)} />
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 14,
        background: 'rgba(255,255,255,0.045)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      {icon}
      <div style={{ marginTop: 10, color: '#fff', fontSize: 18, fontWeight: 900 }}>{value}</div>
      <div style={{ marginTop: 2, color: 'rgba(255,255,255,0.36)', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>
        {label}
      </div>
    </div>
  );
}

function PanelTitle({ icon, label, action }: { icon: React.ReactNode; label: string; action: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ color: 'var(--heros-brand)', display: 'flex' }}>{icon}</div>
        <span style={{ color: '#fff', fontSize: 14, fontWeight: 900 }}>{label}</span>
      </div>
      <button style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'rgba(255,255,255,0.42)', fontSize: 11, fontWeight: 800 }}>
        {action}
        <ChevronRight size={13} />
      </button>
    </div>
  );
}
