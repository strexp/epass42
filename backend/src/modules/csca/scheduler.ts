/**
 * Periodic CRL scheduler (M6/T6.3).
 *
 * Checks the CRL schedule on an interval and regenerates when due.  Started by
 * the entrypoint (not by tests, which call {@link CscaService.generateCrl}
 * directly).
 */
import type { CscaService } from './service'

/** The default polling interval (one hour). */
export const CRL_CHECK_INTERVAL_MS = 3_600_000

/** Starts the scheduler and returns a stop function. */
export function startCrlScheduler(
  service: CscaService,
  log: (message: string, detail?: unknown) => void,
  intervalMs = CRL_CHECK_INTERVAL_MS,
): () => void {
  const tick = async (): Promise<void> => {
    try {
      const generated = await service.maybeGenerateCrl()
      if (generated) log('crl generated', { crlNumber: generated.crlNumber })
    } catch (error) {
      log('crl generation failed', error)
    }
  }
  const timer = setInterval(() => void tick(), intervalMs)
  timer.unref()
  void tick()
  return () => clearInterval(timer)
}
