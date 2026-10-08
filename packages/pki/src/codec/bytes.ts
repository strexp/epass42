/**
 * Byte-level helpers for the PKI and eMRTD encoders.
 *
 * Everything in this package works on {@link Uint8Array}.  Generic operations
 * are delegated to `@noble/hashes` and `pvtsutils`; only the layout helpers
 * used by the ICAO/EMV encoders live here.
 */
import { concatBytes } from '@noble/hashes/utils.js'
import { BufferSourceConverter } from 'pvtsutils'

/** A byte buffer alias used throughout the package. */
export type Bytes = Uint8Array

/** Concatenates byte arrays into a new buffer. */
export function concat(...parts: Bytes[]): Bytes {
  return concatBytes(...parts)
}

/** Copies bytes into a standalone ArrayBuffer for WebCrypto. */
export function toArrayBuffer(bytes: Bytes): ArrayBuffer {
  return BufferSourceConverter.toArrayBuffer(bytes)
}

/** Writes a big-endian unsigned integer of a fixed byte width. */
export function writeUint(value: number, width: number): Bytes {
  const out = new Uint8Array(width)
  for (let i = width - 1; i >= 0; i--) {
    out[i] = value & 0xff
    value = Math.floor(value / 256)
  }
  return out
}

/** ASCII string to bytes (each char code truncated to 8 bits). */
export function ascii(text: string): Bytes {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
  return out
}

/** Constant-time byte comparison. */
export function bytesEqual(a: Bytes, b: Bytes): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** Removes leading zero bytes, always keeping at least one byte. */
export function trimLeadingZeros(value: Bytes): Bytes {
  let start = 0
  while (start < value.length - 1 && value[start] === 0) start++
  return value.slice(start)
}
