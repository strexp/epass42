import type { Role } from '@pkd42/shared'

/** The `/api/config` payload. */
export interface PkdConfig {
  roles: Role[]
  countryAlpha2: string
  countryAlpha3: string
  oauthProviders: Record<'csca' | 'dsc', { id: number; issuer: string }[]>
}

let cached: PkdConfig | null = null

/** Loads (and caches) the backend runtime configuration. */
export function usePkdConfig() {
  const config = useState<PkdConfig | null>('pkd-config', () => cached)
  async function load(): Promise<PkdConfig> {
    if (config.value) return config.value
    const api = useApi()
    const loaded = await api<PkdConfig>('/api/config')
    cached = loaded
    config.value = loaded
    return loaded
  }
  return { config, load }
}
