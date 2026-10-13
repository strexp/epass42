import { describe, expect, it } from 'vitest'
import { formatDate } from './datetime'

describe('formatDate', () => {
  it('compresses an ISO timestamp to its calendar date', () => {
    expect(formatDate('2026-10-13T07:47:13.389Z')).toBe('2026-10-13')
  })

  it('keeps a date-only value unchanged', () => {
    expect(formatDate('2026-01-02')).toBe('2026-01-02')
  })

  it('falls back for empty and invalid values', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate('not-a-date')).toBe('not-a-date')
  })
})
