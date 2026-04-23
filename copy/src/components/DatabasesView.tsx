import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Database, Search, Plus, Filter, Share2, MoreHorizontal, 
  Layout, Columns, Calendar as CalendarIcon, Grid, List, 
  Clock, ChevronRight, Star, Tag, User, CheckCircle2, AlertCircle,
  ArrowUpRight, Download, Settings
} from 'lucide-react';
import { ScrollShadow } from './ScrollShadow';

type ViewType = 'table' | 'board' | 'calendar' | 'list';

export function DatabasesView() {
  const [selectedDb, setSelectedDb] = useState('helix-tasks');
  const [currentView, setCurrentView] = useState<ViewType>('table');

  const databases = [
    { id: 'pinned', label: 'Pinned', items: [
      { id: 'helix-tasks', label: 'Helix · tasks', count: 128 },
      { id: 'reading-queue', label: 'Reading queue', count: 41 },
      { id: 'contacts', label: 'Contacts', count: 312 },
    ]},
    { id: 'projects', label: 'Projects', items: [
      { id: 'incidents', label: 'Incidents', count: 47 },
      { id: 'releases', label: 'Releases', count: 82 },
    ]},
  ];

  const rows = [
    { id: 1, title: 'Schema freeze · 6 weeks', status: 'Active', owner: 'Priya', due: 'May 31', progress: 72, priority: 'P1', tags: ['infra', 'freeze'], note: 'Q3 Retro — Decisions' },
    { id: 2, title: 'Canary gate ≥ 25 promotion rule', status: 'Review', owner: 'Theo', due: 'Apr 24', progress: 88, priority: 'P0', tags: ['release'], note: 'Release gate — rationale' },
    { id: 3, title: 'P95 edge latency < 180 ms', status: 'Active', owner: 'Maya', due: 'May 10', progress: 34, priority: 'P0', tags: ['perf', 'platform'], note: 'Latency sprint notes' },
    { id: 4, title: 'Rewrite Helix runbook §4 · hotfix path', status: 'Draft', owner: 'Lio', due: '—', progress: 12, priority: 'P2', tags: ['docs'], note: 'Helix runbook v2' },
    { id: 5, title: 'Decide org-wide canary dashboard visibility', status: 'Blocked', owner: 'Theo', due: 'Apr 18', progress: 50, priority: 'P1', tags: ['comms'], note: 'Canary share · memo' },
    { id: 6, title: '36 → 48h soak window — validate with Maya', status: 'Review', owner: 'Maya', due: 'Apr 22', progress: 60, priority: 'P1', tags: ['release', 'soak'], note: 'Soak window proposal' },
    { id: 7, title: 'Telemetry panel: canary share vs p95', status: 'Draft', owner: 'Rei', due: 'May 3', progress: 22, priority: 'P2', tags: ['obs'], note: 'Observability · sketches' },
    { id: 8, title: 'Retro follow-ups: calendar reminders', status: 'Done', owner: 'Priya', due: 'Apr 20', progress: 100, priority: 'P2', tags: ['retro'], note: 'Q3 Retro — Decisions' },
  ];

  const columns = useMemo(() => [
    { id: 'backlog', title: 'Backlog', count: 9, color: 'rgba(255,255,255,0.35)' },
    { id: 'review', title: 'In Review', count: 3, color: '#f0d8d0' },
    { id: 'progress', title: 'In Progress', count: 4, color: '#9cf0c9' },
    { id: 'blocked', title: 'Blocked', count: 1, color: '#ff8a7a' },
    { id: 'done', title: 'Done', count: 12, color: '#bfd4ff' },
  ], []);

  const calendarEvents = {
    2:  [{type:'ev-review', title:'Canary memo draft'}],
    6:  [{type:'ev-done', title:'Vault re-index'}],
    10: [{type:'ev-done', title:'Runbook §2 ship'}],
    14: [{type:'ev-done', title:'Search indexes'}],
    18: [{type:'ev-blocked', title:'Dashboard visibility'}],
    20: [
      {type:'ev-active', title:'Retro follow-ups'},
      {type:'ev-review', title:'1:1 · Rei'},
      {type:'ev-active', title:'Canary share memo'},
    ],
    22: [{type:'ev-review', title:'Soak window review'}],
    24: [{type:'ev-review', title:'Gate rule · Theo'}],
    25: [{type:'ev-active', title:'Freeze compromise · Priya'}],
  };

  const renderTable = () => (
    <div className="tbl-scroll">
      <table className="db-table">
        <thead>
          <tr>
            <th style={{ width: 32 }}><input type="checkbox" /></th>
            <th style={{ minWidth: 320 }}><div className="th-inner"><Layout size={12}/> Title</div></th>
            <th><div className="th-inner"><CheckCircle2 size={12}/> Status</div></th>
            <th><div className="th-inner"><User size={12}/> Owner</div></th>
            <th><div className="th-inner"><CalendarIcon size={12}/> Due</div></th>
            <th><div className="th-inner"><Tag size={12}/> Tags</div></th>
            <th><div className="th-inner"><Clock size={12}/> Progress</div></th>
            <th><div className="th-inner">Priority</div></th>
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id}>
              <td><input type="checkbox" /></td>
              <td style={{ fontWeight: 500 }}>{row.title}</td>
              <td>
                <span className={`status-tag st-${row.status.toLowerCase()}`}>
                  <span className="dot"></span>{row.status}
                </span>
              </td>
              <td>
                <div className="owner-mini">
                  <span className="av">{row.owner[0]}</span>
                  {row.owner}
                </div>
              </td>
              <td style={{ fontFamily: 'monospace', opacity: 0.5, fontSize: '11px' }}>{row.due}</td>
              <td>
                {row.tags.map(t => <span key={t} className="tag-mini">{t}</span>)}
              </td>
              <td>
                <div className="prog-bar">
                  <div className="track"><div className="fill" style={{ width: `${row.progress}%` }}></div></div>
                  {row.progress}%
                </div>
              </td>
              <td style={{ fontFamily: 'monospace', opacity: 0.5 }}>{row.priority}</td>
              <td style={{ opacity: 0.2 }}>⋯</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: '12px 24px', color: 'rgba(255,255,255,0.2)', fontSize: '12px', cursor: 'pointer' }}>
        + New row
      </div>
    </div>
  );

  const renderBoard = () => (
    <div className="kanban-scroll">
      <div className="kanban-board">
        {columns.map(col => (
          <div key={col.id} className="kan-col">
            <div className="kan-col-head">
              <span className="title">
                <span className="dot" style={{ background: col.color }}></span>
                {col.title}
              </span>
              <span className="count">{col.count}</span>
              <button className="icon-btn-xs"><Plus size={12}/></button>
            </div>
            {rows.filter(r => (col.id === 'progress' && r.status === 'Active') || (col.id === 'review' && r.status === 'Review') || (col.id === 'blocked' && r.status === 'Blocked') || (col.id === 'done' && r.status === 'Done')).map(row => (
              <div key={row.id} className="kan-card">
                <div className="kc-title">{row.title}</div>
                <div className="kc-meta">
                  <div style={{ display: 'flex', gap: 4 }}>
                    {row.tags.map(t => <span key={t} className="tag-mini">{t}</span>)}
                  </div>
                  <span className="kc-due">{row.due}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="owner-mini">
                    <span className="av" style={{ width: 16, height: 16, fontSize: 8 }}>{row.owner[0]}</span>
                    <span style={{ fontSize: 10 }}>{row.owner}</span>
                  </div>
                  <span className="tag-mini" style={{ margin: 0, opacity: 0.6 }}>{row.priority}</span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  const renderCalendar = () => {
    const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const firstDow = 3; // April 2026 starts on Wed
    const daysInMonth = 30;
    const daysPrev = 31;

    const cells = [];
    for (let i = 0; i < firstDow; i++) {
      cells.push({ num: daysPrev - firstDow + i + 1, muted: true });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      cells.push({ num: i, muted: false, isToday: i === 20 });
    }
    const total = cells.length;
    const trailing = (7 - (total % 7)) % 7;
    for (let i = 1; i <= trailing; i++) {
      cells.push({ num: i, muted: true });
    }

    return (
      <div className="dbcal-scroll">
        <div className="dbcal-nav">
          <div className="month">April 2026</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="heros-btn" style={{ padding: '4px 12px', fontSize: '11px' }}>Today</button>
            <button className="icon-btn-xs"><ChevronRight size={14} style={{ transform: 'rotate(180deg)' }}/></button>
            <button className="icon-btn-xs"><ChevronRight size={14}/></button>
          </div>
        </div>
        <div className="dbcal-grid">
          {dows.map(d => <div key={d} className="dbcal-dow">{d}</div>)}
          {cells.map((cell, idx) => (
            <div key={idx} className={`dbcal-cell ${cell.muted ? 'muted' : ''} ${cell.isToday ? 'today' : ''}`}>
              <span className="dbcal-daynum">{cell.num}</span>
              {!cell.muted && calendarEvents[cell.num as keyof typeof calendarEvents]?.map((ev, ei) => (
                <div key={ei} className={`dbcal-event ${ev.type}`}>
                  {ev.title}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderList = () => (
    <div className="list-view">
      {rows.map(row => (
        <div key={row.id} className="list-row">
          <div className="icon">
            <Layout size={16} />
          </div>
          <div className="content">
            <div className="title">{row.title}</div>
            <div className="subtitle">
              {row.owner} · {row.due} · {row.tags.join(', ')}
            </div>
          </div>
          <div className="meta">
            <span className={`status-tag st-${row.status.toLowerCase()}`}>
              <span className="dot"></span>{row.status}
            </span>
            <div style={{ width: 80 }}>
               <div className="prog-bar" style={{ gap: 4 }}>
                  <div className="track"><div className="fill" style={{ width: `${row.progress}%` }}></div></div>
                </div>
            </div>
            <ChevronRight size={14} style={{ opacity: 0.2 }} />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="db-layout">
      {/* Sidebar */}
      <section className="heros-glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="heros-input-wrapper" style={{ padding: '8px 12px' }}>
          <Search size={14} className="heros-icon-animate-focus" style={{ color: 'rgba(255,255,255,0.2)', marginRight: 10 }} />
          <input 
            placeholder="Find database..." 
            style={{ fontSize: '12px' }}
          />
        </div>

        <ScrollShadow style={{ flex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 5 }}>
            {databases.map(group => (
              <div key={group.id}>
                <div style={{ fontSize: '10px', fontWeight: 800, color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 8, paddingLeft: 8 }}>{group.label}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {group.items.map(item => (
                    <div 
                      key={item.id}
                      onClick={() => setSelectedDb(item.id)}
                      style={{ 
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, cursor: 'pointer',
                        background: selectedDb === item.id ? 'rgba(255,255,255,0.05)' : 'transparent',
                        color: selectedDb === item.id ? '#fff' : 'rgba(255,255,255,0.4)',
                        fontSize: '13px'
                      }}
                      className="hover-bg"
                    >
                      <Database size={14} color={selectedDb === item.id ? 'var(--heros-brand)' : 'currentColor'} />
                      <span style={{ flex: 1 }}>{item.label}</span>
                      <span style={{ fontSize: '10px', opacity: 0.5 }}>{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollShadow>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="heros-btn" style={{ width: '100%', padding: '10px', fontSize: '12px' }}>
            <Plus size={14} /> New Database
          </button>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 8px', color: 'rgba(255,255,255,0.2)', fontSize: '10px', fontFamily: 'monospace' }}>
            <span>14 DATABASES</span>
            <Settings size={12} style={{ cursor: 'pointer' }} />
          </div>
        </div>
      </section>

      {/* Main Area */}
      <section className="heros-glass-card db-stage">
        <div className="db-chrome">
          <div className="db-title-row">
            <div>
              <h1>
                <span className="db-icn"><Database size={15} /></span>
                Helix · tasks
              </h1>
              <div className="db-subtitle">128 ROWS · LINKED TO PROJECTS/HELIX · LAST SYNCED 2M AGO</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="status-tag st-active" style={{ height: 24, borderRadius: 12 }}><span className="dot"></span>Live</span>
              <button className="icon-btn"><Filter size={18} /></button>
              <button className="icon-btn"><Share2 size={18} /></button>
              <button className="icon-btn"><MoreHorizontal size={18} /></button>
            </div>
          </div>

          <div className="db-views">
            {(['table', 'board', 'calendar', 'list'] as ViewType[]).map((view) => (
              <button 
                key={view} 
                className={`db-view ${currentView === view ? 'active' : ''}`}
                onClick={() => setCurrentView(view)}
              >
                {view === 'table' && <Layout size={13} />}
                {view === 'board' && <Columns size={13} />}
                {view === 'calendar' && <CalendarIcon size={13} />}
                {view === 'list' && <List size={13} />}
                {view.charAt(0).toUpperCase() + view.slice(1)}
              </button>
            ))}
            <button className="db-view">
              <Grid size={13} />
              Gallery
            </button>
            <button className="db-view">
              <Clock size={13} />
              Timeline
            </button>
            <button className="db-view-add">
              <Plus size={11} /> Add view
            </button>
          </div>
        </div>

        <div className="db-subtools">
          <button className="db-pill active">
            <Filter size={11} />
            Status: not Done · Review
          </button>
          <button className="db-pill">
            <Layout size={11} />
            Sort · Due ↑
          </button>
          <button className="db-pill">
            <Columns size={11} />
            Group · Status
          </button>
          <button className="db-pill">
            <Grid size={11} />
            Hide · 2 props
          </button>
          <div style={{ flex: 1 }}></div>
          <div className="heros-input-wrapper" style={{ width: 180, padding: '4px 10px' }}>
             <Search size={12} style={{ color: 'rgba(255,255,255,0.2)', marginRight: 8 }} />
             <input placeholder="Search rows..." style={{ fontSize: '11px' }} />
          </div>
          <button className="heros-btn heros-btn-brand" style={{ padding: '6px 12px', fontSize: '11px' }}>
            <Plus size={14} /> New
          </button>
        </div>

        <div className="db-body">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentView}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
            >
              {currentView === 'table' && renderTable()}
              {currentView === 'board' && renderBoard()}
              {currentView === 'calendar' && renderCalendar()}
              {currentView === 'list' && renderList()}
            </motion.div>
          </AnimatePresence>
        </div>

        <div style={{ padding: '12px 24px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.1)' }}>
          <div className="prog-bar" style={{ gap: 12 }}>
            <span>COUNT · 128</span>
            <span>AVG PROGRESS · 54%</span>
            <span>OVERDUE · <span style={{ color: '#ffb4aa' }}>2</span></span>
          </div>
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>
            1 SELECTED
          </div>
        </div>
      </section>
    </div>
  );
}
