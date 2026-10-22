import { describe, expect, it } from 'vitest'

import {
  DOCUMENT_TYPES,
  documentFormatOf,
  documentTypeCovers,
  documentTypeDefinition,
  documentTypeListSchema,
  normalizeDocumentIssueType,
} from './documentTypes'

describe('document types', () => {
  it('keeps the concrete ID/IP types separate from the I wildcard', () => {
    expect(documentTypeDefinition('ID').format).toBe('TD1')
    expect(documentTypeDefinition('IP').format).toBe('TD1')
    expect(documentTypeDefinition('P').format).toBe('TD3')
    expect(documentTypeDefinition('I').wildcard).toBe(true)
    expect(DOCUMENT_TYPES.map((type) => type.code)).toEqual(['P', 'ID', 'IP', 'I'])
  })

  it('resolves the MRZ layout for concrete document types', () => {
    expect(documentFormatOf('P')).toBe('TD3')
    expect(documentFormatOf('ID')).toBe('TD1')
    expect(documentFormatOf('IP')).toBe('TD1')
    expect(() => documentFormatOf('I')).toThrow(/wildcard/)
    expect(() => normalizeDocumentIssueType('I')).toThrow(/invalid/)
  })

  it('applies the I* wildcard when checking DSC authorization', () => {
    expect(documentTypeCovers(['P', 'I'], 'P')).toBe(true)
    expect(documentTypeCovers(['P', 'I'], 'ID')).toBe(true)
    expect(documentTypeCovers(['P', 'I'], 'IP')).toBe(true)
    expect(documentTypeCovers(['P'], 'ID')).toBe(false)
    expect(documentTypeCovers(['ID'], 'IP')).toBe(false)
    expect(documentTypeCovers(['ID'], 'ID')).toBe(true)
    expect(documentTypeCovers(['IP'], 'IP')).toBe(true)
  })

  it('normalises case but rejects unknown values', () => {
    expect(documentTypeCovers(['i'], 'id')).toBe(true)
    expect(() => documentTypeCovers(['X'], 'P')).toThrow(/invalid/)
    expect(() => documentTypeCovers(['P'], 'I')).toThrow(/invalid/)
  })

  it('validates DSC DocumentType lists', () => {
    expect(documentTypeListSchema.parse(['P', 'I'])).toEqual(['P', 'I'])
    expect(() => documentTypeListSchema.parse([])).toThrow()
    expect(() => documentTypeListSchema.parse(['P', 'I', 'ID'])).toThrow()
    expect(() => documentTypeListSchema.parse(['P', 'P'])).toThrow(/duplicate/)
  })
})
