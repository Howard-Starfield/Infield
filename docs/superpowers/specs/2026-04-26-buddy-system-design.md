# Buddy System Design — AFK Arena × Tamagotchi × D&D

**Date:** 2026-04-26
**Status:** B1 implemented (engine + MVP loop). B2/B3 deferred.
**Topic:** Wire the dormant Buddy surface into a full idle-game companion system

---

## 1. Summary

Turn the existing static `BuddyView` mockup into a fully wired idle-game companion that pulls users back to the app on a daily rhythm without compromising the project's "Ethical Loop" stance. The system layers three game-design idioms:

- **AFK Arena** — capped passive points + activity bonuses → claim chest → loot drop with rarity rolls; collect a roster of buddies; equip gear; Team Power affects loot quality
- **Tamagotchi** — global draggable companion overlay with click-reactive particle/transform combos; right-click context menu
- **D&D** — milestone unlocks rendered as theatrical RPG-style achievement reveals (parchment scroll, rune circle, D20 nat-20, character stat block)

All rewards are cosmetic. No feature gating. No paid card draws. Settings expose a global off switch and a configurable cap.

---

## 2. Goals & Non-Goals

### Goals

- Make the buddy a **persistent, charming companion** across every page in the app (global overlay, draggable, right-click menu)
- Create a **return-to-app rhythm** via 8h capped chest with overflow activity points
- Reward **real workspace activity** — every primary feature (notes, voice memos, system audio, URL imports, databases, search) emits buddy points
- Provide **collection depth** — 6 buddy species + ~40 gear pieces + shiny variants — without combat content treadmill
- Keep all UI within the existing **HerOS design system**; zero new raster art
- Match the project's stated **Ethical Loop** principles — every buddy is a trophy of real work; cap can be turned off in Settings

### Non-Goals (v1)

- Real auto-battler combat (HP bars, win/lose, stage progression)
- Audio reactions / sound effects
- Multiplayer / leaderboards / trading
- Visual rendering of equipped gear *on* the buddy sprite (no art budget)
- Buddy species beyond the 6 already in the sprite sheet
- Codex slots 7–18 (locked silhouettes only — future content)
- Per-buddy custom names
- Vault file representation of buddy state (cosmetic state, not user data)

---

## 3. Locked Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Points source | Hybrid: wall-clock drip + activity bursts | Wall-clock = AFK pull; activity = engaged users always benefit |
| Cap | 8h hard, configurable in Settings (4h / 6h / 8h / 12h / 24h / Off) | Workday rhythm + escape valve |
| Activity overflow | Always counts (never punished) | "B1" — pro-engagement stance |
| Combat model | Idle stat-multiplier; visual battle scene is cosmetic | Keeps scope sane, captures the AFK Arena dopamine without combat content |
| Click reactions | Particle/emoji + CSS transforms over flap loop | Variety without new sprite frames |
| Buddy presence | Global draggable overlay + right-click menu | Tamagotchi feel |
| Loot model | Loot-box chest for gear; **milestone unlocks** for buddies | Buddies are commemorative trophies of real work |
| Gear slots | 3 — Hat / Aura / Charm (with Charm/Power/Speed bias respectively) | Mix-and-match becomes a real choice |
| Enemy art | Silhouetted doodle-blobs in `--heros-*` palette | Reuses existing visual language, zero asset budget |
| Buddy level | **Uncapped**, log-curve stats, active-buddy-only XP gain | Always visible progress, never overflow |
| Shiny chance | Independent rolls — 1/512 per gear, 1/256 per buddy unlock | Pokémon-style rare flex, dopamine-on-demand |
| Milestone celebration | D&D-themed reveal modal (distinct from chest reveal) | Different rhythm, different occasion |
| State storage | New SQLite tables (project pattern: vault = user data, SQLite = app state) | Buddy is cosmetic app state |
| Activity hooks | Frontend `CustomEvent` bus → debounced `record_activity_batch` | No backend coupling per surface |
| Battle scene | Pure CSS transforms over sprite layers | Zero new dependencies |
| Team Power effect | **Loot quality** (not fill rate) — cap stays 8h regardless | Avoids "grind-harder-to-claim-5×/day" treadmill |

---

## 4. Data Model

### 4.1 SQLite tables (new migration)

```sql
-- Singleton — live AFK state
CREATE TABLE buddy_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  points_balance REAL NOT NULL DEFAULT 0,        -- 0..cap_total
  points_overflow REAL NOT NULL DEFAULT 0,       -- unbounded (B1)
  cap_total REAL NOT NULL DEFAULT 1000.0,        -- 8h drip @ ~0.0347 pt/sec
  last_drip_ms INTEGER NOT NULL,                 -- lazy-compute cursor (no setInterval)
  last_claim_ms INTEGER,
  active_buddy_id TEXT NOT NULL,                 -- references buddy_unlocks.buddy_id
  overlay_x REAL NOT NULL DEFAULT 0.96,           -- viewport fraction
  overlay_y REAL NOT NULL DEFAULT 0.92,
  overlay_anchor TEXT NOT NULL DEFAULT 'br',     -- tl|tr|bl|br for resize stability
  overlay_hidden INTEGER NOT NULL DEFAULT 0,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE buddy_unlocks (
  buddy_id TEXT PRIMARY KEY,                     -- 'scout-wings', 'hover-wings', ...
  unlocked_at_ms INTEGER NOT NULL,
  xp_total INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,              -- cached; derived from xp_total
  shiny INTEGER NOT NULL DEFAULT 0,              -- 0/1
  equipped_hat_id TEXT,                          -- nullable FK to buddy_inventory.gear_id
  equipped_aura_id TEXT,
  equipped_charm_id TEXT
);

CREATE TABLE buddy_inventory (
  gear_id TEXT PRIMARY KEY,                      -- UUID v4
  slot TEXT NOT NULL CHECK (slot IN ('hat','aura','charm')),
  species TEXT NOT NULL,                         -- 'top-hat', 'amber-aura', etc.
  rarity TEXT NOT NULL CHECK (rarity IN ('common','rare','epic','legendary')),
  shiny INTEGER NOT NULL DEFAULT 0,              -- 0/1
  power_bonus INTEGER NOT NULL,
  speed_bonus INTEGER NOT NULL,
  charm_bonus INTEGER NOT NULL,
  acquired_at_ms INTEGER NOT NULL
);

CREATE TABLE buddy_milestones (
  milestone_id TEXT PRIMARY KEY,                 -- 'embeddings-100', 'notes-50', ...
  progress INTEGER NOT NULL DEFAULT 0,
  target INTEGER NOT NULL,
  completed_at_ms INTEGER,                       -- null until done
  reward_buddy_id TEXT                           -- nullable; null = badge-only milestone
);

CREATE TABLE buddy_claim_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claimed_at_ms INTEGER NOT NULL,
  points_claimed REAL NOT NULL,
  gear_dropped TEXT NOT NULL,                    -- JSON array of gear_ids
  xp_awarded INTEGER NOT NULL
);
```

5 tables, not 1: singleton state / owned-buddies / owned-gear / milestone progress / audit log have wildly different shapes and lifecycles. Collapsing into a kv blob would lose query-ability ("how many legendaries do I have?", "claim history for the last 7 days?").

### 4.2 Lazy point computation (no background timer)

Don't run a background `setInterval` to tick points. Instead, on every read of `buddy_state`, compute:

```
elapsed_sec        = max(0, (now_ms - last_drip_ms) / 1000.0)   // clamp guards against clock-rewind
drip_rate_per_sec  = cap_total / (8 × 60 × 60)                  // ≈ 0.0347 pt/sec at default cap
points_balance_now = min(cap_total, points_balance_stored + elapsed_sec × drip_rate_per_sec)
```

The `max(0, ...)` clamp is load-bearing — it covers the system-clock-rewind case from §10. Persist `last_drip_ms` only on writes (claim, cap change, app close). The displayed progress bar runs `requestAnimationFrame` **only while BuddyView or the overlay is mounted** — zero cost when buddy UI is offscreen.

### 4.3 Frontend `BuddyContext` shape (new file: `src/contexts/BuddyContext.tsx`)

```typescript
type BuddyState = {
  points: { balance: number; overflow: number; cap: number; pctFull: number; secondsToCap: number };
  active: BuddyUnlock;
  roster: BuddyUnlock[];
  inventory: GearItem[];
  milestones: Milestone[];
  overlay: { x: number; y: number; anchor: 'tl' | 'tr' | 'bl' | 'br'; hidden: boolean };
  teamPower: number;                            // derived
  recentEvents: ActivityEvent[];                // tail for Activity Log
};

type BuddyActions = {
  claim(): Promise<ClaimResult>;
  switchActiveBuddy(id: string): Promise<void>;
  equipGear(gearId: string, slot: GearSlot): Promise<void>;
  unequipGear(slot: GearSlot): Promise<void>;
  setOverlayPosition(x: number, y: number, anchor: Anchor): Promise<void>;
  setOverlayHidden(hidden: boolean): Promise<void>;
  setCapTotal(cap: number): Promise<void>;
  refresh(): Promise<void>;                     // re-pulls full state
};
```

Lives next to `VaultContext` in `src/contexts/`. Single source of truth for both `BuddyView` page and the global `CartoonBuddy` overlay.

### 4.4 Activity event vocabulary

Frontend `window.dispatchEvent(new CustomEvent('buddy:note-saved'))` from each surface. `BuddyContext` listens, debounces 5s, flushes via one Tauri command.

| Event | Surface | Weight (pt + XP) |
|---|---|---|
| `buddy:note-saved` | MarkdownEditor autosave | 5 |
| `buddy:note-created` | `create_node` document | 25 |
| `buddy:voice-memo-recorded` | Mic session end | 50 |
| `buddy:system-audio-segment` | One transcribed paragraph | 10 |
| `buddy:url-imported` | Import-URL flow completes | 40 |
| `buddy:database-created` | `create_database` returns | 60 |
| `buddy:database-row-created` | `create_row` returns | 8 |
| `buddy:search-clicked` | Search result clicked | 5 |
| `buddy:wikilink-followed` | `node://` link click | 3 |
| `buddy:milestone-tick` | Backend → frontend (any progress update) | 0 (stat only) |

Each weight = both `points_overflow += weight` AND `active_buddy.xp_total += weight`. Daily heavy-user ceiling ~1500–2500 pt — chest fills in <8h for active users (good — they get *more* claims per day, B1 honored).

### 4.5 Tauri commands (new file: `src-tauri/src/commands/buddy.rs`)

```
get_buddy_state() -> BuddyState
claim_chest() -> ClaimResult
switch_active_buddy(buddy_id: String)
equip_gear(gear_id: String, slot: String)
unequip_gear(slot: String)
set_overlay_position(x: f64, y: f64, anchor: String)
set_overlay_hidden(hidden: bool)
set_cap_total(cap: f64)
record_activity_batch(events: Vec<ActivityEvent>)
tick_milestone(milestone_id: String, delta: i64)  // backend hooks call directly
```

All snake_case, return `Result<T, String>`, registered in `lib.rs` per project convention.

### 4.6 Backend milestone hooks

Some milestones can't be detected from frontend events alone. Backend hooks call `tick_milestone()` directly:

| Milestone | Hook location |
|---|---|
| `embeddings-100`, `embeddings-1000` | `embedding_worker.rs` after each successful index batch |
| `streak-N-days` | `lib.rs` boot sequence — once per local calendar day |

Frontend-detectable milestones (`notes-50`, `voice-memos-10`, `database-rows-100`, `searches-30`) are tracked by counting events in `BuddyContext` and calling `tick_milestone()` when thresholds are crossed.

---

## 5. UI Surfaces & Interactions

### 5.1 BuddyView page (the command center)

The existing mockup at `src/components/BuddyView.tsx` survives almost wholesale — it's already conceptually right. Structural changes:

- **Hero card becomes the battle scene.** The 280px sprite-stage on the left of the hero card stays. The right pane gains a horizontal **stage strip** — active buddy left, parallax doodle-blob landscape scrolling slowly right-to-left, current enemy fading in/out on the right. Stat cards drop below the strip.
- **Buddy Codex grid splits.** Right column now has two panels: an unlocked **Roster** (2-up grid, glowing entries, click to set active) and a locked **Codex** (smaller cards, dimmed silhouettes with unlock-condition captions, click to see milestone progress).
- **New panel — Gear Inventory.** Sits below the (renamed) Activity Log on the left. 3-row layout (Hat / Aura / Charm) with horizontal scroll of owned pieces per slot. Tap to equip; equipped piece shows brand-orange ring. Empty slots show `<EmptyState>`.
- **Reaction Hub becomes Activity Log.** Same panel position, but the four hardcoded "hooks" become a live tail of the last ~10 activity events with their point/XP awards.
- **Workspace Expedition card stays.** "Preview Claim Flow" button becomes the real claim CTA — disabled when `points_balance < 50`, animated when capped, opens `<ChestRevealModal>`.
- **Milestones panel stays**, fed live from `buddy_milestones`.
- **Ethical Loop panel stays unchanged.**

### 5.2 Floating overlay (`CartoonBuddy` rewrite)

Current implementation: `position: fixed; bottom: 15px; right: 40px`, hardcoded path `/buddy-sprite.png`, hover-only. Full rewrite:

```typescript
function CartoonBuddy() {
  const { state, actions } = useBuddyContext();
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [contextMenu, setContextMenu] = useState<{x: number, y: number} | null>(null);

  const { left, top } = resolveAnchoredPosition(state.overlay, viewport);
  const animationClass = `buddy-wing-sprite--row-${state.active.spriteRow}`;
  if (state.overlay.hidden) return null;

  return (
    <>
      <div ref={ref}
           className={`buddy-overlay buddy-wing-sprite ${animationClass} ${state.active.shiny ? 'buddy-overlay--shiny' : ''}`}
           style={{ left, top, '--buddy-sprite': `url(${spriteUrl})` }}
           onPointerDown={handlePointerDown}
           onContextMenu={handleContextMenu}
           onClick={!dragging ? handleClick : undefined}>
        <ParticleLayer reactionQueue={reactions} />
        {state.active.shiny && <SparkleAura />}
      </div>
      {contextMenu && <BuddyContextMenu pos={contextMenu} onClose={() => setContextMenu(null)} />}
    </>
  );
}
```

#### Drag mechanics

- `pointerdown` → record `{startX, startY, originLeft, originTop}`, call `setPointerCapture`
- `pointermove` → update `transform: translate(...)` directly via ref (no React re-render per frame)
- `pointerup` → measure final position, find nearest of 4 anchor corners, convert to viewport-fractional coords, call `setOverlayPosition(x, y, anchor)`
- Anchor-relative storage means buddy stays in the same visual corner across window resizes
- **Boundary clamp**: 16px margin from edges, 48px margin from top (avoids macOS traffic-light buttons)
- **Drag vs click discrimination**: pointer movement >5px between `pointerdown` and `pointerup` marks the gesture as drag; click handler is suppressed in that case

#### Right-click context menu (`<BuddyContextMenu>`)

Uses `<HerOSPanel>` styling at the click position.

| Item | Action |
|---|---|
| `▸ Switch buddy` | Submenu — list of unlocked roster, current marked with brand-orange dot |
| `Hide buddy` | `setOverlayHidden(true)` — re-show via Settings |
| `Open Buddy command center` | `setCurrentPage('buddy')` |
| `Reset position` | Reset to default `{x:0.96, y:0.92, anchor:'br'}` |
| `─── (placeholder for future items)` | Disabled stub for "Mute reactions", "Costume picker" etc. |

### 5.3 Click reaction system

Two-layer: a **reaction picker** (in `BuddyContext`) and a `<ParticlePop>` component.

```typescript
type ClickHistory = { lastClickMs: number; streak: number; recent: ReactionId[] };

function pickReaction(history: ClickHistory, now: number): Reaction {
  const dt = now - history.lastClickMs;
  if (dt > 500) history.streak = 1; else history.streak += 1;

  const bucket =
    history.streak === 1 ? 'firstPet' :
    history.streak === 2 ? 'jiggle' :
    history.streak === 3 ? 'grumble' :
                            'overstim';
  const pool = REACTIONS[bucket].filter(r => !history.recent.includes(r.id));
  return pickRandom(pool.length ? pool : REACTIONS[bucket]);
}
```

#### Reaction catalog (start with these; expand later)

| Trigger | Particles | Transform |
|---|---|---|
| 1st pet (cold) | ❤ pop + faint hearts trail | squish-bounce (scaleY 0.85 → 1.1 → 1) |
| 1st pet (rapid) | 💕💕 trail | scaleX wiggle |
| 2nd in <500ms | ✨ burst | spin-jiggle (rotate ±8°) |
| 3rd rapid | 😖 above head | shake (translateX ±4px ×4) |
| 4th+ rapid | ❓❓ + comic glare | freeze (scale 1.05, 800ms) |
| Idle 30s | 💤 above head | slow bob (translateY +6/0 over 3s) |
| Idle 120s | Z Z Z | tilt (rotate -6°), flap slows to 50% |
| Chest at cap | 🎁 + brand-orange glow | bounce-bounce (translateY -8 -16 -8 0) |
| Activity bonus | 👍 + tiny ✨ | small jump (translateY -10 → 0) |
| On claim | 🎉 + multi-particle spray | spin (rotate 360°) + scale-pulse |
| Milestone done | 🏆 + amber glow | float (translateY -16, fade-in glow ring) |

#### `<ParticlePop>`

Transient absolutely-positioned element above the sprite. Receives `{ particle: '❤', spread: number, ttl: number }` and self-removes after `ttl`. Uses Motion's `<AnimatePresence>` for entry/exit; pure CSS for travel. Up to 6 stacked at once before older ones get culled.

Transform combos apply to the **sprite container** (not the sprite background-position, which is owned by the flap animation): `transform: var(--reaction-transform, none)` with a CSS variable swap that Motion drives. The flap keeps running underneath.

### 5.4 Battle scene technique

Pure CSS + Motion. Three layers, all `position: absolute`:

1. **Background** — slow horizontal `translateX` loop (8s, linear, infinite) of an SVG with 3-4 doodle-blob silhouettes. Parallax: foreground blobs scroll faster than back ones. Reuses `--heros-brand-*` palette.
2. **Active buddy** — anchored bottom-left of strip. Idle = current flap loop. "Lunge" every ~3s = `translateX(+24px)` over 200ms then back. "Hit reaction" = brief red tint (`filter: hue-rotate(-30deg) brightness(1.2)` for 150ms) + `translateX(-8px)` recoil.
3. **Enemy** — one at a time. Spawns `translateX(+80px) opacity:0` → slides in. After ~5s of trading lunges, fades out and next enemy spawns. Enemy = single SVG doodle-blob (3-4 archetypes randomly cycled).

State machine for the encounter loop:

```
spawn → idle → buddy-lunge → enemy-hit → enemy-recovery
     → enemy-lunge → buddy-hit → buddy-recovery → ...
After ~5 cycles → enemy-defeat → spawn next enemy.
```

Runs on a single `setInterval(800ms)` **only while BuddyView is visible** (paused via `IntersectionObserver`). Zero cost when not viewing.

The combat is decorative — the actual rate that points fill, gear drops, XP accumulates is governed entirely by `team_power × time` from the data model.

### 5.5 Chest reveal modal (`<ChestRevealModal>`)

Trigger → `claim_chest()` Tauri command:

1. Backend rolls drops, awards XP, persists, returns `ClaimResult`
2. Frontend opens modal:
   - Doodle-blob chest SVG shakes 3× → bursts with brand-orange flash
   - Item cards arc out one at a time, 200ms apart, rarity-tinted glow (common = white, rare = blue, epic = violet, legendary = amber)
   - **Shiny gear**: extra screen-shake, gold confetti, longer hold (3s vs 1s), ★ badge on card
   - XP awarded shown as floating "+XP" text rising from active buddy sprite in the modal
   - Each card has "Equip" button (auto-equips if matching slot is empty)
3. Close → `BuddyContext.refresh()` — chest bar resets, overflow remainder carries over

Auto-close after 8s, or "Done" button. Dismissable mid-animation.

### 5.6 Milestone celebration modal (`<MilestoneCelebrationModal>`) — D&D themed

**Trigger**: any `tick_milestone()` call that flips `progress < target → progress >= target` AND has a non-null reward.

| t | Event |
|---|---|
| 0.0s | Page dims; parchment-cream vignette fades in |
| 0.3s | Rune circle SVG draws outward via `stroke-dashoffset` (brand-orange glow) |
| 1.0s | D20 die SVG drops + bounces, settles on **20** (nat 20 — milestones always crit) |
| 1.5s | Parchment scroll unfurls L→R; "ACHIEVEMENT UNLOCKED" reveals letter-by-letter via `clip-path` ink-spread |
| 2.5s | New buddy materializes inside rune circle with sparkle burst |
| 3.5s | D&D-style stat block fades in: `POWER 8 / SPEED 14 / CHARM 8` + flavor text |
| 5.0s | "Set as active buddy" + "Continue" buttons fade in |

**Shiny milestone unlock** = same sequence + D20 reads **✦20**, double concentric rune ring, sprite materializes hue-rotated with permanent sparkle aura, parchment reads "RARE ACHIEVEMENT — SHINY VARIANT", held 2× longer.

Click anywhere to skip. Default action = "Continue".

#### Visual ingredients (zero new raster art)

- Parchment background: SVG `feTurbulence` noise filter + radial brown vignette
- Rune circle: SVG `<circle>` + 6 inscribed `lucide-react` icons as runes (`Sparkles`/`Star`/`Crown`/`Shield`/`Zap`/`Heart`)
- D20: SVG icosahedron, CSS `transform-style: preserve-3d` for the bounce
- Calligraphy: existing app font + letter-spacing + clip-path. Optional `Cinzel` via `@fontsource` (~30KB local) if we want to splurge — out of scope for v1, can be added in polish phase

#### Distinct from chest reveal — on purpose

| Aspect | Chest Reveal (every claim) | Milestone Celebration (D&D) |
|---|---|---|
| Frequency | ~3×/day | ~1×/week |
| Aesthetic | Loot box, brand-orange flash, item arc-out | Parchment, ink calligraphy, rune circle, D20 |
| Length | 8s auto-close | 6s, click-to-skip, "Continue" CTA |

---

## 6. Loot Mechanics

### 6.1 Drop algorithm

```rust
fn roll_chest(state: &BuddyState) -> ClaimResult {
  let n = weighted_pick(&[(1, 0.6), (2, 0.3), (3, 0.1)]);
  let activity_bonus = (state.points_overflow / 100.0).floor().min(20.0) as i32;
  let team_bonus    = (state.team_power.log10() * 8.0).floor().clamp(0.0, 30.0) as i32;
  let total_bonus   = (activity_bonus + team_bonus).min(50);

  // Base table: Common 70% / Rare 22% / Epic 7% / Legendary 1%
  // Shift Common down by 3×total_bonus%, distribute upward proportionally
  let table = shift_rarity_table([0.70, 0.22, 0.07, 0.01], total_bonus);

  let mut drops = vec![];
  for _ in 0..n {
    let rarity = weighted_pick(&table);
    let slot   = pick_one(&["hat", "aura", "charm"]);
    let shiny  = rng.gen_range(0..512) == 0;          // 1/512 per piece
    drops.push(generate_gear(rarity, slot, shiny));
  }
  // persist + return
}
```

### 6.2 Gear stat generation

Per-rarity stat budget split across `power / speed / charm` with per-slot bias:

| Rarity | Stat budget | Variance |
|---|---|---|
| Common | 10 | ±20% |
| Rare | 25 | ±15% |
| Epic | 60 | ±10% |
| Legendary | 150 | ±5% |

Per-slot bias on the budget allocation:

- **Hat** → +50% allocation weight to **Charm**
- **Aura** → +50% to **Power**
- **Charm** → +50% to **Speed**

Example Legendary Hat: budget 148 → power 38, speed 35, charm 75. Hats are showy, Auras are buff, Charms are quick — mix-and-match across all 3 slots becomes a real choice.

Shiny gear has **identical stats** to non-shiny; the only difference is the cosmetic flag and visual treatment.

### 6.3 Level / XP curve (uncapped)

```
xp_to_next(level) = floor(100 × level^1.4)
buddy_stat        = base_stat × log2(level + 1)
```

| Level | XP to next | Cumulative | Stat multiplier |
|---|---|---|---|
| 1 → 2 | 100 | 100 | ×1.0 |
| 5 → 6 | 1,148 | ~3,500 | ×2.58 |
| 10 → 11 | 2,511 | ~12,800 | ×3.46 |
| 20 → 21 | 6,062 | ~50,000 | ×4.39 |
| 50 → 51 | 22,907 | ~390,000 | ×5.67 |
| 100 → 101 | 63,095 | ~1.7M | ×6.66 |
| 1,000 | — | — | ×9.97 |
| 10,000 | — | — | ×13.29 |

Realistic active-user trajectory (~2,000 XP/day): Day 1 ≈ L4 · Week 1 ≈ L13 · Month 1 ≈ L30 · Year 1 ≈ L80. Always visible progress, never plateaus, never trivial. Bounded log-growth on stats prevents Team Power overflow.

### 6.4 Buddy base stats per species

| Buddy | Power | Speed | Charm | Flavor |
|---|---|---|---|---|
| Scout Wings *(starter)* | 10 | 10 | 10 | Balanced |
| Hover Wings | 8 | 14 | 8 | Speed |
| Glide Wings | 14 | 8 | 8 | Power |
| Lookout Wings | 8 | 8 | 14 | Charm |
| Sleepy Wings | 10 | 12 | 8 | Soft + quick |
| Patrol Wings | 12 | 12 | 6 | Power + Speed |

### 6.5 Team Power formula

```
team_power = Σ_unlocked_buddies(
   (buddy.power + buddy.speed + buddy.charm) × log2(buddy.level + 1)
   + Σ equipped_gear.stats
)

loot_quality_bonus_pct = clamp(0, 30, log10(team_power + 1) × 8)
```

Live recomputed in `BuddyContext` whenever roster/gear/level mutates. Renders on BuddyView as a single big number with a sparkline of last-30-days progress (deferred — sparkline data not collected in v1; show flat for now).

### 6.6 Shiny system

Two independent rolls, both flat rate:

| Roll | Rate | When it fires |
|---|---|---|
| Shiny gear | 1/512 (~0.2%) per gear piece | Every gear drop in a chest claim |
| Shiny buddy | 1/256 (~0.4%) per unlock | First time a buddy unlocks from milestone (one-shot) |

Flat rate, independent of rarity tier and Team Power. A common shiny is rarer than a legendary non-shiny — the whole point of the Pokémon model.

**Visual treatment** (zero new raster art):

- Sprite gets `filter: hue-rotate(NNNdeg) saturate(1.3) brightness(1.05)` — per-species hue per `SHINY_HUE` map (e.g. Scout→golden, Hover→cyan, Glide→magenta, Lookout→silver, Sleepy→pink, Patrol→teal)
- Always-on `<SparkleAura>` particle ring (4 tiny ✦ orbiting on a 3s loop)
- ★ badge in inventory cards, roster cards, chest reveal cards
- ChestRevealModal goes celebration mode for shinies
- MilestoneCelebrationModal goes super-celebration mode for shiny unlocks

---

## 7. Milestone Catalog (v1)

Six buddies — Scout Wings is starter (pre-unlocked). Five milestone unlocks:

| Buddy | Milestone ID | Threshold | Source |
|---|---|---|---|
| Hover Wings | `embeddings-100` | 100 embeddings indexed | Backend hook in `embedding_worker.rs` |
| Glide Wings | `notes-50` | 50 notes saved | `buddy:note-saved` event count |
| Lookout Wings | `voice-memos-10` | 10 voice memos recorded | `buddy:voice-memo-recorded` count |
| Sleepy Wings | `streak-7-days` | 7 distinct calendar days with app open | Boot-time tick (one per local day) |
| Patrol Wings | `database-rows-100` | 100 database rows created | `buddy:database-row-created` count |

Plus 3 non-buddy milestones (matching existing mock copy in [BuddyView.tsx:35-39](src/components/BuddyView.tsx)):

- `embeddings-1000` → one-time bonus 5× chest (ships v1, no D&D modal — uses regular chest reveal)
- `streak-30-days` → "Speech bubble theme" cosmetic (badge in v1, theme deferred post-v1)
- `searches-30` → "Sharp Eyes" badge (badge in v1)

12 codex slots beyond the 6 species stay as `???` silhouettes with cryptic hints — future content, not v1.

---

## 8. Settings Integration

New "Buddy" section in `SettingsView` (when W5 wires Settings; until then, hidden but Tauri commands work):

| Setting | Type | Default | Effect |
|---|---|---|---|
| Cap interval | Select (4h / 6h / 8h / 12h / 24h / Off) | 8h | Recomputes `cap_total` and drip rate |
| Hide buddy overlay | Toggle | off | Globally hides floating overlay |
| Mute reaction particles | Toggle | off | Accessibility — disables particle pops + transform combos. Sprite still flaps. |
| Mute claim animations | Toggle | off | Skip ChestRevealModal — instant claim with toast |
| Mute milestone celebrations | Toggle | off | Skip MilestoneCelebrationModal — instant unlock with toast |
| Reset buddy state | Danger button + confirm | — | Wipes all 5 tables, restores starter Scout Wings |

"Off" cap = chest never caps; activity points still count, drip rate is preserved. For users who want pure ambient companion without AFK pressure.

---

## 9. Performance Budgets

| Surface | Budget | Mechanism |
|---|---|---|
| Floating overlay (every page) | <1ms paint per frame | Single `<div>` + CSS background animation. Drag uses ref + raw transform, settles on `pointerup` only. |
| Battle scene (BuddyView only) | <3ms paint per frame | `IntersectionObserver` pauses encounter loop when BuddyView not visible. `setInterval(800ms)` not RAF. |
| ParticleLayer | Cull at 6 simultaneous | Older particles unmount on overflow. Each particle = `<div>` with CSS transition, no JS animation. |
| Chest reveal modal | <16ms initial paint | Pre-mounted `<dialog>` — `open()` toggle, no React tree creation |
| Milestone celebration modal | <50ms initial paint | One-shot mount, GPU-accelerated transforms only. Doesn't run continuously. |
| Activity event flush | 5s debounce, 50 events max per batch | Hard cap in `record_activity_batch` Rust handler |
| Lazy point compute | O(1), no timer | Computed on read |

**Acceptance check**: when buddy overlay is mounted on a page running heavy work (e.g. Notes editor with a 50KB markdown doc), Chrome DevTools Performance tab should show <2% CPU attributable to buddy-related code. Documented as a regression check in the test suite.

---

## 10. Error Handling

| Failure | Handling |
|---|---|
| `claim_chest()` mid-flight DB error | Single Rust transaction (`BEGIN ... COMMIT`). Failure → rollback, return `Err`, frontend shows "Couldn't claim — try again" toast. State unchanged. |
| Frontend/backend buddy state desync | `BuddyContext.refresh()` runs after every mutating command. Cheap — one read of 5 tables. |
| Activity event spam (user mashes Cmd+S) | `record_activity_batch` validates `events.len() <= 50`. Excess silently dropped. 5s debounce in frontend means real spam never reaches backend. |
| Drag overlay outside viewport (monitor disconnect, window minimize) | On app boot + on `window.resize`, validate `overlay_x/y` clamped to current viewport. If invalid, snap to nearest valid anchor corner. |
| Equip gear that's already equipped on another buddy | App-side rule: gear unequipped from prior buddy automatically. Single source of truth — gear belongs to one buddy or none. No DB constraint needed. |
| Active buddy ID points to deleted/locked buddy | On `get_buddy_state()`, validate `active_buddy_id ∈ unlocked`. If not, fall back to Scout Wings. |
| User sets system clock backward | `now < last_drip_ms` → treat elapsed as 0. No negative drip. |
| Settings cap interval change mid-fill | Recompute `cap_total`. If `points_balance > new_cap`, overflow excess into `points_overflow`. Never destroy points. |
| Milestone double-completion (race) | `tick_milestone()` checks `completed_at_ms IS NULL` before flipping. Idempotent. |

---

## 11. Files Touched

### New files

- `src-tauri/migrations/00NN_buddy_system.sql` — schema
- `src-tauri/src/commands/buddy.rs` — Tauri commands
- `src-tauri/src/managers/buddy.rs` — drop rolling, level math, milestone logic
- `src/contexts/BuddyContext.tsx` — frontend state + event bus listener
- `src/components/CartoonBuddy.tsx` — full rewrite (drag, right-click, click reactions)
- `src/components/BuddyContextMenu.tsx` — right-click menu
- `src/components/ParticlePop.tsx` + `ParticleLayer.tsx` — reaction particles
- `src/components/SparkleAura.tsx` — shiny indicator
- `src/components/ChestRevealModal.tsx` — claim modal
- `src/components/MilestoneCelebrationModal.tsx` — D&D unlock modal
- `src/components/BattleScene.tsx` — encounter loop visual
- `src/buddy/reactions.ts` — reaction catalog + picker
- `src/buddy/levels.ts` — XP/level curve helpers
- `src/buddy/teamPower.ts` — power computation
- `src/styles/buddy.css` — overlay, particles, modals, battle scene styles

### Modified files

- `src-tauri/src/lib.rs` — register new commands, run migration, wire backend hooks
- `src-tauri/src/managers/embedding_worker.rs` — call `tick_milestone("embeddings-100")` and `tick_milestone("embeddings-1000")`
- `src/App.tsx` — wrap in `<BuddyProvider>`, mount `<CartoonBuddy>` outside page-content area
- `src/components/BuddyView.tsx` — replace mock data with `useBuddyContext()`, add Gear Inventory panel, add BattleScene to hero card, restructure Codex into Roster + locked codex
- `src/components/MarkdownEditor.tsx` — emit `buddy:note-saved` on autosave commit
- `src/components/AudioView.tsx` — emit `buddy:voice-memo-recorded` on session end
- `src/components/SystemAudioView.tsx` — emit `buddy:system-audio-segment` per paragraph
- `src/components/ImportUrlTab.tsx` — emit `buddy:url-imported` on completion
- `src/components/Tree.tsx` (or wherever `create_node` is called for new docs) — emit `buddy:note-created`
- Database surfaces (W4 outputs) — emit `buddy:database-created`, `buddy:database-row-created`
- Search surfaces (W3 outputs) — emit `buddy:search-clicked`
- Markdown rendering layer (the `node://` link click handler per CLAUDE.md "Wikilinks") — emit `buddy:wikilink-followed`
- `src/bindings.ts` — auto-regenerated by specta after Rust changes
- `src/App.css` — add `--buddy-*` tokens; the existing `.buddy-wing-sprite*` classes stay

---

## 12. Suggested Implementation Phases

The system is large enough that implementation should span multiple GSD phases. The plan-writing step (next) will refine these:

**Phase B1 — Engine + minimum viable loop**
- Schema migration, Tauri commands, BuddyContext skeleton
- Lazy point compute, claim transaction, gear drop algorithm (including 1/512 shiny roll)
- Activity event bus + frontend hooks across all wired surfaces (W0/W1 wired today; W2/W3/W4 hooks added as those phases land)
- Replace BuddyView mock data with real context
- Chest reveal modal complete (item arc-out, rarity glow, shiny celebration mode) — no D&D, no battle scene
- **Functional Gear Inventory panel** — list view, equip/unequip buttons, no horizontal-scroll polish yet (deferred to B3)
- Settings page integration

**Phase B2 — Floating overlay & click reactions**
- CartoonBuddy rewrite — drag, anchor-relative position, right-click menu
- ParticlePop + ParticleLayer
- Reaction catalog + picker
- Shiny visual treatment (`SparkleAura` + hue-rotate filter)

**Phase B3 — Battle scene & milestone celebration polish**
- BattleScene component (parallax background, doodle-blob enemies, encounter loop)
- MilestoneCelebrationModal (D&D parchment + rune + D20 + stat block)
- Gear Inventory polish — horizontal scroll per slot, equipped-piece ring, animated equip transitions
- Roster vs Codex split — separate panels for unlocked vs locked, milestone hint captions

Each phase is independently shippable. B1 is the load-bearing one; B2 and B3 add atmosphere on top.

---

## 13. Open Questions

None at spec time — all key decisions are locked in Section 3. Anything that surfaces during planning or implementation should be raised back to the user, not silently resolved.

---

## 14. Appendix — Worked example: a typical day

User opens app at 9am. Last claim was 11pm last night (10h ago, capped at 8h). Active buddy: Scout Wings, level 4.

1. **9:00am** — Opens BuddyView. Chest is full (1000pt + 240pt overflow from yesterday's late notes). Clicks "Claim". `<ChestRevealModal>` opens. 2 items drop: a Common Hat (white glow) and a Rare Aura (blue glow). +1240 XP applied to Scout Wings → ticks Scout Wings to L5.
2. **9:15am** — Saves first note of the day. `buddy:note-saved` fires → +5pt overflow, +5 XP to Scout Wings.
3. **10:30am** — Records voice memo. +50pt overflow, +50 XP. Clicks the floating buddy in the corner — particle ❤ pops, sprite squish-bounces.
4. **12:00pm** — Hits embeddings-100 milestone. `<MilestoneCelebrationModal>` opens: parchment unfurls, D20 rolls a 20, Hover Wings materializes with stat block. User clicks "Set as active buddy".
5. **2:00pm** — Active is now Hover Wings (L1). Clicks open Gear Inventory, equips the Rare Aura on Hover Wings → Team Power jumps from 30 to 78.
6. **5:00pm** — 8h cap fills via wall-clock alone (~1000pt). Plus ~180pt overflow from afternoon activity. User claims again. Higher Team Power (78) gives a small loot bonus — gets one Epic Charm. Lucky roll: it's **shiny** (1/512 ≈ 0.2%). Extra confetti, gold flare, ★ badge. User flexes.
7. **5:01pm** onward — Hover Wings keeps gaining XP from any activity. Sleeps. Tomorrow's claim cycle starts.

The hook works: user wants to come back at lunch and end-of-day to claim. The cap creates urgency without preventing them from doing real work in between. The shiny chase keeps every claim interesting forever.
