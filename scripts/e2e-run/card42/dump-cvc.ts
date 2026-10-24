import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCvCertificate } from '@epass42/pki'

const out = join(import.meta.dirname, 'out')
for (const name of ['ta-chain.der', 'ta-chain-restricted.der', 'ta-chain-epassport.der']) {
  const der = new Uint8Array(readFileSync(`${out}/${name}`))
  let off = 0
  console.log(`== ${name}`)
  while (off < der.length) {
    const tagLen = der[off] === 0x7f ? 2 : 1
    let p = off + tagLen
    let len = der[p++]
    if (len & 0x80) {
      const n = len & 0x7f
      len = 0
      for (let i = 0; i < n; i++) len = (len << 8) | der[p++]
    }
    const cert = der.subarray(off, p + len)
    const c = parseCvCertificate(cert)
    console.log(c.role, c.holderReference, JSON.stringify(c.permissions))
    off = p + len
  }
}
