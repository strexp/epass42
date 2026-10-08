/**
 * Hex parsing and formatting.
 *
 * Parsing/formatting is delegated to `@noble/hashes`; callers work with bytes.
 */
import {
  bytesToHex as nobleBytesToHex,
  hexToBytes as nobleHexToBytes,
} from '@noble/hashes/utils.js'

import type { Bytes } from './bytes'

/** Removes separators (spaces, colons, dashes, `0x`) from a hex string. */
export function normalizeHex(input: string): string {
  return input
    .replace(/0x/gi, '')
    .replace(/[\s:_-]/g, '')
    .toUpperCase()
}

/** True when the input is an even-length hex string (empty allowed). */
export function isHex(input: string): boolean {
  const hex = normalizeHex(input)
  return hex.length % 2 === 0 && /^[0-9A-F]*$/.test(hex)
}

/** Parses a hex string into bytes; throws on malformed input. */
export function hexToBytes(input: string): Bytes {
  const hex = normalizeHex(input)
  if (hex === '') return new Uint8Array(0)
  if (hex.length % 2 !== 0 || !/^[0-9A-F]*$/.test(hex)) {
    throw new Error(`invalid hex: ${input}`)
  }
  return nobleHexToBytes(hex)
}

/** Formats bytes as uppercase hex, optionally with a separator. */
export function bytesToHex(bytes: Bytes, separator = ''): string {
  const hex = nobleBytesToHex(bytes).toUpperCase()
  if (separator === '') return hex
  const parts: string[] = []
  for (let i = 0; i < hex.length; i += 2) parts.push(hex.slice(i, i + 2))
  return parts.join(separator)
}
