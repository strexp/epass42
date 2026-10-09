import { describe, expect, it } from 'vitest'
import { canIsValid, normaliseCan, randomCan } from './can'

describe('CAN helpers', () => {
  it('accepts six digits or an empty value', () => {
    expect(canIsValid('')).toBe(true)
    expect(canIsValid('123456')).toBe(true)
    expect(canIsValid('12345')).toBe(false)
    expect(canIsValid('1234567')).toBe(false)
    expect(canIsValid('12a456')).toBe(false)
  })

  it('normalises input to at most six digits', () => {
    expect(normaliseCan('12a3 45678')).toBe('123456')
    expect(normaliseCan('')).toBe('')
  })

  it('generates a six-digit CAN', () => {
    for (let i = 0; i < 100; i++) {
      const can = randomCan()
      expect(can).toMatch(/^\d{6}$/)
      expect(canIsValid(can)).toBe(true)
    }
  })
})
