/**
 * Minimal IP address / CIDR helpers for AS jurisdiction lookup (M7 IP policy).
 *
 * Supports IPv4 and IPv6 (with `::` compression and trailing embedded IPv4).
 */
import { isIP } from 'node:net'

/** Parses an IP address into 4 (v4) or 16 (v6) bytes, or null. */
export function parseIp(ip: string): Uint8Array | null {
  const version = isIP(ip)
  if (version === 4) {
    return new Uint8Array(ip.split('.').map((part) => Number(part) & 0xff))
  }
  if (version !== 6) return null
  return parseIpv6(ip)
}

function parseIpv6(ip: string): Uint8Array | null {
  const zone = ip.indexOf('%')
  const address = zone === -1 ? ip : ip.slice(0, zone)
  const [headPart, tailPart] = address.split('::')
  const head = headPart ? headPart.split(':') : []
  const tail = tailPart ? tailPart.split(':') : []
  const groups: number[] = []
  const toWords = (part: string): number[] => {
    if (part.includes('.')) {
      const v4 = parseIp(part)
      if (!v4) return []
      return [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]]
    }
    return [Number.parseInt(part, 16) & 0xffff]
  }
  for (const part of head) groups.push(...toWords(part))
  const missing = 8 - groups.length - tail.flatMap(toWords).length
  for (let i = 0; i < missing; i++) groups.push(0)
  for (const part of tail) groups.push(...toWords(part))
  if (groups.length !== 8) return null
  const bytes = new Uint8Array(16)
  groups.forEach((word, index) => {
    bytes[index * 2] = (word >> 8) & 0xff
    bytes[index * 2 + 1] = word & 0xff
  })
  return bytes
}

/** Parses a CIDR into its network bytes and prefix length, or null. */
export function parseCidr(cidr: string): { bytes: Uint8Array; bits: number } | null {
  const [address, prefix] = cidr.split('/')
  const bytes = parseIp(address ?? '')
  if (!bytes) return null
  const maxBits = bytes.length * 8
  const bits = prefix === undefined ? maxBits : Number(prefix)
  if (!Number.isInteger(bits) || bits < 0 || bits > maxBits) return null
  return { bytes, bits }
}

/** True when `ip` falls within `cidr`. */
export function ipInCidr(ip: string, cidr: string): boolean {
  const address = parseIp(ip)
  const network = parseCidr(cidr)
  if (!address || !network || address.length !== network.bytes.length) return false
  let remaining = network.bits
  for (let i = 0; i < address.length && remaining > 0; i++) {
    const mask = remaining >= 8 ? 0xff : (0xff << (8 - remaining)) & 0xff
    if ((address[i] & mask) !== (network.bytes[i] & mask)) return false
    remaining -= 8
  }
  return true
}

/** One route entry for jurisdiction lookup. */
export interface JurisdictionRoute {
  prefix: string
  asn: number
}

/** Finds the most specific ASN for an IP (longest-prefix match). */
export function findAsn(routes: JurisdictionRoute[], ip: string): number | null {
  let best: { asn: number; bits: number } | null = null
  for (const route of routes) {
    const network = parseCidr(route.prefix)
    if (!network) continue
    if (!ipInCidr(ip, route.prefix)) continue
    if (!best || network.bits > best.bits) best = { asn: route.asn, bits: network.bits }
  }
  return best?.asn ?? null
}
