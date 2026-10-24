import { describe, expect, it } from 'vitest'

import en from '../../i18n/locales/en/help'
import zh from '../../i18n/locales/zh/help'

describe('help locale parity', () => {
  it('defines the same roles, flows and links in both languages', () => {
    expect(Object.keys(zh.roles)).toEqual(Object.keys(en.roles))
    expect(Object.keys(zh.flows)).toEqual(Object.keys(en.flows))
    expect(Object.keys(zh.links)).toEqual(Object.keys(en.links))
  })

  it('defines the same steps and fields for every role flow', () => {
    for (const role of Object.keys(zh.flows) as (keyof typeof zh.flows)[]) {
      const zhFlow = zh.flows[role] as { steps: Record<string, unknown>; summary: string }
      const enFlow = en.flows[role] as { steps: Record<string, unknown>; summary: string }
      expect(Object.keys(zhFlow.steps)).toEqual(Object.keys(enFlow.steps))
      expect(zhFlow.summary).toBeTruthy()
      expect(enFlow.summary).toBeTruthy()
      for (const step of Object.values(zhFlow.steps) as { title: string; body: string }[]) {
        expect(step.title).toBeTruthy()
        expect(step.body).toBeTruthy()
      }
    }
  })
})
