import { describe, expect, it } from 'vitest'
import { lds2SignerTypeCodesLabel, lds2SignerTypesLabel, signerCertificateLabel } from './lds2'

const messages: Record<string, string> = {
  'common.dsc': 'DSC',
  'common.lds2': 'LDS2',
  'common.documentType.separator': ', ',
  'common.lds2Types.ts': 'LDS2-TS (travel stamp)',
  'common.lds2Types.v': 'LDS2-V (electronic visa)',
  'common.lds2Types.b': 'LDS2-B (additional biometrics)',
  'common.lds2TypeCodes.ts': 'LDS2-TS',
  'common.lds2TypeCodes.v': 'LDS2-V',
  'common.lds2TypeCodes.b': 'LDS2-B',
}

const t = (key: string): string => messages[key] ?? key

describe('signer certificate labels', () => {
  it('labels a Document Signer simply as "DSC"', () => {
    expect(signerCertificateLabel('dsc', null, t)).toBe('DSC')
  })

  it('labels LDS2 roles as compact codes in catalog order', () => {
    expect(signerCertificateLabel('lds2', ['v', 'ts'], t)).toBe('LDS2-TS, LDS2-V')
    expect(signerCertificateLabel('lds2', ['b'], t)).toBe('LDS2-B')
  })

  it('falls back to the bare labels when nothing is recorded', () => {
    expect(signerCertificateLabel('lds2', [], t)).toBe('LDS2')
    expect(signerCertificateLabel(undefined, null, t)).toBe('DSC')
  })

  it('keeps the descriptive role labels for forms', () => {
    expect(lds2SignerTypesLabel(['ts', 'b'], t)).toBe(
      'LDS2-TS (travel stamp), LDS2-B (additional biometrics)',
    )
    expect(lds2SignerTypeCodesLabel(['ts', 'b'], t)).toBe('LDS2-TS, LDS2-B')
  })

  it('has a compact code for every role', () => {
    for (const role of ['ts', 'v', 'b'] as const) {
      expect(lds2SignerTypeCodesLabel([role], t)).toMatch(/^LDS2-[A-Z]+$/)
    }
  })
})
