import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TagListField from '~/components/common/TagListField.vue'

describe('TagListField', () => {
  it('renders the current values as tags', () => {
    const wrapper = mount(TagListField, {
      props: { modelValue: ['ALPHA', 'BETA'] },
    })
    expect(wrapper.text()).toContain('ALPHA')
    expect(wrapper.text()).toContain('BETA')
  })
})
