/**
 * Shared context and row aliases for the Master List (ML) role.
 *
 * ML Signers are CSCA-issued signer certificates stored in the shared
 * `dsc_cert` registry with `source = 'ml-signer'`.  Keeping them in that table
 * preserves the existing sealed-key storage and the master-list foreign key.
 */
import type { AppConfig } from '../../config'
import type { Db } from '../../db/client'
import { dscCert, masterList } from '../../db/schema'

export type MlSignerRow = typeof dscCert.$inferSelect
export type MasterListRow = typeof masterList.$inferSelect

/** Collaborators for the ML services. */
export interface MlContext {
  db: Db
  config: AppConfig
  /** Ordered KEKs: index 0 seals new keys, all are tried when opening. */
  keks: Buffer[]
}
