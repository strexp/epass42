import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MrzEditor from '~/components/emrtd/MrzEditor.vue'
import type { MrzFields } from '@pkd42/shared'

function fields(): MrzFields {
  return {
    documentCode: 'P',
    issuingState: 'UDN',
    surname: 'DOE',
    givenNames: 'JANE',
    documentNumber: 'X1234567',
    nationality: 'UDN',
    dateOfBirth: '900101',
    sex: 'F',
    dateOfExpiry: '300101',
    personalNumber: '',
    optionalData: '',
  }
}

describe('MrzEditor', () => {
  it('renders 44-character TD3 lines from the model', () => {
    const wrapper = mount(MrzEditor, {
      props: { modelValue: fields() },
      global: { mocks: { $t: (key: string) => key } },
    })
    const line1 = wrapper.get('[data-testid="mrz-line1"]').text()
    const line2 = wrapper.get('[data-testid="mrz-line2"]').text()
    expect(line1).toHaveLength(44)
    expect(line2).toHaveLength(44)
    expect(line2.startsWith('X1234567')).toBe(true)
    // Regression: the form fields must actually render (Naive UI NGrid without
    // NGi children renders empty).
    expect(wrapper.text()).toContain('Surname')
    expect(wrapper.text()).toContain('Document number')
  })
})
