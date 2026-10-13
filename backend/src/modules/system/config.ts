/**
 * Public runtime configuration exposed to the front end (Appendix D).
 */
import type { FastifyInstance } from 'fastify'

import type { Realm } from '@epass42/shared'
import type { AppConfig } from '../../config'
import type { AuthProviders } from '../auth/provider'

/** Registers `GET /api/config`. */
export function registerConfigRoutes(
  app: FastifyInstance,
  deps: { config: AppConfig; providers: AuthProviders },
): void {
  app.get('/api/config', async () => {
    const providersFor = (realm: Realm): { id: number; alias: string; issuer: string }[] =>
      deps.providers.list(realm).map((record) => ({
        id: record.id,
        alias: deps.providers.aliasOf(record.id),
        issuer: record.config.issuer,
      }))
    return {
      roles: deps.config.roles,
      countryAlpha2: deps.config.countryAlpha2,
      countryAlpha3: deps.config.countryAlpha3,
      oauthProviders: {
        csca: providersFor('csca'),
        cvca: providersFor('cvca'),
        dv: providersFor('dv'),
        dsc: providersFor('dsc'),
      },
    }
  })
}
