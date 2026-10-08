/**
 * PEM envelope helpers (DER in base64 between `-----BEGIN/END-----` lines).
 */
import { fromBase64, toBase64 } from './base64'
import type { Bytes } from './bytes'

/** Decodes a PEM block (or passes a raw DER buffer through). */
export function pemToDer(input: string | Bytes): Bytes {
  if (typeof input !== 'string') return input
  const body = input.replace(/-----[A-Z0-9 ]+-----/g, '').replace(/\s/g, '')
  if (body === '' || !/^[A-Za-z0-9+/=]+$/.test(body)) {
    throw new Error('not a PEM document')
  }
  return fromBase64(body)
}

/** Wraps DER bytes in a PEM block with the given label. */
export function derToPem(der: Bytes, label: string): string {
  const base64 = toBase64(der)
  const lines: string[] = []
  for (let i = 0; i < base64.length; i += 64) lines.push(base64.slice(i, i + 64))
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`
}
