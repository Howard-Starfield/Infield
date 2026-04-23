export interface ThemePreset {
  id: string;
  name: string;
  brand: string;
  bgA: string;
  bgB: string;
  bgC: string;
  foundation: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'terracotta',
    name: 'Sovereign Terracotta',
    brand: '#cc4c2b',
    bgA: '#1a1110',
    bgB: '#cc4c2b',
    bgC: '#5c2a1a',
    foundation: '#14151a'
  },
  {
    id: 'cobalt',
    name: 'Deep Sea Cobalt',
    brand: '#00d2ff',
    bgA: '#050a14',
    bgB: '#004e92',
    bgC: '#00d2ff',
    foundation: '#0a0c10'
  },
  {
    id: 'emerald',
    name: 'Emerald Matrix',
    brand: '#10b981',
    bgA: '#061a14',
    bgB: '#065f46',
    bgC: '#10b981',
    foundation: '#08100e'
  },
  {
    id: 'violet',
    name: 'Electric Violet',
    brand: '#8b5cf6',
    bgA: '#1a0b2e',
    bgB: '#5b21b6',
    bgC: '#8b5cf6',
    foundation: '#0f0a1a'
  },
  {
    id: 'void',
    name: 'Void Lemniscate',
    brand: '#9c36b5',
    bgA: '#050508',
    bgB: '#2c0a3d',
    bgC: '#9c36b5',
    foundation: '#0a0a0f'
  },
  {
    id: 'stealth',
    name: 'Absolute Stealth',
    brand: '#ffffff',
    bgA: '#0a0a0a',
    bgB: '#111111',
    bgC: '#171717',
    foundation: '#171717'
  },
  {
    id: 'sandstone',
    name: 'Sandstone Vault',
    brand: '#d35a36',
    bgA: '#ffffff',
    bgB: '#f1ebe4',
    bgC: '#d35a36',
    foundation: '#f1ebe4'
  },
  {
    id: 'zen',
    name: 'Alabaster Zen',
    brand: '#2c3e50',
    bgA: '#ffffff',
    bgB: '#f5f2ed',
    bgC: '#e8e4db',
    foundation: '#f5f2ed'
  },
  {
    id: 'dream',
    name: 'Cinematic Dream',
    brand: '#f0d8d0',
    bgA: '#1a1b23',
    bgB: '#2a2b35',
    bgC: '#1a1b23',
    foundation: '#1a1b23'
  }
];

export function getThemeById(id: string): ThemePreset {
  return THEME_PRESETS.find(p => p.id === id) || THEME_PRESETS[0];
}
