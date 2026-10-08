import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'

import { mailToken, revealToken, signRequest } from '../../db/schema'
import type { Db } from '../../db/client'
import { FakeOidc, makeTestApp } from '../../test-support'
import type { DscService } from './service'

const NIA_DSC_ADMIN = {
  sub: 'nia-dsc-admin',
  dn42: { asn: 4242422189, active_mnt: 'EXAMPLE-DSC-MNT', mnt_by: ['EXAMPLE-DSC-MNT'] },
}
const USER = {
  sub: 'user',
  email: 'user@example.net',
  dn42: { asn: 4242420000, active_mnt: 'USER-MNT', mnt_by: ['USER-MNT'] },
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]).toString('base64')

function payload(
  documentNumber = 'X1234567',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    mrz: {
      documentCode: 'P',
      issuingState: 'UDN',
      surname: 'DOE',
      givenNames: 'JANE',
      documentNumber,
      nationality: 'UDN',
      dateOfBirth: '900101',
      sex: 'F',
      dateOfExpiry: '300101',
      personalNumber: '',
      optionalData: '',
    },
    dg2: { jpeg: JPEG, width: 45, height: 35 },
    ...overrides,
  }
}

interface Harness {
  app: FastifyInstance
  oidc: FakeOidc
  db: Db
  dsc: DscService
}

async function harness(): Promise<Harness> {
  const oidc = new FakeOidc()
  const built = await makeTestApp(oidc, { PKD42_CSCA_BOOTSTRAP: 'true' })
  oidc.set('dsc-client', { subject: USER.sub, claims: USER })
  return { app: built.app, oidc, db: built.dbHandle.db, dsc: built.dsc }
}

async function login(
  app: FastifyInstance,
  oidc: FakeOidc,
  claims: Record<string, unknown>,
): Promise<string> {
  oidc.set('dsc-client', { subject: String(claims.sub), claims })
  const start = await app.inject({ method: 'GET', url: '/auth/dsc/login' })
  const state = new URL(start.headers.location as string).searchParams.get('state')
  const callback = await app.inject({
    method: 'GET',
    url: `/auth/dsc/callback?code=x&state=${state}`,
  })
  const cookie = callback.cookies.find((entry) => entry.name === 'pkd42_dsc_sid')!
  return `${cookie.name}=${cookie.value}`
}

/** Submits a request and returns its reference. */
async function submit(
  app: FastifyInstance,
  documentNumber = 'X1234567',
  overrides = {},
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/dsc/requests',
    payload: payload(documentNumber, overrides),
  })
  expect(response.statusCode).toBe(201)
  return response.json().reference as string
}

describe('M8 delivery', () => {
  it('returns a masked, non-destructive preview', async () => {
    const { app } = await harness()
    const reference = await submit(app)
    const preview = await app.inject({ method: 'GET', url: `/dsc/requests/${reference}/preview` })
    expect(preview.statusCode).toBe(200)
    const body = preview.json()
    expect(body.documentNumber.present).toBe(true)
    expect(body.documentNumber.value).not.toBe('X1234567')
    expect(body.documentNumber.value).toContain('*')
    expect(body.dataGroups).toContain(1)
    expect(body.images.dg2).toBe(true)
  })

  it('allows exactly one applicant reveal (410 afterwards)', async () => {
    const { app, oidc, dsc } = await harness()
    const reference = await submit(app)
    const admin = await login(app, oidc, NIA_DSC_ADMIN)
    const id = dsc.getByReference(reference)!.id
    await app.inject({
      method: 'POST',
      url: `/dsc/requests/${id}/approve`,
      headers: { cookie: admin },
      payload: {},
    })

    const first = await app.inject({ method: 'POST', url: `/dsc/requests/${reference}/reveal` })
    expect(first.statusCode).toBe(200)
    expect(first.headers['cache-control']).toBe('no-store')
    expect(first.body).toContain('@dg 1')

    const second = await app.inject({ method: 'POST', url: `/dsc/requests/${reference}/reveal` })
    expect(second.statusCode).toBe(410)
    expect(second.json().error).toBe('request_already_consumed')
  })

  it('restricts delivery mode B to reviewers', async () => {
    const { app, oidc, dsc } = await harness()
    const admin = await login(app, oidc, NIA_DSC_ADMIN)
    await app.inject({
      method: 'PUT',
      url: '/dsc/settings/delivery-mode',
      headers: { cookie: admin },
      payload: { deliveryMode: 'reviewer' },
    })

    const reference = await submit(app)
    const id = dsc.getByReference(reference)!.id
    await app.inject({
      method: 'POST',
      url: `/dsc/requests/${id}/approve`,
      headers: { cookie: admin },
      payload: { deliveryMode: 'reviewer' },
    })

    // The applicant cannot reveal.
    const applicant = await app.inject({ method: 'POST', url: `/dsc/requests/${reference}/reveal` })
    expect(applicant.statusCode).toBe(403)
    expect(applicant.json().error).toBe('reveal_not_allowed')

    // The admin "to be produced" queue lists it and can reveal once.
    const queue = await app.inject({
      method: 'GET',
      url: '/dsc/admin/requests',
      headers: { cookie: admin },
    })
    expect(queue.statusCode).toBe(200)
    expect((queue.json().items as { id: number }[]).some((entry) => entry.id === id)).toBe(true)

    const reveal = await app.inject({
      method: 'POST',
      url: `/dsc/admin/requests/${id}/reveal`,
      headers: { cookie: admin },
    })
    expect(reveal.statusCode).toBe(200)
    const again = await app.inject({
      method: 'POST',
      url: `/dsc/admin/requests/${id}/reveal`,
      headers: { cookie: admin },
    })
    expect(again.statusCode).toBe(410)
  })

  it('regenerates a consumed artifact', async () => {
    const { app, oidc, dsc } = await harness()
    const admin = await login(app, oidc, NIA_DSC_ADMIN)
    const reference = await submit(app)
    const id = dsc.getByReference(reference)!.id
    await app.inject({
      method: 'POST',
      url: `/dsc/requests/${id}/approve`,
      headers: { cookie: admin },
      payload: {},
    })
    await app.inject({ method: 'POST', url: `/dsc/requests/${reference}/reveal` })

    const regenerate = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${id}/regenerate`,
      headers: { cookie: admin },
      payload: {},
    })
    expect(regenerate.statusCode).toBe(200)
    expect(regenerate.json().consumedAt).toBeNull()

    const revealAgain = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${reference}/reveal`,
    })
    expect(revealAgain.statusCode).toBe(200)
  })

  it('guards settings with NIA admin authorization', async () => {
    const { app, oidc } = await harness()
    const user = await login(app, oidc, USER)
    const forbidden = await app.inject({
      method: 'PUT',
      url: '/dsc/settings/delivery-mode',
      headers: { cookie: user },
      payload: { deliveryMode: 'reviewer' },
    })
    expect(forbidden.statusCode).toBe(403)

    const admin = await login(app, oidc, NIA_DSC_ADMIN)
    const update = await app.inject({
      method: 'PUT',
      url: '/dsc/settings/issuing-profile',
      headers: { cookie: admin },
      payload: { issuingAuthority: 'CUSTOM-NIA', personalizationDevice: 'PKD42-X' },
    })
    expect(update.statusCode).toBe(200)
    expect(update.json().issuingAuthority).toBe('CUSTOM-NIA')
    expect(update.json().personalizationDevice).toBe('PKD42-X')
  })

  it('issues email tokens on approval and exposes a non-consuming landing', async () => {
    const { app, oidc, db, dsc } = await harness()
    const admin = await login(app, oidc, NIA_DSC_ADMIN)
    const reference = await submit(app, 'X1234567', { email: 'user@example.net' })
    const id = dsc.getByReference(reference)!.id
    await app.inject({
      method: 'POST',
      url: `/dsc/requests/${id}/approve`,
      headers: { cookie: admin },
      payload: {},
    })

    expect(db.select().from(mailToken).all().length).toBeGreaterThan(0)
    expect(db.select().from(revealToken).all().length).toBeGreaterThan(0)

    // A confirm token returns metadata without consuming.
    const token = dsc.createRevealToken(id, 'confirm', 3600)
    const landing = await app.inject({ method: 'POST', url: `/dsc/reveal/${token}` })
    expect(landing.statusCode).toBe(200)
    expect(landing.json().status).toBe('approved')

    const invalid = await app.inject({ method: 'POST', url: '/dsc/reveal/not-a-real-token' })
    expect(invalid.statusCode).toBe(404)

    void signRequest
  })
})
