/**
 * Base64 helpers layered over `pvtsutils`, so callers never depend on the
 * platform `Buffer` directly (the same code runs in Node and the browser).
 */
import { Convert } from 'pvtsutils'

import type { Bytes } from './bytes'

/** Decodes a base64 string into bytes. */
export function fromBase64(text: string): Bytes {
  return new Uint8Array(Convert.FromBase64(text))
}

/** Encodes bytes as a base64 string. */
export function toBase64(bytes: Bytes): string {
  return Convert.ToBase64(bytes)
}

/** Decodes a base64 string into bytes, tolerating whitespace. */
export function fromBase64Loose(text: string): Bytes {
  return fromBase64(text.replace(/\s/g, ''))
}
