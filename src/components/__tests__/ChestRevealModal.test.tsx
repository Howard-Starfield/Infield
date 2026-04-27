import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ChestRevealModal } from '../ChestRevealModal';

const mockResult = {
  points_claimed: 1100,
  xp_awarded: 1100,
  gear_dropped: [
    { gear_id: 'g1', slot: 'hat', species: 'common-hat', rarity: 'common', shiny: false,
      power_bonus: 1, speed_bonus: 1, charm_bonus: 5, acquired_at_ms: 0 },
    { gear_id: 'g2', slot: 'aura', species: 'rare-aura', rarity: 'rare', shiny: true,
      power_bonus: 8, speed_bonus: 4, charm_bonus: 4, acquired_at_ms: 0 },
  ],
};

describe('ChestRevealModal', () => {
  it('renders nothing when result is null', () => {
    const { container } = render(<ChestRevealModal result={null} onClose={() => {}} />);
    expect(container.textContent).toBe('');
  });

  it('renders one card per gear drop', () => {
    render(<ChestRevealModal result={mockResult} onClose={() => {}} />);
    expect(screen.getByText(/common-hat/)).toBeInTheDocument();
    expect(screen.getByText(/rare-aura/)).toBeInTheDocument();
  });

  it('marks shiny drops with a star', () => {
    render(<ChestRevealModal result={mockResult} onClose={() => {}} />);
    expect(screen.getByText(/rare-aura.*★/)).toBeInTheDocument();
  });
});
