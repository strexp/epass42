import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ValidityCell from './ValidityCell.vue'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ValidityCell', () => {
  it('shows the certificate window and the private-key expiry for X.509 signers', () => {
    vi.stubGlobal('useDateTime', () => ({
      formatDate: (value: string | null | undefined) => value ?? '—',
      formatDateTime: (value: string | null | undefined) => value ?? '—',
    }))
    const wrapper = mount(ValidityCell, {
      props: {
        notBefore: '2026-01-01T00:00:00.000Z',
        notAfter: '2036-01-01T00:00:00.000Z',
        privateKeyNotAfter: '2026-04-01T00:00:00.000Z',
      },
      global: { mocks: { $t: (key: string) => key } },
    })
    expect(wrapper.text()).toContain('2026-01-01T00:00:00.000Z')
    expect(wrapper.text()).toContain('2036-01-01T00:00:00.000Z')
    expect(wrapper.text()).toContain('common.privateKeyValidity')
    expect(wrapper.text()).toContain('2026-04-01T00:00:00.000Z')
  })

  it('omits the key line for CV certificates', () => {
    vi.stubGlobal('useDateTime', () => ({
      formatDate: (value: string | null | undefined) => value ?? '—',
      formatDateTime: (value: string | null | undefined) => value ?? '—',
    }))
    const wrapper = mount(ValidityCell, {
      props: { notAfter: '2026-04-01T00:00:00.000Z' },
      global: { mocks: { $t: (key: string) => key } },
    })
    expect(wrapper.text()).not.toContain('common.privateKeyValidity')
  })
})
