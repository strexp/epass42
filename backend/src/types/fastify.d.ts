import type { Principal } from '../modules/auth/middleware'

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth guards; present on protected routes. */
    principal?: Principal
  }
}
