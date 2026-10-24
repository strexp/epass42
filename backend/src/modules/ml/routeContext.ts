/**
 * Shared dependency types for the ML route handlers.
 */
import type { AuthContext } from '../auth/middleware'
import type { MlService } from './service'

/** Dependencies for the ML routes. */
export interface MlRouteDeps extends AuthContext {
  service: MlService
}
