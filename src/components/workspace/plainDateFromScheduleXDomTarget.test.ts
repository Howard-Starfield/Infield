import 'temporal-polyfill/global'
import { describe, expect, it } from 'vitest'
import { plainDateFromScheduleXDomTarget } from './WorkspaceCalendarScheduleBody'

describe('plainDateFromScheduleXDomTarget', () => {
  const fallback = Temporal.PlainDate.from('2020-01-01')

  it('reads data-time-grid-date from a nested target', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div data-time-grid-date="2026-06-15"><span class="inner"></span></div>'
    const inner = root.querySelector('.inner') as HTMLElement
    expect(plainDateFromScheduleXDomTarget(inner, fallback).toString()).toBe('2026-06-15')
  })

  it('reads data-date when no time grid cell', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div data-date="2026-03-01"><button type="button">x</button></div>'
    const btn = root.querySelector('button') as HTMLElement
    expect(plainDateFromScheduleXDomTarget(btn, fallback).toString()).toBe('2026-03-01')
  })

  it('prefers data-time-grid-date over data-date when both exist', () => {
    const root = document.createElement('div')
    root.innerHTML =
      '<div data-date="2026-01-01"><div data-time-grid-date="2026-02-02"><i></i></div></div>'
    const i = root.querySelector('i') as HTMLElement
    expect(plainDateFromScheduleXDomTarget(i, fallback).toString()).toBe('2026-02-02')
  })

  it('returns fallback for invalid attribute', () => {
    const el = document.createElement('div')
    el.setAttribute('data-date', 'not-a-date')
    expect(plainDateFromScheduleXDomTarget(el, fallback).toString()).toBe('2020-01-01')
  })
})
