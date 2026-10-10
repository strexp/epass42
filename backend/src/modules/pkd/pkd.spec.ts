import ldapjs from 'ldapjs'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'

import { dscCert, signRequest } from '../../db/schema'
import { FakeOidc, makeTestApp } from '../../test-support'
import { buildEntries, matchesFilter, startLdapServer, type LdapServerHandle } from './ldap'
import { baseDn } from './directory'

const ADMIN = {
  sub: 'csca-admin',
  dn42: { asn: 4242422189, active_mnt: 'EXAMPLE-CSCA-MNT', mnt_by: ['EXAMPLE-CSCA-MNT'] },
}

async function setup() {
  const oidc = new FakeOidc()
  oidc.set('csca-client', { subject: ADMIN.sub, claims: ADMIN })
  const built = await makeTestApp(oidc, { csca: { bootstrap: true } })
  // Publish a CRL and a Master List.
  await built.csca.generateCrl()
  await built.csca.generateMasterList()
  return { app: built.app, db: built.dbHandle.db, config: built.config, oidc, csca: built.csca }
}

describe('M9 PKD REST and LDIF', () => {
  it('lists CSCA certificates, CRLs and Master Lists and serves objects', async () => {
    const { app } = await setup()

    const certs = await app.inject({ method: 'GET', url: '/pkd/certificates' })
    expect(certs.statusCode).toBe(200)
    expect(certs.json().total).toBeGreaterThanOrEqual(1)

    const crls = await app.inject({ method: 'GET', url: '/pkd/crls' })
    expect((crls.json().items as { crlNumber: number }[])[0].crlNumber).toBe(1)

    const mls = await app.inject({ method: 'GET', url: '/pkd/masterlists' })
    expect(mls.json().total).toBe(1)

    const der = await app.inject({ method: 'GET', url: '/pkd/objects/csca-1.der' })
    expect(der.statusCode).toBe(200)
    expect(der.rawPayload[0]).toBe(0x30)

    const pem = await app.inject({ method: 'GET', url: '/pkd/objects/csca-1.pem' })
    expect(pem.body).toContain('BEGIN CERTIFICATE')

    const missing = await app.inject({ method: 'GET', url: '/pkd/objects/csca-999.der' })
    expect(missing.statusCode).toBe(404)
  })

  it('publishes active and revoked DSCs with policy, type, validity and URL', async () => {
    const { app, db, csca } = await setup()

    // Create the NIA DSC, give it a policy and URL, then revoke it so both
    // lifecycle states are exercised.  The ML signer is not a DSC and must be
    // excluded from the list.
    await csca.ensureNiaDsc()
    const row = db.select().from(dscCert).where(eq(dscCert.source, 'nia')).get()!
    db.update(dscCert)
      .set({ issuancePolicy: 'open', applicationUrl: 'https://example.net/dsc' })
      .where(eq(dscCert.id, row.id))
      .run()
    csca.revoke(row.id, 'superseded')

    const list = await app.inject({ method: 'GET', url: '/pkd/dscs' })
    expect(list.statusCode).toBe(200)
    expect(list.json().total).toBe(1)
    const item = list.json().items[0]
    expect(item.id).toBe(row.id)
    expect(item.status).toBe('revoked')
    expect(item.documentTypes).toContain('P')
    expect(item.issuancePolicy).toBe('open')
    expect(item.applicationUrl).toBe('https://example.net/dsc')
    expect(item.notBefore).toBeTruthy()
    expect(item.notAfter).toBeTruthy()
    expect(item.name).toContain('CN=')
  })

  it('publishes revoked-document hashes and answers lookups', async () => {
    const { app, db } = await setup()
    const document = {
      documentCode: 'P',
      issuingState: 'UDN',
      documentNumber: 'R1234567',
      dateOfBirth: '900101',
    }

    // A revoked request carries the MRZ lookup fields in its payload.
    db.insert(signRequest)
      .values({
        reference: 'revoked-0001',
        dscSelection: 'nia',
        payloadJson: JSON.stringify({
          mrz: { ...document, nationality: 'UDN', surname: 'Doe', sex: '<' },
          dg2: { jpeg: '', width: 1, height: 1 },
        }),
        status: 'revoked',
        revokedAt: '2026-01-02T00:00:00.000Z',
        revokeReason: 'lost',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
      .run()

    const list = await app.inject({ method: 'GET', url: '/pkd/revoked' })
    expect(list.statusCode).toBe(200)
    expect(list.json().total).toBe(1)
    const item = list.json().items[0]
    expect(item.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(item.documentCode).toBe('P')
    expect(item.revokedAt).toBe('2026-01-02T00:00:00.000Z')

    // The very same fields hash to the published value.
    const check = await app.inject({
      method: 'POST',
      url: '/pkd/revoked/check',
      payload: document,
    })
    expect(check.statusCode).toBe(200)
    expect(check.json().revoked).toBe(true)
    expect(check.json().hash).toBe(item.hash)

    // Filler padding is normalised away, so a read MRZ field still matches.
    const padded = await app.inject({
      method: 'POST',
      url: '/pkd/revoked/check',
      payload: { ...document, documentNumber: 'R1234567<' },
    })
    expect(padded.json().revoked).toBe(true)

    // An unrelated document is not on the list.
    const other = await app.inject({
      method: 'POST',
      url: '/pkd/revoked/check',
      payload: { ...document, documentNumber: 'R7654321' },
    })
    expect(other.json().revoked).toBe(false)

    // And the hash can be looked up directly.
    const byHash = await app.inject({ method: 'GET', url: `/pkd/revoked/${item.hash}` })
    expect(byHash.statusCode).toBe(200)
    expect(byHash.json().revoked).toBe(true)
  })

  it('renders LDIF with the ICAO object classes and binary attributes', async () => {
    const { app, db, config } = await setup()
    const ldif = await app.inject({ method: 'GET', url: '/pkd/ldif' })
    expect(ldif.statusCode).toBe(200)
    expect(ldif.body).toContain('userCertificate;binary::')
    expect(ldif.body).toContain('certificateRevocationList;binary::')
    expect(ldif.body).toContain('objectClass: 2.23.136.2')
    expect(ldif.body).toContain('2.23.136.1.1.2::')
    expect(ldif.body).toContain(`dn: ${baseDn(config)}`)
    // The suffix entry must carry its RDN naming attribute and a matching
    // object class, otherwise `slapadd` rejects it.
    expect(ldif.body).toContain('objectClass: country')
    expect(ldif.body).toContain('c: XD')
    void db
  })

  it('emits every entry with its RDN naming attribute (slapadd precondition)', async () => {
    const { app } = await setup()
    const ldif = await app.inject({ method: 'GET', url: '/pkd/ldif' })
    const blocks = ldif.body.split(/\n\n+/).filter((block) => block.trim() !== '')
    for (const block of blocks) {
      const lines = block.split('\n')
      const dnLine = lines.find((line) => line.startsWith('dn: '))!
      const dn = dnLine.slice(4)
      const attribute = dn.split(',')[0]!.split('=')[0]!.toLowerCase()
      const present = lines.some((line) => {
        const lower = line.toLowerCase()
        return lower.startsWith(`${attribute}:`) || lower.startsWith(`${attribute}::`)
      })
      expect(present, `entry "${dn}" is missing its RDN attribute ${attribute}`).toBe(true)
    }
  })

  it('generates a Master List via the admin endpoint', async () => {
    const { app, oidc } = await setup()
    oidc.set('csca-client', { subject: ADMIN.sub, claims: ADMIN })
    const start = await app.inject({ method: 'GET', url: '/auth/csca/login' })
    const state = new URL(start.headers.location as string).searchParams.get('state')
    const callback = await app.inject({
      method: 'GET',
      url: `/auth/csca/callback?code=x&state=${state}`,
    })
    const cookie = callback.cookies.find((entry) => entry.name === 'epass42_csca_sid')!

    const created = await app.inject({
      method: 'POST',
      url: '/pkd/masterlists',
      headers: { cookie: `${cookie.name}=${cookie.value}` },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().id).toMatch(/^ml-/)
  })
})

describe('M9 LDAP entry building and filters', () => {
  it('matches common LDAP filters', () => {
    const attributes = { objectclass: ['top', 'inetOrgPerson'], cn: ['ABC123'] }
    expect(matchesFilter(ldapjs.parseFilter('(objectClass=inetOrgPerson)'), attributes)).toBe(true)
    expect(
      matchesFilter(ldapjs.parseFilter('(objectClass=cRLDistributionPoint)'), attributes),
    ).toBe(false)
    expect(matchesFilter(ldapjs.parseFilter('(cn=*)'), attributes)).toBe(true)
    expect(
      matchesFilter(ldapjs.parseFilter('(&(objectClass=inetOrgPerson)(cn=ABC*))'), attributes),
    ).toBe(true)
  })

  it('builds the DIT', async () => {
    const { db, config } = await setup()
    const entries = buildEntries(db, config)
    const suffix = entries.find((entry) => entry.dn === baseDn(config))!
    expect(suffix.attributes.c).toEqual(['XD'])
    expect(suffix.attributes.objectclass).toContain('country')
    expect(
      entries.some((entry) => entry.dn.startsWith('cn=') && entry.dn.includes('ou=csca,')),
    ).toBe(true)
    expect(entries.some((entry) => entry.dn.includes('ou=masterlist,'))).toBe(true)
  })
})

describe('M9 read-only LDAP server', () => {
  let handle: LdapServerHandle | undefined
  afterAll(async () => {
    if (handle) await handle.close()
  })

  it('serves a search for inetOrgPerson entries', async () => {
    const { db, config } = await setup()
    handle = await startLdapServer({ db, config }, 0)

    const client = ldapjs.createClient({ url: `ldap://127.0.0.1:${handle.port}` })
    await new Promise<void>((resolve, reject) => {
      client.bind(baseDn(config), '', (error) => (error ? reject(error) : resolve()))
    })

    const entries = await new Promise<number>((resolve, reject) => {
      let count = 0
      client.search(
        baseDn(config),
        { scope: 'sub', filter: '(objectClass=inetOrgPerson)' },
        (error, res) => {
          if (error) return reject(error)
          res.on('searchEntry', () => {
            count += 1
          })
          res.on('error', reject)
          res.on('end', () => resolve(count))
        },
      )
    })
    expect(entries).toBeGreaterThanOrEqual(1)
    client.unbind(() => undefined)
  }, 15_000)
})
