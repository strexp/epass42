import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime } from './datetime'

describe('formatDate', () => {
  it('renders the calendar day in UTC, following the locale', () => {
    expect(formatDate('2026-10-13T07:47:13.389Z')).toBe('Oct 13, 2026')
    expect(formatDate('2026-10-13T07:47:13.389Z', 'zh')).toContain('2026')
  })

  it('keeps a date-only value on the same day', () => {
    expect(formatDate('2026-01-02')).toBe('Jan 2, 2026')
    expect(formatDate('2026-01-01T23:59:59Z')).toBe('Jan 1, 2026')
  })

  it('falls back for empty and invalid values', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate('not-a-date')).toBe('not-a-date')
  })
})

describe('formatDateTime', () => {
  it('includes the time of day', () => {
    expect(formatDateTime('2026-10-13T07:47:13.389Z')).toMatch(/\d{1,2}:\d{2}/)
  })

  it('falls back for empty and invalid values', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime('not-a-date')).toBe('not-a-date')
  })
})
