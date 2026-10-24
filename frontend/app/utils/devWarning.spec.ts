import { describe, expect, it } from 'vitest'

import { shouldShowDevWarning } from './devWarning'

describe('shouldShowDevWarning', () => {
  it('shows the warning once on a new development visit', () => {
    expect(shouldShowDevWarning('development', false)).toBe(true)
  })

  it('stays hidden after the operator acknowledges it', () => {
    expect(shouldShowDevWarning('development', true)).toBe(false)
  })

  it('never shows outside development', () => {
    expect(shouldShowDevWarning('test', false)).toBe(false)
    expect(shouldShowDevWarning('production', false)).toBe(false)
    expect(shouldShowDevWarning(undefined, false)).toBe(false)
  })
})
