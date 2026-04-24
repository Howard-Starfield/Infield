import React from 'react';
import {
  Activity,
  Bot,
  ChevronRight,
  Clock3,
  Database,
  Gift,
  MessageCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
  Zap,
} from 'lucide-react';
import { motion } from 'motion/react';
import buddyWingSprite from '../assets/sprite.png';

const hooks = [
  { label: 'Embedding queue drained', detail: 'Muon reacts when background indexing finishes.', icon: Database },
  { label: 'Hybrid search zero-hit', detail: 'Suggests a different scope without interrupting.', icon: Search },
  { label: 'First workspace event', detail: 'Marks the first useful action of the day.', icon: Activity },
  { label: 'Long-running job', detail: 'Turns progress into an expedition instead of a spinner.', icon: Clock3 },
];

const codex = [
  { species: 'Scout Wings', rarity: 'Legendary', state: 'active', animation: 'buddy-wing-sprite--row-1' },
  { species: 'Hover Wings', rarity: 'Common', state: 'locked', animation: 'buddy-wing-sprite--row-2' },
  { species: 'Glide Wings', rarity: 'Rare', state: 'locked', animation: 'buddy-wing-sprite--row-3' },
  { species: 'Lookout Wings', rarity: 'Epic', state: 'locked', animation: 'buddy-wing-sprite--row-4' },
  { species: 'Sleepy Wings', rarity: 'Common', state: 'locked', animation: 'buddy-wing-sprite--row-5' },
  { species: 'Patrol Wings', rarity: 'Legendary', state: 'locked', animation: 'buddy-wing-sprite--row-6' },
];

const milestones = [
  { title: '1,000 embeddings indexed', progress: 0.72, reward: 'Milestone chest' },
  { title: '30 useful searches clicked', progress: 0.48, reward: 'Speech bubble theme' },
  { title: '7-day workspace streak', progress: 0.86, reward: 'Rare hat roll' },
];

const statCards = [
  { label: 'Discovery points', value: '2,840', icon: Sparkles },
  { label: 'Chest fill', value: '68%', icon: Gift },
  { label: 'Reactions today', value: '14', icon: MessageCircle },
  { label: 'Codex seen', value: '6 / 18', icon: Trophy },
];

export function BuddyView() {
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

          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div
              className="buddy-sprite-stage"
              style={{
                ['--buddy-sprite' as string]: `url(${buddyWingSprite})`,
              }}
            >
              <div className="buddy-wing-sprite buddy-wing-sprite--hero buddy-wing-sprite--row-1" aria-label="Winged workspace buddy" />
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
              Winged Workspace Buddy
            </div>
          </div>

          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 24 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 11, fontWeight: 900, color: 'var(--heros-brand)', textTransform: 'uppercase', letterSpacing: '0.18em' }}>
                  Buddy System Mockup
                </span>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 12px #10b981' }} />
              </div>
              <h1 style={{ margin: 0, color: '#fff', fontSize: 44, lineHeight: 1, fontWeight: 900, letterSpacing: 0 }}>
                Muon is watching the workspace.
              </h1>
              <p style={{ margin: '18px 0 0', maxWidth: 560, color: 'rgba(255,255,255,0.62)', fontSize: 15, lineHeight: 1.7 }}>
                A deterministic companion that reacts to indexing, search, and workflow events. Rewards stay cosmetic, utility stays untouched.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {statCards.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div
                    key={stat.label}
                    style={{
                      padding: 14,
                      borderRadius: 14,
                      background: 'rgba(255,255,255,0.045)',
                      border: '1px solid rgba(255,255,255,0.07)',
                    }}
                  >
                    <Icon size={16} color="var(--heros-brand)" />
                    <div style={{ marginTop: 10, color: '#fff', fontSize: 18, fontWeight: 900 }}>{stat.value}</div>
                    <div style={{ marginTop: 2, color: 'rgba(255,255,255,0.36)', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>
                      {stat.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </motion.div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <section className="heros-glass-card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <PanelTitle icon={<Zap size={18} />} label="Reaction Hub" action="Live hooks" />
            {hooks.map((hook) => {
              const Icon = hook.icon;
              return (
                <div key={hook.label} style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  <div style={{ width: 38, height: 38, borderRadius: 12, background: 'rgba(204,76,43,0.12)', color: 'var(--heros-brand)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={17} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: '#fff', fontSize: 13, fontWeight: 800 }}>{hook.label}</div>
                    <div style={{ color: 'rgba(255,255,255,0.42)', fontSize: 12, marginTop: 3 }}>{hook.detail}</div>
                  </div>
                </div>
              );
            })}
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
        <section className="heros-glass-card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <PanelTitle icon={<Gift size={18} />} label="Workspace Expedition" action="Claim in 3h 42m" />
          <div style={{ padding: 18, borderRadius: 18, background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <div style={{ color: '#fff', fontWeight: 900, fontSize: 18 }}>Exploring workspace.db</div>
                <div style={{ color: 'rgba(255,255,255,0.42)', fontSize: 12, marginTop: 4 }}>47 embeddings, 3 rare insights found</div>
              </div>
              <Sparkles size={24} color="var(--heros-brand)" />
            </div>
            <div style={{ height: 10, borderRadius: 999, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
              <div style={{ width: '68%', height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, var(--heros-brand), #ffb199)' }} />
            </div>
            <button className="heros-btn-brand" style={{ marginTop: 16, width: '100%', height: 42, borderRadius: 12, fontSize: 13, fontWeight: 900 }}>
              Preview Claim Flow
            </button>
          </div>
        </section>

        <section className="heros-glass-card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <PanelTitle icon={<Trophy size={18} />} label="Milestones" action="3 active" />
          {milestones.map((milestone) => (
            <div key={milestone.title}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                <span style={{ color: '#fff', fontSize: 13, fontWeight: 800 }}>{milestone.title}</span>
                <span style={{ color: 'var(--heros-brand)', fontSize: 11, fontWeight: 900 }}>{Math.round(milestone.progress * 100)}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                <div style={{ width: `${milestone.progress * 100}%`, height: '100%', background: 'rgba(204,76,43,0.85)' }} />
              </div>
              <div style={{ marginTop: 6, color: 'rgba(255,255,255,0.36)', fontSize: 11 }}>{milestone.reward}</div>
            </div>
          ))}
        </section>

        <section className="heros-glass-card" style={{ padding: 22, flex: 1, minHeight: 260 }}>
          <PanelTitle icon={<Bot size={18} />} label="Buddy Codex" action="18 species" />
          <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {codex.map((entry) => (
              <div
                key={entry.species}
                style={{
                  padding: 14,
                  minHeight: 104,
                  borderRadius: 16,
                  background: entry.state === 'active' ? 'rgba(204,76,43,0.12)' : 'rgba(255,255,255,0.035)',
                  border: entry.state === 'active' ? '1px solid rgba(204,76,43,0.24)' : '1px solid rgba(255,255,255,0.06)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  opacity: entry.state === 'active' ? 1 : 0.55,
                }}
              >
                <div
                  style={
                    {
                      width: 58,
                      height: 42,
                      borderRadius: 12,
                      background: entry.state === 'active' ? 'rgba(204,76,43,0.12)' : 'rgba(255,255,255,0.05)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      ['--buddy-sprite' as string]: `url(${buddyWingSprite})`,
                    } as React.CSSProperties
                  }
                >
                  <div className={`buddy-wing-sprite buddy-wing-sprite--mini ${entry.animation}`} />
                </div>
                <div>
                  <div style={{ color: '#fff', fontSize: 13, fontWeight: 900 }}>{entry.species}</div>
                  <div style={{ color: 'rgba(255,255,255,0.36)', fontSize: 11, marginTop: 2 }}>{entry.rarity}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </aside>
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
