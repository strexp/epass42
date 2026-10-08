/**
 * Fastify application assembly (M3/T3.1, T3.6, T3.7).
 *
 * Wires validation/serialization (zod), cookies, rate limiting, OpenAPI docs,
 * request IDs, a unified error handler and the route modules.  `buildApp` is
 * imported by both the entrypoint and the tests.
 */
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod'
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod'

import { AppError } from '@pkd42/shared'
import type { AppConfig } from './config'
import { openDatabase, type DbHandle } from './db/client'
import { runMigrations } from './db/migrate'
import { resolveKek } from './crypto/keyring'
import { registerConfigRoutes } from './routes/config'
import { registerHealthRoutes } from './routes/health'
import {
  seedProviders,
  AuthProviders,
  OpenidClientDriver,
  type OidcDriverFactory,
} from './modules/auth/provider'
import { SessionStore } from './modules/auth/session'
import { registerAuthRoutes } from './modules/auth/routes'
import { realmEnabled } from './modules/auth/middleware'
import { CscaService } from './modules/csca/service'
import { registerCscaRoutes } from './modules/csca/routes'
import { DscService } from './modules/dsc/service'
import { registerDscRoutes } from './modules/dsc/routes'
import { createMailer } from './mail/mailer'

/** Options for {@link buildApp}. */
export interface BuildAppOptions {
  config: AppConfig
  /** Reuse an existing database handle (tests, workers). */
  dbHandle?: DbHandle
  /** Override the OIDC driver (tests inject a fake). */
  driverFactory?: OidcDriverFactory
  /** Force the Fastify logger off (tests). */
  logger?: boolean
}

/** The assembled application and its shared services. */
export interface BuiltApp {
  app: FastifyInstance
  config: AppConfig
  dbHandle: DbHandle
  providers: AuthProviders
  sessions: SessionStore
  csca: CscaService
  dsc: DscService
}

const defaultDriverFactory: OidcDriverFactory = (provider, redirectUri) => {
  // Lazily run discovery (a network call) on the first login, not at startup.
  let real: Promise<OpenidClientDriver> | undefined
  const resolve = (): Promise<OpenidClientDriver> =>
    (real ??= OpenidClientDriver.create(provider, redirectUri))
  return {
    provider,
    redirectUri,
    async start() {
      return (await resolve()).start()
    },
    async complete(currentUrl, flow) {
      return (await resolve()).complete(currentUrl, flow)
    },
  }
}

/** Builds the Fastify application. */
export async function buildApp(options: BuildAppOptions): Promise<BuiltApp> {
  const { config } = options
  const dbHandle = options.dbHandle ?? openDatabase(config.databasePath)
  if (!options.dbHandle && config.runMigrations) {
    runMigrations(dbHandle)
  }

  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: config.logLevel,
            transport:
              config.env === 'development'
                ? {
                    target: 'pino-pretty',
                    options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
                  }
                : undefined,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
              ],
              remove: true,
            },
          },
    trustProxy: config.trustProxy,
    requestIdHeader: 'x-request-id',
    genReqId: (request) =>
      (request.headers['x-request-id'] as string | undefined) ?? crypto.randomUUID(),
  })

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(cookie)
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
    allowList: [],
  })
  await app.register(swagger, {
    openapi: {
      info: { title: 'pkd42 API', version: '0.1.0' },
      servers: [{ url: config.publicUrl }],
    },
    transform: jsonSchemaTransform,
  })
  await app.register(swaggerUi, { routePrefix: '/docs' })
  app.get('/openapi.json', { config: { rateLimit: false } }, () => app.swagger())

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id)
    return payload
  })

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({ error: 'validation_failed', details: error.validation })
    }
    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, 'response serialization error')
      return reply.code(500).send({ error: 'internal' })
    }
    if (error instanceof AppError) {
      return reply.code(error.status).send({ error: error.code, message: error.message })
    }
    const status = error.statusCode ?? 500
    if (status >= 500) {
      request.log.error({ err: error }, 'unhandled error')
      return reply.code(500).send({ error: 'internal' })
    }
    return reply.code(status).send({ error: error.code ?? 'bad_request', message: error.message })
  })

  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({ error: 'not_found' })
  })

  const records = seedProviders(dbHandle.db, config)
  const providers = new AuthProviders(
    records,
    options.driverFactory ?? defaultDriverFactory,
    config.publicUrl,
  )
  const sessions = new SessionStore(dbHandle.db, config)
  const kek = resolveKek(config)
  const csca = new CscaService({ db: dbHandle.db, config, kek })
  if (realmEnabled(config, 'csca')) {
    await csca.ensureCscaKey()
  }
  const dsc = new DscService(dbHandle.db, config, csca)

  registerHealthRoutes(app, dbHandle)
  registerConfigRoutes(app, { config, providers })
  registerAuthRoutes(app, { config, db: dbHandle.db, sessions, providers })
  if (realmEnabled(config, 'csca')) {
    registerCscaRoutes(app, { config, db: dbHandle.db, sessions, service: csca })
  }
  if (realmEnabled(config, 'dsc')) {
    const mailer = createMailer(config, (message) => app.log.info(message))
    registerDscRoutes(app, { config, db: dbHandle.db, sessions, service: dsc, mailer })
  }

  await app.ready()
  return { app, config, dbHandle, providers, sessions, csca, dsc }
}
