import { describe, expect, it } from 'vitest'
import { hashNameToGradient, initialsOf } from './OwnerAvatar'
import { inferStatusVariant } from './StatusTag'

describe('hashNameToGradient', () => {
  it('returns the same gradient for the same name across calls', () => {
    expect(hashNameToGradient('Priya')).toBe(hashNameToGradient('Priya'))
    expect(hashNameToGradient('Maya')).toBe(hashNameToGradient('Maya'))
  })

  it('is case-insensitive and trim-stable', () => {
    expect(hashNameToGradient('Priya')).toBe(hashNameToGradient('priya'))
    expect(hashNameToGradient('  Priya  ')).toBe(hashNameToGradient('Priya'))
    expect(hashNameToGradient('PRIYA')).toBe(hashNameToGradient('priya'))
  })

  it('produces one of six gradient ids', () => {
    const ids = new Set<string>()
    // Sample a bunch of names — should spread across the 6 buckets
    ;['Priya', 'Theo', 'Maya', 'Lio', 'Rei', 'Sam', 'Alex', 'Jordan', 'Kim', 'Ana'].forEach(
      (n) => ids.add(hashNameToGradient(n)),
    )
    ids.forEach((id) => {
      expect(['a', 'b', 'c', 'd', 'e', 'f']).toContain(id)
    })
  })

  it('handles empty string without crashing', () => {
    expect(['a', 'b', 'c', 'd', 'e', 'f']).toContain(hashNameToGradient(''))
    expect(['a', 'b', 'c', 'd', 'e', 'f']).toContain(hashNameToGradient('   '))
  })
})

describe('initialsOf', () => {
  it('single name → first letter', () => {
    expect(initialsOf('Priya')).toBe('P')
    expect(initialsOf('maya')).toBe('M')
  })

  it('two words → first + last initial', () => {
    expect(initialsOf('Mei Lin')).toBe('ML')
    expect(initialsOf('sam o\'brien')).toBe('SO')
  })

  it('strips titles with dots', () => {
    expect(initialsOf('Dr. Sam O\'Brien')).toBe('SO')
    expect(initialsOf('Mr. Priya')).toBe('P')
  })

  it('empty / whitespace → placeholder', () => {
    expect(initialsOf('')).toBe('·')
    expect(initialsOf('   ')).toBe('·')
  })

  it('multi-word (>2) → first + last', () => {
    expect(initialsOf('Mary Jane Watson')).toBe('MW')
  })
})

describe('inferStatusVariant', () => {
  it('detects active', () => {
    expect(inferStatusVariant('Active')).toBe('active')
    expect(inferStatusVariant('In Progress')).toBe('active')
    expect(inferStatusVariant('WIP')).toBe('active')
    expect(inferStatusVariant('Running')).toBe('active')
    expect(inferStatusVariant('doing')).toBe('active')
  })

  it('detects review', () => {
    expect(inferStatusVariant('In Review')).toBe('review')
    expect(inferStatusVariant('Pending')).toBe('review')
    expect(inferStatusVariant('proposed')).toBe('review')
  })

  it('detects blocked', () => {
    expect(inferStatusVariant('Blocked')).toBe('blocked')
    expect(inferStatusVariant('Stuck')).toBe('blocked')
    expect(inferStatusVariant('On hold')).toBe('blocked')
    expect(inferStatusVariant('Overdue')).toBe('blocked')
  })

  it('detects done', () => {
    expect(inferStatusVariant('Done')).toBe('done')
    expect(inferStatusVariant('Completed')).toBe('done')
    expect(inferStatusVariant('Shipped')).toBe('done')
    expect(inferStatusVariant('Closed')).toBe('done')
    expect(inferStatusVariant('Resolved')).toBe('done')
  })

  it('falls back to draft on unknown', () => {
    expect(inferStatusVariant('Yolo')).toBe('draft')
    expect(inferStatusVariant('')).toBe('draft')
    expect(inferStatusVariant(null)).toBe('draft')
    expect(inferStatusVariant(undefined)).toBe('draft')
  })

  // ── Adversarial cases (B2 audit finding) ───────────────────────────────────
  // The previous implementation used unanchored regexes, causing substring
  // matches to fire on unrelated words. These tests pin the word-boundary
  // fix so it can't regress.

  it('does not match substrings inside unrelated words', () => {
    // 'ship' in 'relationship'
    expect(inferStatusVariant('customer relationship')).toBe('draft')
    // 'hold' in 'Placeholder'
    expect(inferStatusVariant('Placeholder')).toBe('draft')
    // 'done' in 'undone' — undone is not done
    expect(inferStatusVariant('undone')).toBe('draft')
    // 'wait' in 'waitress' (silly but demonstrates the boundary)
    expect(inferStatusVariant('waitress of honor')).toBe('draft')
  })

  it('prefers review over blocked when both cues appear', () => {
    // "waiting for review" — review is the more specific signal.
    expect(inferStatusVariant('waiting for review')).toBe('review')
    expect(inferStatusVariant('Pending review')).toBe('review')
  })

  it('prefers review over done when both cues appear', () => {
    // The explicit adversarial case from the audit.
    expect(inferStatusVariant('done for a review')).toBe('review')
    expect(inferStatusVariant('Done pending review')).toBe('review')
  })

  it('prefers blocked over done when both cues appear', () => {
    expect(inferStatusVariant('blocked — needs done check')).toBe('blocked')
  })

  it('negated done lands on active, not done', () => {
    expect(inferStatusVariant('not done')).toBe('active')
    expect(inferStatusVariant('not complete')).toBe('active')
    expect(inferStatusVariant('Not Shipped')).toBe('active')
  })

  it('handles hyphen / space variants', () => {
    expect(inferStatusVariant('on-hold')).toBe('blocked')
    expect(inferStatusVariant('on hold')).toBe('blocked')
    expect(inferStatusVariant('in-progress')).toBe('active')
    expect(inferStatusVariant('in progress')).toBe('active')
  })
})
