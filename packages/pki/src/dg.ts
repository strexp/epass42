/**
 * Data group builders and validators (ICAO Doc 9303-10 §4.7, Doc 9303-11 §6.1.5).
 *
 * DG1, DG2, DG5, DG7, DG11, DG12, DG13, DG14, DG15 and DG16 are produced from
 * human-friendly input; DG3 and DG4 are supplied as already-encoded biometric
 * data blocks and are wrapped in their outer tag after validation.
 *
 * The encodings mirror card42's `host/emrtd` builders byte for byte.
 */
import { ascii, concat, type Bytes } from './bytes'
import { derInteger, derTlv, parseSingleTlv, parseTlv } from './der'
import { mrzBytes, type MrzFields } from './mrz'

/** The LDS data group outer application tags (Doc 9303-10 §4.7). */
const DG_TAGS: Record<number, number> = {
  1: 0x61,
  2: 0x75,
  3: 0x63,
  4: 0x76,
  5: 0x65,
  6: 0x66,
  7: 0x67,
  8: 0x68,
  9: 0x69,
  10: 0x6a,
  11: 0x6b,
  12: 0x6c,
  13: 0x6d,
  14: 0x6e,
  15: 0x6f,
  16: 0x70,
}

/** The outer application tag of a data group (1-16). */
export function dgTag(number: number): number {
  const tag = DG_TAGS[number]
  if (tag === undefined) throw new Error(`invalid data group number: ${number}`)
  return tag
}

/** The FID of a data group (DG1 `0101` .. DG16 `0110`). */
export function dgFid(number: number): number {
  if (number < 1 || number > 16) throw new Error(`invalid data group number: ${number}`)
  return 0x0100 | number
}

/** DG1 = `61 { 5F1F MRZ }` (Doc 9303-10 §4.7.1). */
export function buildDg1(mrz: MrzFields): Bytes {
  return derTlv(0x61, derTlv(0x5f1f, mrzBytes(mrz)))
}

/* ------------------------------------------------------------------ *
 * DG2 — encoded face (Doc 9303-10 §4.7.2, ISO/IEC 19794-5)
 * ------------------------------------------------------------------ */

const FORMAT_IDENTIFIER = 0x46414300 // 'F' 'A' 'C' 0x00
const VERSION_NUMBER = 0x30313000 // '0' '1' '0' 0x00

/** ISO/IEC 19794-5 image data types. */
export type Iso19794ImageDataType = 'jpeg' | 'jpeg2000' | 'png'

const IMAGE_DATA_TYPE: Record<Iso19794ImageDataType, number> = {
  jpeg: 0x00,
  jpeg2000: 0x0c,
  png: 0x0f,
}

/** Builds the ISO/IEC 19794-5 Basic Facial Image Record around a JPEG. */
export function faceInformation(
  image: Bytes,
  width: number,
  height: number,
  imageDataType: Iso19794ImageDataType = 'jpeg',
): Bytes {
  const facial = concat(
    writeUint(0, 2), // number of feature points
    new Uint8Array([0x00]), // gender: unspecified
    new Uint8Array([0x00]), // eye colour: unspecified
    new Uint8Array([0x00]), // hair colour: unspecified
    new Uint8Array([0x00, 0x00, 0x00]), // feature mask
    writeUint(0, 2), // expression
    new Uint8Array([0x00, 0x00, 0x00]), // pose angle
    new Uint8Array([0x00, 0x00, 0x00]), // pose angle uncertainty
    new Uint8Array([0x00]), // face image type: basic
    new Uint8Array([IMAGE_DATA_TYPE[imageDataType]]), // image data type
    writeUint(width, 2),
    writeUint(height, 2),
    new Uint8Array([0x00]), // colour space: unspecified
    new Uint8Array([0x00]), // source type: unspecified
    writeUint(0, 2), // device type
    writeUint(0, 2), // quality
    image,
  )
  // The Facial Record Data Block length includes its own 4-byte length field.
  const faceImageBlock = concat(writeUint(4 + facial.length, 4), facial)
  return concat(
    writeUint(FORMAT_IDENTIFIER, 4),
    writeUint(VERSION_NUMBER, 4),
    writeUint(14 + faceImageBlock.length, 4),
    writeUint(1, 2), // one facial record data block
    faceImageBlock,
  )
}

/**
 * DG2 = `75 { 7F61 { 02 01 01, 7F60 { A1 { SBH }, 5F2E ISO 19794-5 } } }`.
 */
export function buildDg2(jpeg: Bytes, width: number, height: number): Bytes {
  const faceInfo = faceInformation(jpeg, width, height)
  const biometricHeader = concat(
    derTlv(0x81, new Uint8Array([0x02])), // biometric type: facial
    derTlv(0x82, new Uint8Array([0x00])), // subtype: none
    derTlv(0x87, new Uint8Array([0x01, 0x01])), // format owner: JTC1 SC37
    derTlv(0x88, new Uint8Array([0x00, 0x08])), // format type: ISO 19794 face
  )
  const biometricInformation = concat(derTlv(0xa1, biometricHeader), derTlv(0x5f2e, faceInfo))
  const groupTemplate = concat(
    derTlv(0x02, new Uint8Array([0x01])),
    derTlv(0x7f60, biometricInformation),
  )
  return derTlv(0x75, derTlv(0x7f61, groupTemplate))
}

/** Validates a DG2 byte string (outer tag, count and ISO 19794-5 header). */
export function validateDg2(bytes: Bytes): void {
  const root = parseSingleTlv(bytes)
  if (root.tag !== 0x75) throw new Error('DG2 outer tag is not 75')
  const bitGroup = root.children[0]
  if (!bitGroup || bitGroup.tag !== 0x7f61) throw new Error('DG2 missing 7F61 template')
  const count = bitGroup.children.find((child) => child.tag === 0x02)
  if (!count || count.value[0] !== bitGroup.children.filter((c) => c.tag === 0x7f60).length) {
    throw new Error('DG2 instance count does not match 7F60 occurrences')
  }
  const faceImage = findTag(bytes, 0x5f2e)
  if (!faceImage) throw new Error('DG2 missing 5F2E face record')
  if (asciiBytes(faceImage.slice(0, 4)) !== 'FAC\0' || faceImage[4] !== 0x30) {
    throw new Error('DG2 face record has an invalid ISO 19794-5 header')
  }
}

/* ------------------------------------------------------------------ *
 * DG3 / DG4 — encoded biometric templates (uploaded)
 * ------------------------------------------------------------------ */

/**
 * Wraps an uploaded DG3 inner template (`7F61 { 02 count, 7F60 ... }`) in the
 * outer tag `63` and validates the outer structure (Doc 9303-10 §4.7.3).
 */
export function wrapDg3(inner: Bytes): Bytes {
  return wrapBiometricTemplate(3, inner, false)
}

/** Wraps an uploaded DG4 inner template in the outer tag `76` (§4.7.4). */
export function wrapDg4(inner: Bytes): Bytes {
  return wrapBiometricTemplate(4, inner, true)
}

function wrapBiometricTemplate(dg: 3 | 4, inner: Bytes, atLeastOne: boolean): Bytes {
  const root = parseSingleTlv(inner)
  if (root.tag !== 0x7f61) {
    throw new Error(`DG${dg} inner template must be a 7F61 group`)
  }
  const countNode = root.children.find((child) => child.tag === 0x02)
  const templates = root.children.filter((child) => child.tag === 0x7f60)
  const count = countNode ? countNode.value[countNode.value.length - 1] : undefined
  if (count !== templates.length) {
    throw new Error(`DG${dg} instance count does not match 7F60 occurrences`)
  }
  if (atLeastOne && templates.length < 1) {
    throw new Error(`DG${dg} requires at least one biometric template`)
  }
  for (const template of templates) {
    const hasBdb = template.children.some((child) => child.tag === 0x5f2e || child.tag === 0x7f2e)
    if (!hasBdb) throw new Error(`DG${dg} template is missing an ISO 19794 BDB (5F2E/7F2E)`)
  }
  return derTlv(dgTag(dg), inner)
}

/* ------------------------------------------------------------------ *
 * DG5 / DG7 — display images
 * ------------------------------------------------------------------ */

/** DG5 = `65 { 02 01 01, 5F40 JPEG }` (displayed portrait, §4.7.5). */
export function buildDg5(jpeg: Bytes): Bytes {
  return derTlv(0x65, concat(derInteger(1), derTlv(0x5f40, jpeg)))
}

/** DG7 = `67 { 02 01 01, 5F43 JPEG }` (displayed signature/mark, §4.7.7). */
export function buildDg7(jpeg: Bytes): Bytes {
  return derTlv(0x67, concat(derInteger(1), derTlv(0x5f43, jpeg)))
}

/* ------------------------------------------------------------------ *
 * DG11 — additional personal details (§4.7.11 Table 71/72)
 * ------------------------------------------------------------------ */

/** The DG11 structured fields. */
export interface Dg11Fields {
  fullName?: string
  otherNames?: string[]
  personalNumber?: string
  /** Full date of birth, CCYYMMDD. */
  fullDateOfBirth?: string
  placeOfBirth?: string
  address?: string
  telephone?: string
  profession?: string
  title?: string
  personalSummary?: string
  /** Citizenship image (unencoded image bytes, unusual). */
  citizenshipImage?: Bytes
  otherTravelDocumentNumbers?: string[]
  custodyInfo?: string
}

/** Builds DG11 with a computed `5C` tag list (§4.7.11). */
export function buildDg11(fields: Dg11Fields): Bytes {
  const parts: Bytes[] = []
  const tags: number[] = []
  const push = (tag: number, value: Bytes): void => {
    parts.push(derTlv(tag, value))
    tags.push(tag)
  }

  if (fields.fullName) push(0x5f0e, utf8(fields.fullName))
  for (const name of fields.otherNames ?? []) {
    parts.push(derTlv(0xa0, concat(derInteger(1), derTlv(0x5f0f, utf8(name)))))
    if (!tags.includes(0x5f0f)) tags.push(0x5f0f)
  }
  if (fields.personalNumber) push(0x5f10, utf8(fields.personalNumber))
  if (fields.fullDateOfBirth) push(0x5f2b, ascii(padDigits(fields.fullDateOfBirth, 8)))
  if (fields.placeOfBirth) push(0x5f11, utf8(fields.placeOfBirth))
  if (fields.address) push(0x5f42, utf8(fields.address))
  if (fields.telephone) push(0x5f12, utf8(fields.telephone))
  if (fields.profession) push(0x5f13, utf8(fields.profession))
  if (fields.title) push(0x5f14, utf8(fields.title))
  if (fields.personalSummary) push(0x5f15, utf8(fields.personalSummary))
  if (fields.citizenshipImage) push(0x5f16, fields.citizenshipImage)
  if (fields.otherTravelDocumentNumbers?.length) {
    push(0x5f17, utf8(fields.otherTravelDocumentNumbers.join(' ')))
  }
  if (fields.custodyInfo) push(0x5f18, utf8(fields.custodyInfo))

  const body = concat(derTlv(0x5c, concat(...tags.map((tag) => encodeTagBytes(tag)))), ...parts)
  return derTlv(0x6b, body)
}

/* ------------------------------------------------------------------ *
 * DG12 — additional document details (§4.7.12 Table 73/74)
 * ------------------------------------------------------------------ */

/** The DG12 structured fields. */
export interface Dg12Fields {
  issuingAuthority?: string
  /** Date of issue, CCYYMMDD. */
  dateOfIssue?: string
  otherPersons?: string[]
  endorsements?: string
  taxExit?: string
  frontImage?: Bytes
  rearImage?: Bytes
  /** Personalization time, CCYYMMDDHHMMSS (server default). */
  personalizationTime?: string
  /** Personalization device serial number (server default). */
  personalizationDevice?: string
}

/** Builds DG12 with a computed `5C` tag list (§4.7.12). */
export function buildDg12(fields: Dg12Fields): Bytes {
  const parts: Bytes[] = []
  const tags: number[] = []
  const push = (tag: number, value: Bytes): void => {
    parts.push(derTlv(tag, value))
    tags.push(tag)
  }

  if (fields.issuingAuthority) push(0x5f19, utf8(fields.issuingAuthority))
  if (fields.dateOfIssue) push(0x5f26, ascii(padDigits(fields.dateOfIssue, 8)))
  for (const person of fields.otherPersons ?? []) {
    parts.push(derTlv(0xa0, concat(derInteger(1), derTlv(0x5f1a, utf8(person)))))
    if (!tags.includes(0x5f1a)) tags.push(0x5f1a)
  }
  if (fields.endorsements) push(0x5f1b, utf8(fields.endorsements))
  if (fields.taxExit) push(0x5f1c, utf8(fields.taxExit))
  if (fields.frontImage) push(0x5f1d, fields.frontImage)
  if (fields.rearImage) push(0x5f1e, fields.rearImage)
  if (fields.personalizationTime) push(0x5f55, ascii(padDigits(fields.personalizationTime, 14)))
  if (fields.personalizationDevice) push(0x5f56, utf8(fields.personalizationDevice))

  const body = concat(derTlv(0x5c, concat(...tags.map((tag) => encodeTagBytes(tag)))), ...parts)
  return derTlv(0x6c, body)
}

/* ------------------------------------------------------------------ *
 * DG13 — issuer-defined optional details (§4.7.13)
 * ------------------------------------------------------------------ */

/** DG13 wraps issuer-defined content: `6D { ... }`. */
export function buildDg13(content: Bytes): Bytes {
  return derTlv(0x6d, content)
}

/** Encodes a plain UTF8 text as DG13 content (`6D { 5F0E text }`). */
export function buildDg13Text(text: Bytes): Bytes {
  return buildDg13(derTlv(0x5f0e, text))
}

/* ------------------------------------------------------------------ *
 * DG14 — SecurityInfos (§4.7.14)
 * ------------------------------------------------------------------ */

/** DG14 = `6E { SecurityInfos }`; the content matches EF.CardAccess. */
export function buildDg14(securityInfos: Bytes): Bytes {
  return derTlv(0x6e, securityInfos)
}

/* ------------------------------------------------------------------ *
 * DG15 — Active Authentication public key (Doc 9303-11 §6.1.5)
 * ------------------------------------------------------------------ */

/** DG15 = `6F { SubjectPublicKeyInfo }`. */
export function buildDg15(subjectPublicKeyInfo: Bytes): Bytes {
  return derTlv(0x6f, subjectPublicKeyInfo)
}

/* ------------------------------------------------------------------ *
 * DG16 — person(s) to notify (§4.7.16 Table 80/81)
 * ------------------------------------------------------------------ */

/** A DG16 person-to-notify entry. */
export interface Dg16Person {
  name: string
  telephone?: string
  address?: string
  /** Date recorded, CCYYMMDD. */
  dateRecorded?: string
}

/** DG16 = `70 { 02 count, A1 { 5F50 name, 5F51 tel, 5F52 addr, 5F53 date } ... }`. */
export function buildDg16(persons: Dg16Person[]): Bytes {
  if (persons.length === 0) throw new Error('DG16 requires at least one person')
  const entries = persons.map((person) => {
    const parts: Bytes[] = [derTlv(0x5f50, utf8(person.name))]
    if (person.telephone) parts.push(derTlv(0x5f51, utf8(person.telephone)))
    if (person.address) parts.push(derTlv(0x5f52, utf8(person.address)))
    if (person.dateRecorded) parts.push(derTlv(0x5f53, ascii(padDigits(person.dateRecorded, 8))))
    return derTlv(0xa1, concat(...parts))
  })
  return derTlv(0x70, concat(derInteger(persons.length), ...entries))
}

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

/** Writes a big-endian unsigned integer of a fixed byte width. */
function writeUint(value: number, width: number): Bytes {
  const out = new Uint8Array(width)
  for (let i = width - 1; i >= 0; i--) {
    out[i] = value & 0xff
    value = Math.floor(value / 256)
  }
  return out
}

function utf8(text: string): Bytes {
  return new TextEncoder().encode(text)
}

function asciiBytes(bytes: Bytes): string {
  let out = ''
  for (const byte of bytes) out += String.fromCharCode(byte)
  return out
}

/** Keeps only digits and pads/truncates to a length. */
function padDigits(value: string, length: number): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length >= length) return digits.slice(0, length)
  return digits + '0'.repeat(length - digits.length)
}

/** Encodes a tag as raw bytes (for `5C` tag lists). */
function encodeTagBytes(tag: number): Bytes {
  if (tag <= 0xff) return new Uint8Array([tag])
  const bytes: number[] = []
  let value = tag
  while (value > 0) {
    bytes.unshift(value & 0xff)
    value = Math.floor(value / 256)
  }
  for (let i = 1; i < bytes.length; i++) bytes[i] &= 0x7f
  return new Uint8Array(bytes)
}

/** Finds the first occurrence of a tag anywhere in a buffer. */
function findTag(bytes: Bytes, tag: number): Bytes | null {
  const walk = (node: ReturnType<typeof parseTlv>): Bytes | null => {
    if (node.tag === tag) return node.value
    for (const child of node.children) {
      const found = walk(child)
      if (found) return found
    }
    return null
  }
  return walk(parseTlv(bytes))
}
