/**
 * Public runtime configuration exposed to the front end (Appendix D).
 */
import type { FastifyInstance } from 'fastify'

import type { AppConfig } from '../config'
import type { AuthProviders } from '../modules/auth/provider'

/** Registers `GET /api/config`. */
export function registerConfigRoutes(
  app: FastifyInstance,
  deps: { config: AppConfig; providers: AuthProviders },
): void {
  app.get('/api/config', async () => {
    const providersFor = (realm: 'csca' | 'dsc'): { id: number; issuer: string }[] =>
      deps.providers.list(realm).map((record) => ({ id: record.id, issuer: record.config.issuer }))
    return {
      roles: deps.config.roles,
      countryAlpha2: deps.config.countryAlpha2,
      countryAlpha3: deps.config.countryAlpha3,
      oauthProviders: {
        csca: providersFor('csca'),
        dsc: providersFor('dsc'),
      },
    }
  })
}
