import ldapjs from 'ldapjs'
import { afterAll, describe, expect, it } from 'vitest'

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

  it('renders LDIF with the ICAO object classes and binary attributes', async () => {
    const { app, db, config } = await setup()
    const ldif = await app.inject({ method: 'GET', url: '/pkd/ldif' })
    expect(ldif.statusCode).toBe(200)
    expect(ldif.body).toContain('userCertificate;binary::')
    expect(ldif.body).toContain('certificateRevocationList;binary::')
    expect(ldif.body).toContain('objectClass: 2.23.136.2')
    expect(ldif.body).toContain('2.23.136.1.1.2::')
    expect(ldif.body).toContain(`dn: ${baseDn(config)}`)
    void db
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
    const cookie = callback.cookies.find((entry) => entry.name === 'pkd42_csca_sid')!

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
