/**
 * Shared design tokens for the workspace calendar.
 * All calendar components (week/day chip, agenda sidebar, mini-month, overlay)
 * import from here so typography, spacing, radii, and dot sizes stay in sync.
 */
export const CT = {
  font: 'Space Grotesk, sans-serif',

  // Font sizes
  size_chipTitle: 9,
  size_sidebarTitle: 11,
  size_sidebarEventTitle: 11,
  size_sidebarEventTime: 9,
  size_miniMonthDay: 10,
  size_miniMonthTitle: 11,
  size_miniMonthWeekday: 9,

  // Font weights
  weight_title: 600,
  weight_titleBold: 700,
  weight_body: 500,

  // Padding / spacing
  pad_sidebarEventRow: '5px 8px',
  pad_sidebarNav: '2px 6px',
  miniMonth_cellH: 22,
  miniMonth_gap: 2,

  // Border radii
  radius_event: 6,
  radius_button: 6,
  radius_input: 7,
  radius_panel: 12,

  // Dot indicators
  dot_size: 6,
  dot_sizeSmall: 3,
} as const
