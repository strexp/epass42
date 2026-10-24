import type { Realm, Role } from '@epass42/shared'

/** The validity limits exposed for the application forms. */
export interface CertificatePolicyConfig {
  maxValidityDays: number
  defaultValidityDays: number
  maxPrivateKeyUsageDays: number | null
  defaultPrivateKeyUsageDays: number | null
}

/** The `/api/config` payload. */
export interface PkdConfig {
  env: 'development' | 'test' | 'production'
  roles: Role[]
  countryAlpha2: string
  countryAlpha3: string
  certificatePolicies: Record<'dsc' | 'lds2' | 'dv' | 'terminal', CertificatePolicyConfig>
  oauthProviders: Record<Realm, { id: number; alias: string; issuer: string }[]>
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
