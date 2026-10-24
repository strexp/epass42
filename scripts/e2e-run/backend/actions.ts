/**
 * Reusable multi-step HTTP flows for the backend suites.
 *
 * Every helper drives the same routes a UI would use: it logs into the right
 * realm, submits as the applicant and reviews as the administrator.  Tests that
 * need a mid-flow assertion still call the routes directly.
 */
import { expect } from 'vitest'

import {
  CLIENT_IDS,
  CSCA_ADMIN,
  CSCA_USER,
  CVCA_ADMIN,
  CVCA_USER,
  DSC_ADMIN,
  DSC_USER,
  DV_ADMIN,
  DV_USER,
  ML_ADMIN,
  type TestIdentity,
} from '../fixtures/identities'
import { loginAs, type Backend, type HttpClient } from './harness'
import type {
  CertMetadata,
  DvMetadata,
  Permissions,
  RequestMetadata,
  TerminalMetadata,
} from './types'

/** An ISO timestamp far enough in the past to expire any row. */
export const PAST = '2000-01-01T00:00:00.000Z'

/** Submits a CSCA signer application and returns its application id. */
export async function submitCscaSigner(
  backend: Backend,
  body: Record<string, unknown>,
  applicant: TestIdentity = CSCA_USER,
  client: HttpClient = backend.client,
): Promise<number> {
  await loginAs(backend, 'csca', CLIENT_IDS.csca, applicant, client)
  const response = await client.post('/csca/applications', {
    keyMode: 'remote_generated',
    ...body,
  })
  expect(response.status).toBe(201)
  return response.json<{ id: number }>().id
}

/** Submits and approves a CSCA-issued signer certificate. */
export async function issueCscaSigner(
  backend: Backend,
  body: Record<string, unknown>,
  applicant: TestIdentity = CSCA_USER,
): Promise<CertMetadata> {
  const id = await submitCscaSigner(backend, body, applicant)
  await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_ADMIN)
  const approve = await backend.client.post(`/csca/applications/${id}/approve`, {})
  expect(approve.status).toBe(201)
  return approve.json<CertMetadata>()
}

/** Submits a DV application and returns its application id. */
export async function submitDvApplication(
  backend: Backend,
  body: Record<string, unknown>,
  applicant: TestIdentity = CVCA_USER,
): Promise<number> {
  await loginAs(backend, 'cvca', CLIENT_IDS.cvca, applicant)
  const response = await backend.client.post('/cvca/applications', {
    keyMode: 'remote_generated',
    dvClass: 'domestic',
    permissions: allPermissions(),
    ...body,
  })
  expect(response.status).toBe(201)
  return response.json<{ id: number }>().id
}

/** Submits and approves a DV certificate. */
export async function issueDv(
  backend: Backend,
  body: Record<string, unknown> = {},
  override: Record<string, unknown> = {},
): Promise<DvMetadata> {
  const id = await submitDvApplication(backend, body)
  await loginAs(backend, 'cvca', CLIENT_IDS.cvca, CVCA_ADMIN)
  const approve = await backend.client.post(`/cvca/applications/${id}/approve`, override)
  expect(approve.status).toBe(201)
  return approve.json<DvMetadata>()
}

/** Submits a terminal application and returns its application id. */
export async function submitTerminalApplication(
  backend: Backend,
  body: Record<string, unknown>,
  applicant: TestIdentity = DV_USER,
): Promise<number> {
  await loginAs(backend, 'dv', CLIENT_IDS.dv, applicant)
  const response = await backend.client.post('/dv/terminal-applications', {
    keyMode: 'remote_generated',
    permissions: allPermissions(),
    ...body,
  })
  expect(response.status).toBe(201)
  return response.json<{ id: number }>().id
}

/** Submits and approves a terminal (Inspection System) certificate. */
export async function issueTerminal(
  backend: Backend,
  body: Record<string, unknown> = {},
  override: Record<string, unknown> = {},
): Promise<TerminalMetadata> {
  const id = await submitTerminalApplication(backend, body)
  await loginAs(backend, 'dv', CLIENT_IDS.dv, DV_ADMIN)
  const approve = await backend.client.post(`/dv/terminal-applications/${id}/approve`, override)
  expect(approve.status).toBe(201)
  return approve.json<TerminalMetadata>()
}

/** Submits a DSC signing request as the applicant and returns its reference. */
export async function submitRequest(
  backend: Backend,
  body: Record<string, unknown>,
  applicant: TestIdentity = DSC_USER,
): Promise<string> {
  await loginAs(backend, 'dsc', CLIENT_IDS.dsc, applicant)
  const response = await backend.client.post('/dsc/requests', body)
  expect(response.status).toBe(201)
  return response.json<{ reference: string }>().reference
}

/** Approves a DSC signing request as the NIA administrator. */
export async function approveRequest(
  backend: Backend,
  reference: string,
  body: Record<string, unknown> = {},
): Promise<RequestMetadata> {
  await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_ADMIN)
  const response = await backend.client.post(`/dsc/requests/${reference}/approve`, body)
  expect(response.status).toBe(200)
  return response.json<RequestMetadata>()
}

/** Submits and approves a DSC request, returning its reference. */
export async function issuePassport(
  backend: Backend,
  body: Record<string, unknown>,
  options: { applicant?: TestIdentity; approve?: Record<string, unknown> } = {},
): Promise<{ reference: string; request: RequestMetadata }> {
  const reference = await submitRequest(backend, body, options.applicant)
  const request = await approveRequest(backend, reference, options.approve)
  return { reference, request }
}

/** Generates a Master List as the ML administrator (test fixture). */
export async function generateMasterListForTest(
  backend: Backend,
): Promise<{ id: string; signerId: number }> {
  await loginAs(backend, 'ml', CLIENT_IDS.ml, ML_ADMIN)
  const response = await backend.client.post('/ml/masterlists', { confirm: true })
  expect(response.status).toBe(201)
  return response.json<{ id: string; signerId: number }>()
}

/** The full authorization set. */
export function allPermissions(): Permissions {
  return {
    epassport: { dg3: true, dg4: true },
    travel: { read: true, write: true },
    visa: { read: true, write: true },
    biometrics: { read: true, write: true },
  }
}

/** A travel-read-only authorization. */
export function travelReadOnly(): Permissions {
  return {
    epassport: { dg3: false, dg4: false },
    travel: { read: true, write: false },
    visa: { read: false, write: false },
    biometrics: { read: false, write: false },
  }
}

/** Expires the current CSCA certificate row. */
export function expireCsca(backend: Backend): void {
  backend.sql('UPDATE csca_key SET not_after = ? WHERE is_current = 1', PAST)
}

/** Expires the active NIA Document Signer row. */
export function expireNiaDsc(backend: Backend): void {
  backend.sql(
    "UPDATE dsc_cert SET not_after = ? WHERE source = 'nia' AND status = 'active' AND cert_type = 'dsc'",
    PAST,
  )
}

/** Expires the current CVCA certificate row. */
export function expireCvca(backend: Backend): void {
  backend.sql('UPDATE cvca_key SET not_after = ? WHERE is_current = 1', PAST)
}

/** Expires the active default (system) DV row. */
export function expireDefaultDv(backend: Backend): void {
  backend.sql(
    "UPDATE dv_cert SET not_after = ? WHERE source = 'system' AND status = 'active'",
    PAST,
  )
}

/** Expires the active Master List Signer row. */
export function expireMlSigner(backend: Backend): void {
  backend.sql(
    "UPDATE dsc_cert SET not_after = ? WHERE source = 'ml-signer' AND status = 'active'",
    PAST,
  )
}

/** Expires one owned DSC certificate row by id. */
export function expireDsc(backend: Backend, id: number): void {
  backend.sql('UPDATE dsc_cert SET not_after = ? WHERE id = ?', PAST, id)
}
