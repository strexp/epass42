import { describe, expect, it } from 'vitest'
import { formatMrzDate, mrzToTimestamp, timestampToMrz } from './mrzDate'

/** The current two-digit year, used to exercise the MRZ century rule. */
const CURRENT_YY = new Date().getFullYear() % 100

describe('mrzToTimestamp', () => {
  it('reads a six-digit date of birth with the ICAO century rule', () => {
    // 90 > current YY, so this is 1990 (safe until 2090).
    expect(new Date(mrzToTimestamp('900101')!).getFullYear()).toBe(1990)
    // 05 <= current YY, so this is 2005 (safe while the current year is past 2005).
    expect(new Date(mrzToTimestamp('050101')!).getFullYear()).toBe(2005)
  })

  it('reads an eight-digit full-year date', () => {
    expect(new Date(mrzToTimestamp('19900101', 8)!).getFullYear()).toBe(1990)
    expect(new Date(mrzToTimestamp('20301231', 8)!).getFullYear()).toBe(2030)
  })

  it('rejects malformed or impossible dates', () => {
    expect(mrzToTimestamp('')).toBeNull()
    expect(mrzToTimestamp('9001')).toBeNull()
    expect(mrzToTimestamp('90a101')).toBeNull()
    expect(mrzToTimestamp('991399')).toBeNull()
    expect(mrzToTimestamp('900232')).toBeNull()
    expect(mrzToTimestamp('1990011', 8)).toBeNull()
  })

  it('places the timestamp at local midnight', () => {
    const date = new Date(mrzToTimestamp('900101')!)
    expect(date.getHours()).toBe(0)
    expect(date.getMinutes()).toBe(0)
    expect(date.getSeconds()).toBe(0)
  })

  it('keeps the boundary year in the current century', () => {
    const value = `${String(CURRENT_YY).padStart(2, '0')}0101`
    expect(new Date(mrzToTimestamp(value)!).getFullYear()).toBe(2000 + CURRENT_YY)
  })
})

describe('timestampToMrz', () => {
  it('round-trips a six-digit date', () => {
    expect(timestampToMrz(mrzToTimestamp('900101'))).toBe('900101')
  })

  it('round-trips an eight-digit date', () => {
    expect(timestampToMrz(mrzToTimestamp('19900101', 8), 8)).toBe('19900101')
  })

  it('returns an empty string for a null timestamp', () => {
    expect(timestampToMrz(null)).toBe('')
  })
})

describe('formatMrzDate', () => {
  it('renders a six-digit date as YYYY-MM-DD', () => {
    expect(formatMrzDate('900101')).toBe('1990-01-01')
  })

  it('renders an eight-digit date as YYYY-MM-DD', () => {
    expect(formatMrzDate('19900101', 8)).toBe('1990-01-01')
  })

  it('returns an empty string for an invalid value', () => {
    expect(formatMrzDate('')).toBe('')
    expect(formatMrzDate('99')).toBe('')
  })
})
