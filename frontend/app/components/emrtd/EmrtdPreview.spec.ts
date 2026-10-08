import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import EmrtdPreview from '~/components/emrtd/EmrtdPreview.vue'
import type { MrzFields } from '@pkd42/shared'

const mrz: MrzFields = {
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

describe('EmrtdPreview', () => {
  it('shows the document number and masked-friendly name', () => {
    const wrapper = mount(EmrtdPreview, {
      props: { mrz },
      global: { mocks: { $t: (key: string) => key } },
    })
    expect(wrapper.text()).toContain('X1234567')
    expect(wrapper.text()).toContain('JANE DOE')
    expect(wrapper.find('[data-testid="emrtd-preview"]').exists()).toBe(true)
  })

  it('renders the unspecified sex as X', () => {
    const wrapper = mount(EmrtdPreview, {
      props: { mrz: { ...mrz, sex: '<' } },
      global: { mocks: { $t: (key: string) => key } },
    })
    expect(wrapper.text()).toContain('X')
    expect(wrapper.text()).not.toContain('<')
  })
})
