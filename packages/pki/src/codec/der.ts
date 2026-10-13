/**
 * Minimal DER/BER encoder and decoder.
 *
 * The encoder builds the eMRTD structures (EF.SOD, EF.CardAccess, data groups)
 * and the small ASN.1 values used in X.509 extensions.  The decoder re-reads
 * DER produced here and walks certificates/CRLs and CMS structures.
 */
import { concat, type Bytes } from './bytes'

/* ------------------------------------------------------------------ *
 * Encoder
 * ------------------------------------------------------------------ */

/** Encodes a BER/DER tag (one or more bytes) from its numeric form. */
export function encodeTag(tag: number): Bytes {
  if (tag <= 0xff && (tag & 0x1f) !== 0x1f) {
    return new Uint8Array([tag])
  }
  // Multi-byte tag.  The numeric form used throughout this project is the
  // concatenation of the tag bytes (e.g. 0xBF0C -> BF 0C), so split it back
  // into its bytes while clearing the continuation bit on the tail.
  const bytes: number[] = []
  let value = tag
  while (value > 0) {
    bytes.unshift(value & 0xff)
    value = Math.floor(value / 256)
  }
  for (let i = 1; i < bytes.length; i++) bytes[i] &= 0x7f
  return new Uint8Array(bytes)
}

/** Encodes a DER length. */
export function encodeLength(length: number): Bytes {
  if (length < 0x80) return new Uint8Array([length])
  if (length <= 0xff) return new Uint8Array([0x81, length])
  if (length <= 0xffff) return new Uint8Array([0x82, (length >> 8) & 0xff, length & 0xff])
  return new Uint8Array([0x83, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff])
}

/** Encodes a BER/DER TLV from a numeric tag and a value. */
export function derTlv(tag: number, value: Bytes): Bytes {
  return concat(encodeTag(tag), encodeLength(value.length), value)
}

/** Encodes a SEQUENCE (0x30) from already-encoded children. */
export function derSequence(...items: Bytes[]): Bytes {
  return derTlv(0x30, concat(...items))
}

/** Encodes a SET (0x31) from already-encoded children. */
export function derSet(...items: Bytes[]): Bytes {
  return derTlv(0x31, concat(...items))
}

/** Encodes a minimal, non-negative INTEGER from a JS number or bigint. */
export function derInteger(value: number | bigint): Bytes {
  let hex = BigInt(value).toString(16)
  if (hex.length % 2 !== 0) hex = '0' + hex
  let bytes: Bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(2 * i, 2), 16)
  if (bytes.length === 0) bytes = new Uint8Array([0])
  // A leading byte with the high bit set needs a 0x00 prefix to stay positive.
  if ((bytes[0] & 0x80) !== 0) bytes = concat(new Uint8Array([0x00]), bytes)
  return derTlv(0x02, bytes)
}

/** Encodes an unsigned big-endian integer as a DER INTEGER. */
export function derIntegerBytes(value: Bytes): Bytes {
  let start = 0
  while (start < value.length - 1 && value[start] === 0) start++
  const trimmed = value.slice(start)
  const positive: number[] =
    trimmed.length === 0 ? [0] : (trimmed[0] & 0x80) !== 0 ? [0, ...trimmed] : [...trimmed]
  return derTlv(0x02, new Uint8Array(positive))
}

/** Encodes a NULL (0x05). */
export function derNull(): Bytes {
  return new Uint8Array([0x05, 0x00])
}

/** Encodes a BIT STRING (0x03) with zero unused bits. */
export function derBitString(value: Bytes): Bytes {
  return derTlv(0x03, concat(new Uint8Array([0x00]), value))
}

/** Encodes a PrintableString (0x13). */
export function derPrintableString(value: string): Bytes {
  return derTlv(0x13, asciiBytes(value))
}

/** Formats a date as `YYYYMMDDHHMMSSZ`. */
export function generalizedTime(date: Date): string {
  return (
    pad2(date.getUTCFullYear(), 4) +
    pad2(date.getUTCMonth() + 1) +
    pad2(date.getUTCDate()) +
    pad2(date.getUTCHours()) +
    pad2(date.getUTCMinutes()) +
    pad2(date.getUTCSeconds()) +
    'Z'
  )
}

/** Encodes an OBJECT IDENTIFIER from dotted-decimal notation. */
export function derOid(dotted: string): Bytes {
  const parts = dotted.split('.').map((p) => Number.parseInt(p, 10))
  if (parts.length < 2) throw new Error(`invalid OID: ${dotted}`)
  const out: number[] = [40 * parts[0] + parts[1]]
  for (let i = 2; i < parts.length; i++) {
    let value = parts[i]
    const stack: number[] = [value & 0x7f]
    value = Math.floor(value / 128)
    while (value > 0) {
      stack.unshift((value & 0x7f) | 0x80)
      value = Math.floor(value / 128)
    }
    out.push(...stack)
  }
  return derTlv(0x06, new Uint8Array(out))
}

/** AlgorithmIdentifier SEQUENCE { OID, NULL }. */
export function derAlgorithmIdentifier(oid: string): Bytes {
  return derSequence(derOid(oid), derNull())
}

/** DER RSAPublicKey = SEQUENCE { modulus, publicExponent }. */
export function rsaPublicKeyDer(modulus: Bytes, publicExponent: Bytes): Bytes {
  return derSequence(derIntegerBytes(modulus), derIntegerBytes(publicExponent))
}

/** DER SubjectPublicKeyInfo for an RSA public key. */
export function rsaSpki(modulus: Bytes, publicExponent: Bytes): Bytes {
  return derSequence(
    derAlgorithmIdentifier('1.2.840.113549.1.1.1'),
    derBitString(rsaPublicKeyDer(modulus, publicExponent)),
  )
}

/** P-256 named-curve OID. */
export const EC_P256_OID = '1.2.840.10045.3.1.7'
/** P-384 named-curve OID. */
export const EC_P384_OID = '1.3.132.0.34'

/** DER SubjectPublicKeyInfo for an uncompressed EC public point. */
export function ecSpki(point: Bytes, curve: 'P-256' | 'P-384' = 'P-256'): Bytes {
  return derSequence(
    derSequence(derOid('1.2.840.10045.2.1'), derOid(curve === 'P-384' ? EC_P384_OID : EC_P256_OID)),
    derBitString(point),
  )
}

/** DER SubjectPublicKeyInfo for a P-256 public point (uncompressed). */
export function ecP256Spki(point: Bytes): Bytes {
  return ecSpki(point, 'P-256')
}

/** True when all characters are printable ASCII. */
function asciiBytes(text: string): Bytes {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
  return out
}

function pad2(value: number, width = 2): string {
  return value.toString().padStart(width, '0')
}

/* ------------------------------------------------------------------ *
 * Decoder
 * ------------------------------------------------------------------ */

/** One decoded TLV node; {@link full} keeps the tag/length/value slice. */
export interface TlvNode {
  tag: number
  length: number
  /** Offset of the value inside the source buffer. */
  valueOffset: number
  /** Offset just past this node. */
  endOffset: number
  value: Bytes
  full: Bytes
  children: TlvNode[]
}

/** Decodes the tag at an offset, returning the tag number and byte width. */
function decodeTag(bytes: Bytes, offset: number): { tag: number; width: number } {
  const first = bytes[offset]
  if (first === undefined) throw new Error(`unexpected end of TLV at ${offset}`)
  if ((first & 0x1f) !== 0x1f) return { tag: first, width: 1 }
  let tag = first
  let width = 1
  while ((bytes[offset + width] & 0x80) === 0x80) {
    tag = tag * 256 + (bytes[offset + width] & 0x7f)
    width++
  }
  tag = tag * 256 + (bytes[offset + width] & 0x7f)
  return { tag, width: width + 1 }
}

/** Decodes the length at an offset. */
function decodeLength(bytes: Bytes, offset: number): { length: number; width: number } {
  const first = bytes[offset]
  if (first === undefined) throw new Error('unexpected end of TLV length')
  if (first < 0x80) return { length: first, width: 1 }
  const count = first & 0x7f
  let length = 0
  for (let i = 0; i < count; i++) length = length * 256 + bytes[offset + 1 + i]
  return { length, width: count + 1 }
}

/** Parses one TLV node at an offset and eagerly parses constructed children. */
export function parseTlv(bytes: Bytes, offset = 0): TlvNode {
  const { tag, width: tagWidth } = decodeTag(bytes, offset)
  const { length, width: lengthWidth } = decodeLength(bytes, offset + tagWidth)
  const valueOffset = offset + tagWidth + lengthWidth
  const endOffset = valueOffset + length
  const value = bytes.slice(valueOffset, endOffset)
  const full = bytes.slice(offset, endOffset)
  const node: TlvNode = { tag, length, valueOffset, endOffset, value, full, children: [] }
  // The constructed bit is bit 5 of the *first* tag byte, not of the combined
  // multi-byte tag number (whose low byte may also have bit 5 set).
  const constructed = (bytes[offset] & 0x20) !== 0
  if (constructed) {
    let childOffset = valueOffset
    while (childOffset < endOffset) {
      const child = parseTlv(bytes, childOffset)
      node.children.push(child)
      childOffset = child.endOffset
    }
  }
  return node
}

/** Parses a buffer as a single TLV and asserts it consumes the whole buffer. */
export function parseSingleTlv(bytes: Bytes): TlvNode {
  const node = parseTlv(bytes, 0)
  if (node.endOffset !== bytes.length) throw new Error('trailing bytes after TLV')
  return node
}
