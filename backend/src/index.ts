/**
 * Backend entrypoint (M3): load configuration, build the app, listen and shut
 * down gracefully.
 */
import { buildApp } from './app'
import { loadConfig } from './config'
import { startCrlScheduler } from './modules/csca/scheduler'
import { startLdapServer, type LdapServerHandle } from './modules/pkd/ldap'

async function main(): Promise<void> {
  const config = loadConfig()
  const built = await buildApp({ config })
  const { app, dbHandle } = built

  await app.listen({ host: config.host, port: config.port })
  app.log.info(
    { url: config.publicUrl, roles: config.roles, env: config.env },
    'pkd42 backend listening',
  )

  const stopCrlScheduler = config.roles.includes('csca')
    ? startCrlScheduler(built.csca, (message, detail) => app.log.info({ detail }, message))
    : () => {}

  let ldap: LdapServerHandle | undefined
  if (config.roles.includes('pkd') && config.ldap.enabled) {
    ldap = await startLdapServer({
      db: dbHandle.db,
      config,
      log: (message) => app.log.info(message),
    })
  }

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    app.log.info({ signal }, 'shutting down')
    stopCrlScheduler()
    if (ldap) await ldap.close()
    try {
      await app.close()
      dbHandle.sqlite.close()
    } catch (error) {
      app.log.error({ err: error }, 'error during shutdown')
    }
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
